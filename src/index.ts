import "dotenv/config";
import express, { Request, Response } from "express";
import { verifyLinearSignature } from "./auth";
import { State, TicketState } from "./state";
import { fileExistsInRepo } from "./github";
import { postComment } from "./linear";

const app = express();

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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  State.set(ticketId, state);

  checkClaudeMd(ticketId).catch((err) => {
    console.error(`[Lumen] Failed to check CLAUDE.md for ${ticketId}:`, err);
  });
}

// ── Step 1: check the repo has a root CLAUDE.md ──────────────────────────────
async function checkClaudeMd(ticketId: string) {
  const exists = await fileExistsInRepo("CLAUDE.md");

  if (!exists) {
    State.transition(ticketId, "claude_md_missing");
    await postComment(ticketId, "I don't see any CLAUDE.md files, please add.");
    console.log(`[Lumen] CLAUDE.md missing for ${ticketId} — comment posted`);
    return;
  }

  State.transition(ticketId, "claude_md_found");
  console.log(`[Lumen] CLAUDE.md found for ${ticketId} — no action taken`);
}

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Lumen Agent running on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: POST /webhook/linear`);
  console.log(`   Expose with: ngrok http ${PORT}\n`);
});
