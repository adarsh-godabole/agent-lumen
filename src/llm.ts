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

/** Phase 3: analyse the requirement against CLAUDE.md and generate clarifying questions. */
export async function generateQuestions(
  title: string,
  description: string,
  claudeMdContent: string
): Promise<string[]> {
  const systemPrompt = `You are Lumen, a requirement-intelligence agent. Analyse the given requirement against the codebase's CLAUDE.md documentation. Identify:
- ambiguities or missing details in the requirement itself
- conflicts between the requirement and existing documented flows/data models

Generate clarifying questions a developer would need answered before implementation. Respond with ONLY valid JSON:
{ "questions": ["question 1", "question 2"] }
No markdown, no backticks, raw JSON only.`;

  const userMessage = `<requirement>
<title>${title}</title>
<description>${description || "(no description provided)"}</description>
</requirement>

<claude_md>
${claudeMdContent}
</claude_md>

Generate the clarifying questions.`;

  const parsed = await askJSON(systemPrompt, userMessage);
  return parsed.questions ?? [];
}

/** Phase 4: evaluate whether the Q&A so far is sufficient, or produce follow-up questions. */
export async function evaluateSufficiency(
  title: string,
  description: string,
  conversationLog: ConversationTurn[]
): Promise<{ sufficient: boolean; followUpQuestions: string[] }> {
  const systemPrompt = `You are Lumen, a requirement-intelligence agent. You previously asked clarifying questions about a requirement, and the product owner has answered. Evaluate whether the conversation now gives enough detail to write a complete technical specification.

An answer is sufficient only if it is:
- Specific (not "TBD" or "as per standard")
- Actionable (a developer could implement from it without further clarification)
- Non-contradictory with other answers already given

If any open question remains unresolved by these rules, generate follow-up questions only for those gaps. Respond with ONLY valid JSON:
{ "sufficient": true|false, "follow_up_questions": ["..."] }
follow_up_questions must be an empty array when sufficient is true. No markdown, no backticks, raw JSON only.`;

  const userMessage = `<requirement>
<title>${title}</title>
<description>${description || "(no description provided)"}</description>
</requirement>

<conversation>
${formatConversation(conversationLog)}
</conversation>

Evaluate sufficiency.`;

  const parsed = await askJSON(systemPrompt, userMessage);
  return {
    sufficient: parsed.sufficient ?? false,
    followUpQuestions: parsed.follow_up_questions ?? [],
  };
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
