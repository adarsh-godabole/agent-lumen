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

/** Phase 3: analyse the requirement against CLAUDE.md and generate the single most important clarifying question. */
export async function generateQuestion(
  title: string,
  description: string,
  claudeMdContent: string
): Promise<string | null> {
  const systemPrompt = `You are Lumen, a requirement-intelligence agent. You are having a conversation with a Product Manager who is NOT technical and has no knowledge of the codebase, its variables, APIs, data models, or internal architecture.

You are given the codebase's CLAUDE.md documentation. Use it ONLY as background knowledge to figure out where the requirement is ambiguous or conflicts with how the product currently behaves. NEVER surface anything from CLAUDE.md directly in a question — no file names, variable names, function names, API endpoints, "state", "backend", "frontend", database/schema terms, or any other implementation vocabulary.

Translate every technical concern into a plain business/product question about what the user should see or experience. Think like a business analyst interviewing a client, not an engineer interviewing a tech lead.

You will have a chance to ask more questions later, one at a time, so do not try to cover everything now. Identify every real gap, then ask ONLY the single most important one — the one whose answer would most affect the design or scope of the feature.

Rules for a good question:
- Ask about product behavior and business rules, never about implementation (no "should we update the state", "should this be computed client-side or via a new API call", "should we change the POST payload").
- The question must be grounded in a real gap between the requirement and how the product behaves today — never generic boilerplate that would apply to any feature.
- Do not ask about anything the requirement already answers.
- If there is truly no meaningful gap, return null.
- The question should be answerable with a plain-language decision a non-technical stakeholder can make confidently.

Bad (technical, references code/implementation — never do this):
- "Should the quarterly count reuse the existing client-side submissions list, or does it need a new API call?"

Bad (vague, generic, not grounded in this requirement):
- "What should happen in edge cases?"

Good (plain business language, grounded in the actual requirement):
- "The requirement doesn't say which months make up the first quarter — does your fiscal year start in January, or does it follow a different calendar?"

Respond with ONLY valid JSON:
{ "question": "the single question" }
or, if there is no meaningful gap:
{ "question": null }
No markdown, no backticks, raw JSON only.`;

  const userMessage = `<requirement>
<title>${title}</title>
<description>${description || "(no description provided)"}</description>
</requirement>

<claude_md>
${claudeMdContent}
</claude_md>

Generate the single most important clarifying question.`;

  const parsed = await askJSON(systemPrompt, userMessage);
  return parsed.question ?? null;
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
