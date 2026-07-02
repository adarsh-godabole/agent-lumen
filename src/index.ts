import "dotenv/config";
import express, { Request, Response } from "express";
import { verifyLinearSignature } from "./auth";
import { State, TicketState } from "./state";
import { getFileContent } from "./github";
import { postComment } from "./linear";
import { generateQuestions, evaluateSufficiency, generateTechnicalDocument } from "./llm";

const app = express();
const MAX_ROUNDS = 3;

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
  const agentUserId = process.env.LINEAR_AGENT_USER_ID!;

  // Ignore Lumen's own comments — otherwise it replies to itself forever
  if (comment.userId === agentUserId) return;

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
    await postComment(ticketId, "I don't see any CLAUDE.md files, please add.");
    console.log(`[Lumen] CLAUDE.md missing for ${ticketId} — comment posted`);
    return;
  }

  console.log(`[Lumen] CLAUDE.md found for ${ticketId} — generating questions`);
  State.transition(ticketId, "analysing", { claudeMdContent });
  await runQuestionGeneration(ticketId);
}

// ── Step 2: generate and post clarifying questions ───────────────────────────
async function runQuestionGeneration(ticketId: string) {
  const state = State.get(ticketId)!;
  const questions = await generateQuestions(state.title, state.description, state.claudeMdContent!);

  const commentBody = formatQuestionsComment(questions);
  await postComment(ticketId, commentBody);

  State.transition(ticketId, "awaiting_answers", {
    conversationLog: [{ from: "lumen", text: questions.join("\n") }],
  });
  console.log(`[Lumen] Questions posted for ${ticketId}`);
}

// ── Step 3: evaluate the answer, ask follow-ups, or produce the technical doc ─
async function runEvaluation(ticketId: string, answerText: string) {
  const state = State.get(ticketId)!;
  const conversationLog = [...state.conversationLog, { from: "human" as const, text: answerText }];
  const round = state.round + 1;

  const { sufficient, followUpQuestions } = await evaluateSufficiency(
    state.title,
    state.description,
    conversationLog
  );

  if (sufficient || round >= MAX_ROUNDS) {
    const doc = await generateTechnicalDocument(
      state.title,
      state.description,
      state.claudeMdContent!,
      conversationLog
    );
    await postComment(ticketId, formatSummaryComment(doc));
    State.transition(ticketId, "summarised", { conversationLog, round });
    console.log(`[Lumen] Technical document posted for ${ticketId}`);
    return;
  }

  const followUpLog = [...conversationLog, { from: "lumen" as const, text: followUpQuestions.join("\n") }];
  await postComment(ticketId, formatQuestionsComment(followUpQuestions));
  State.transition(ticketId, "awaiting_answers", { conversationLog: followUpLog, round });
  console.log(`[Lumen] Follow-up questions posted for ${ticketId} (round ${round})`);
}

// ── Comment formatting ───────────────────────────────────────────────────────
function formatQuestionsComment(questions: string[]): string {
  const list = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `## 🔎 Lumen — Clarifying Questions\n\n${list}\n\n---\nPlease reply in a comment with your answers.`;
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
