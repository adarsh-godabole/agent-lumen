import "dotenv/config";
import express, { Request, Response } from "express";
import { verifyLinearSignature } from "./auth";
import { State, TicketState } from "./state";
import { getFileContent } from "./github";
import { postComment } from "./linear";
import { generateQuestion, generateTechnicalDocument, ConversationTurn } from "./llm";

const app = express();

// Comments Lumen itself has posted — used to ignore its own comments in the
// webhook feed, since the POC's Linear API key posts as the same account
// that answers on Lumen's behalf (no dedicated bot account exists yet).
const lumenCommentIds = new Set<string>();

// ── Middleware: capture raw body for HMAC verification ───────────────────────
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString("utf-8");
    },
  })
);

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({ status: "ok", service: "lumen-agent" }));

// ── Linear Webhook Handler ───────────────────────────────────────────────────
app.post("/webhook/linear", async (req: Request, res: Response) => {
  // 1. Verify HMAC signature
  const signature = req.headers["linear-signature"] as string;
  const rawBody = (req as any).rawBody as string;

  if (!signature || !rawBody) {
    console.warn("[Webhook] Missing signature or body — skipping verification");
  } else if (!verifyLinearSignature(rawBody, signature)) {
    console.warn("[Webhook] Invalid signature — rejected");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const body = req.body;
  console.log("Webhook body:", JSON.stringify(body, null, 2));
  const action = body.action;
  const type = body.type;

  // 2. Route based on event type
  if (type === "Issue" && action === "update") {
    await handleIssueUpdate(body);
  } else if (type === "Comment" && action === "create") {
    await handleCommentCreate(body);
  }

  // Always return 200 quickly — processing is async
  res.json({ ok: true });
});

// ── Issue Update: ticket assigned to the bot with the "discussion" label ─────
async function handleIssueUpdate(body: any) {
  const issue = body.data;
  const agentUserId = process.env.LINEAR_AGENT_USER_ID!;
  const discussionLabelId = process.env.LINEAR_DISCUSSION_LABEL_ID!;

  const isAssignedToBot = issue.assigneeId === agentUserId;
  const hasDiscussionLabel = (issue.labelIds ?? []).includes(discussionLabelId);
  if (!isAssignedToBot || !hasDiscussionLabel) return;

  const ticketId = issue.id;

  // Deduplication: only run the check once per ticket
  if (State.has(ticketId)) {
    console.log(`[Webhook] Already processed ${ticketId} — ignored`);
    return;
  }

  console.log(`[Webhook] Ticket ready for Lumen: ${issue.identifier} — ${issue.title}`);

  const state: TicketState = {
    ticketId,
    title: issue.title,
    description: issue.description ?? "",
    url: `https://linear.app/issue/${issue.identifier}`,
    status: "checking_claude_md",
    conversationLog: [],
    round: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  State.set(ticketId, state);

  checkClaudeMd(ticketId).catch((err) => {
    console.error(`[Lumen] Failed to check CLAUDE.md for ${ticketId}:`, err);
  });
}

// ── Comment Create: the product owner answering Lumen's questions ───────────
async function handleCommentCreate(body: any) {
  const comment = body.data;
  const ticketId = comment.issueId;

  // Ignore Lumen's own comments — otherwise it replies to itself forever
  if (lumenCommentIds.has(comment.id)) return;

  const state = State.get(ticketId);
  if (!state || state.status !== "awaiting_answers") return;

  const answerText: string = (comment.body ?? "").trim();
  if (!answerText) return;

  console.log(`[Webhook] Answer received for ${ticketId}`);

  runEvaluation(ticketId, answerText).catch((err) => {
    console.error(`[Lumen] Failed to evaluate answer for ${ticketId}:`, err);
  });
}

// ── Step 1: check the repo has a root CLAUDE.md ──────────────────────────────
async function checkClaudeMd(ticketId: string) {
  const claudeMdContent = await getFileContent("CLAUDE.md");

  if (claudeMdContent === null) {
    State.transition(ticketId, "claude_md_missing");
    const commentId = await postComment(ticketId, "I don't see any CLAUDE.md files, please add.");
    lumenCommentIds.add(commentId);
    console.log(`[Lumen] CLAUDE.md missing for ${ticketId} — comment posted`);
    return;
  }

  console.log(`[Lumen] CLAUDE.md found for ${ticketId} — generating questions`);
  State.transition(ticketId, "analysing", { claudeMdContent });
  await runQuestionGeneration(ticketId);
}

// ── Step 2: generate and post the single most important clarifying question ─
async function runQuestionGeneration(ticketId: string) {
  const state = State.get(ticketId)!;
  const question = await generateQuestion(state.title, state.description, state.claudeMdContent!);

  if (!question) {
    console.log(`[Lumen] No clarifying question needed for ${ticketId} — going straight to summary`);
    await finalizeTechnicalDocument(ticketId, state.conversationLog, state.round);
    return;
  }

  const commentId = await postComment(ticketId, formatQuestionComment(question));
  lumenCommentIds.add(commentId);

  State.transition(ticketId, "awaiting_answers", {
    conversationLog: [{ from: "lumen", text: question }],
  });
  console.log(`[Lumen] Question posted for ${ticketId}`);
}

// ── Step 3: single answer received — go straight to the technical document ──
async function runEvaluation(ticketId: string, answerText: string) {
  const state = State.get(ticketId)!;
  const conversationLog = [...state.conversationLog, { from: "human" as const, text: answerText }];
  await finalizeTechnicalDocument(ticketId, conversationLog, state.round + 1);
}

// ── Step 4: generate and post the final technical document ──────────────────
async function finalizeTechnicalDocument(
  ticketId: string,
  conversationLog: ConversationTurn[],
  round: number
) {
  const state = State.get(ticketId)!;
  const doc = await generateTechnicalDocument(
    state.title,
    state.description,
    state.claudeMdContent!,
    conversationLog
  );
  const commentId = await postComment(ticketId, formatSummaryComment(doc));
  lumenCommentIds.add(commentId);
  State.transition(ticketId, "summarised", { conversationLog, round });
  console.log(`[Lumen] Technical document posted for ${ticketId}`);
}

// ── Comment formatting ───────────────────────────────────────────────────────
function formatQuestionComment(question: string): string {
  return `## 🔎 Lumen — Clarifying Question\n\n${question}\n\n---\nPlease reply in a comment with your answer.`;
}

function formatSummaryComment(doc: string): string {
  return `## ✅ Lumen — Requirements Clear\n\nAll requirements are now clear. Here is the technical draft, ready to be fed to the Coding Agent:\n\n---\n\n${doc}`;
}

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Lumen Agent running on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: POST /webhook/linear`);
  console.log(`   Expose with: ngrok http ${PORT}\n`);
});
