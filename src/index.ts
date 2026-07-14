import "dotenv/config";
import express, { Request, Response } from "express";
import { verifyLinearSignature } from "./auth";
import { State, TicketState } from "./state";
import { getFileContent } from "./github";
import { postComment } from "./linear";
import { evaluateTask, generateTechnicalDocument, ConversationTurn } from "./llm";

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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  State.set(ticketId, state);

  checkClaudeMd(ticketId).catch((err) => {
    console.error(`[Lumen] Failed to check CLAUDE.md for ${ticketId}:`, err);
  });
}

// ── Comment Create: the PM answering Lumen's clarifying questions ───────────
async function handleCommentCreate(body: any) {
  const comment = body.data;
  const ticketId = comment.issueId;

  // Ignore Lumen's own comments — otherwise it replies to itself forever
  if (lumenCommentIds.has(comment.id)) return;

  const state = State.get(ticketId);
  if (!state || state.status !== "awaiting_answers") return;

  const answerText: string = (comment.body ?? "").trim();
  if (!answerText) return;

  // Claim the answer synchronously (before any await) so duplicate webhooks —
  // Linear fires create/update/remove for a single edited comment — can't both
  // pass the status check and finalize the document twice.
  State.transition(ticketId, "processing_answer");
  console.log(`[Webhook] Answer received for ${ticketId}`);

  runEvaluation(ticketId, answerText).catch((err) => {
    console.error(`[Lumen] Failed to process answer for ${ticketId}:`, err);
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

  console.log(`[Lumen] CLAUDE.md found for ${ticketId} — evaluating task`);
  State.transition(ticketId, "analysing", { claudeMdContent });
  await runTaskEvaluation(ticketId);
}

// ── Step 2: judge ambiguity — acknowledge a clear task, or ask up to 3 questions ─
async function runTaskEvaluation(ticketId: string) {
  const state = State.get(ticketId)!;
  const { clear, questions } = await evaluateTask(
    state.title,
    state.description,
    state.claudeMdContent!
  );

  // Clear task: no questions needed — produce the technical document straight away.
  if (clear || questions.length === 0) {
    console.log(`[Lumen] Task clear for ${ticketId} — no questions, generating document`);
    await finalizeTechnicalDocument(ticketId, [], true);
    return;
  }

  const commentId = await postComment(ticketId, formatQuestionsComment(questions));
  lumenCommentIds.add(commentId);
  State.transition(ticketId, "awaiting_answers", {
    conversationLog: [{ from: "lumen", text: questions.join("\n") }],
  });
  console.log(`[Lumen] Posted ${questions.length} clarifying question(s) for ${ticketId}`);
}

// ── Step 3: PM answered — incorporate the answers and produce the document ──
async function runEvaluation(ticketId: string, answerText: string) {
  const state = State.get(ticketId)!;
  const conversationLog = [...state.conversationLog, { from: "human" as const, text: answerText }];
  await finalizeTechnicalDocument(ticketId, conversationLog, false);
}

// ── Shared final step: generate and post the technical document ─────────────
async function finalizeTechnicalDocument(
  ticketId: string,
  conversationLog: ConversationTurn[],
  wasClear: boolean
) {
  const state = State.get(ticketId)!;
  const doc = await generateTechnicalDocument(
    state.title,
    state.description,
    state.claudeMdContent!,
    conversationLog
  );
  const commentId = await postComment(ticketId, formatSummaryComment(doc, wasClear));
  lumenCommentIds.add(commentId);
  State.transition(ticketId, "summarised", { conversationLog });
  console.log(`[Lumen] Technical document posted for ${ticketId}`);
}

// ── Comment formatting ───────────────────────────────────────────────────────
function formatQuestionsComment(questions: string[]): string {
  const list = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `## 🔎 Lumen — Clarifying Questions\n\n${list}\n\n---\nPlease reply in a comment with your answers.`;
}

function formatSummaryComment(doc: string, wasClear: boolean): string {
  const intro = wasClear
    ? "This task was clear and unambiguous — no clarification needed."
    : "All requirements are now clear.";
  return `## ✅ Lumen — Requirements Clear\n\n${intro} Here is the technical draft, ready to be fed to the Coding Agent:\n\n---\n\n${doc}`;
}

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Lumen Agent running on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: POST /webhook/linear`);
  console.log(`   Expose with: ngrok http ${PORT}\n`);
});
