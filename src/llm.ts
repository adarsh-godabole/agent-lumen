import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
const MODEL = "llama-3.1-8b-instant";

export interface ConversationTurn {
  from: "lumen" | "human";
  text: string;
}

async function askJSON(systemPrompt: string, userMessage: string): Promise<any> {
  const response = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  try {
    return JSON.parse(raw);
  } catch {
    const stripped = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(stripped);
  }
}

function formatConversation(log: ConversationTurn[]): string {
  return log
    .map((turn) => `${turn.from === "lumen" ? "Lumen" : "Product Owner"}: ${turn.text}`)
    .join("\n\n");
}

export interface TaskEvaluation {
  clear: boolean;
  questions: string[];
}

/**
 * Phase 3: evaluate the task against CLAUDE.md. Decide whether it is clear enough
 * to act on, or ambiguous. If ambiguous, return up to 3 prioritized clarifying
 * questions (most blocking first). If clear, return an empty list.
 */
export async function evaluateTask(
  title: string,
  description: string,
  claudeMdContent: string
): Promise<TaskEvaluation> {
  const systemPrompt = `You are Lumen, a requirement-intelligence agent. You are talking to a Project Manager (PM) who is NOT technical and has no knowledge of the codebase — its variables, APIs, data models, or internal architecture.

Your job for a newly submitted task is a TWO-STEP decision:

STEP 1 — Judge ambiguity. Read the task description and decide if it is:
  (a) CLEAR — enough detail to act on immediately without guessing, OR
  (b) AMBIGUOUS — missing details, conflicting information, or open-ended in a way that could lead to the wrong thing being built.

STEP 2 — Act on that judgement:
  - If CLEAR: ask NOTHING. Return an empty "questions" array. Do NOT invent questions just to seem thorough. Simple, well-specified tasks must pass through with zero questions.
  - If AMBIGUOUS: return between 1 and 3 clarifying questions, ordered so the single most blocking/important question is first. Ask only as many as you genuinely need — if one question resolves it, ask one. NEVER return more than 3.

You are given the codebase's CLAUDE.md documentation. Use it ONLY as background to spot where the task is ambiguous or conflicts with how the product behaves today. NEVER surface anything from CLAUDE.md in a question — no file names, variable names, function names, API endpoints, "state", "backend", "frontend", or database/schema terms. Phrase every question in plain business/product language about what the user should see or experience — like a business analyst interviewing a client, not an engineer interviewing a tech lead.

Question quality rules:
- Grounded in a real gap in THIS task — never generic boilerplate ("what about edge cases?", "how should errors be handled?").
- Never about implementation ("should we update the state?", "new API call or reuse existing?").
- Answerable with a plain-language decision a non-technical PM can make confidently.

Examples (from real scenarios):
- Task "Update the footer copyright year to 2026 on the website." → CLEAR → { "clear": true, "questions": [] }
- Task "Improve the login page." → AMBIGUOUS → { "clear": false, "questions": ["Which aspect of the login page should improve — its look and feel, how fast it loads, or how secure it is?", "Is there a design or reference to follow?", "Is there a deadline or priority for this?"] }
- Task "Add a new payment method to checkout, probably by next sprint." → AMBIGUOUS but mostly one gap → { "clear": false, "questions": ["Which payment method(s) should be added — for example UPI, PayPal, or Apple Pay?"] }

Respond with ONLY valid JSON:
{ "clear": true|false, "questions": ["..."] }
When clear is true, questions MUST be an empty array. When clear is false, questions MUST have 1 to 3 items. No markdown, no backticks, raw JSON only.`;

  const userMessage = `<task>
<title>${title}</title>
<description>${description || "(no description provided)"}</description>
</task>

<claude_md>
${claudeMdContent}
</claude_md>

Evaluate the task.`;

  const parsed = await askJSON(systemPrompt, userMessage);
  const clear = parsed.clear === true;
  let questions: string[] = Array.isArray(parsed.questions) ? parsed.questions.filter(Boolean) : [];
  // Enforce the hard business rules regardless of what the model returned.
  if (clear) questions = [];
  else questions = questions.slice(0, 3);
  return { clear: clear || questions.length === 0, questions };
}

/** Phase 5: generate the structured technical document handed off to the Coding Agent. */
export async function generateTechnicalDocument(
  title: string,
  description: string,
  claudeMdContent: string,
  conversationLog: ConversationTurn[]
): Promise<string> {
  const systemPrompt = `You are Lumen, a requirement-intelligence agent. The Q&A with the product owner is complete. Produce a structured technical document as Markdown, to be handed off to a Coding Agent. Include these sections:

## Disambiguated Requirement
The original requirement rewritten with all ambiguities resolved and all decisions recorded.

## Acceptance Criteria
Testable, specific criteria derived from the Q&A.

## Affected Modules
Modules impacted, based on the CLAUDE.md content provided.

## Technical Risk Notes
Conflicts or integration concerns identified during analysis.

## Open Decisions Log
Every decision made during the Q&A, with rationale.

Respond with ONLY the Markdown document — no JSON, no code fences around the whole thing.`;

  const userMessage = `<requirement>
<title>${title}</title>
<description>${description || "(no description provided)"}</description>
</requirement>

<claude_md>
${claudeMdContent}
</claude_md>

<conversation>
${formatConversation(conversationLog)}
</conversation>

Generate the technical document.`;

  const response = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
