# Handoff: Requirement Analysis Agent

## Context

This document is a briefing for building a **new standalone agent** — a Requirement Analysis Agent. It is modelled on an existing AI Coding Agent (reference repo: `https://github.com/adarsh-godabole/ticketing-agent`). Read that codebase first — the new agent reuses its architecture almost entirely.

---

## What the Reference Agent Does

The existing agent automates Linear ticket → GitHub PR:

1. Linear ticket assigned to bot → webhook fires
2. Agent fetches GitHub codebase, calls Groq LLM, proposes code changes
3. Posts proposal as Linear comment
4. Human comments `/approve` or `/reject`
5. Agent creates branch, applies changes, opens PR

**Reference stack:**
- TypeScript + Express (webhook server)
- Groq API / LLaMA 3.1 (LLM)
- Linear SDK (webhook receiver + comment posting)
- HMAC-SHA256 (webhook signature verification)
- In-memory Map (state machine per ticket)
- Deployed on Render (free tier)

---

## What the New Agent Does

A **Requirement Analysis Agent** — same bot user on Linear, separate repo and server.

### Pipeline (to be finalised with the user)

```
Linear ticket assigned to bot
        ↓
Agent reads ticket (title + description)
        ↓
LLM analyses requirements and generates clarifying questions
        ↓
Questions posted as a Linear comment
        ↓
Human answers in the comments
        ↓
Agent reads the answers, may ask follow-up questions
        ↓
Once satisfied, agent posts a structured "Requirements Summary" comment
```

### Key Differences from the Reference Agent

| Aspect | Reference Agent | This Agent |
|---|---|---|
| GitHub integration | Yes (fetch files, create branch, open PR) | **No** — remove entirely |
| State machine | awaiting_proposal → awaiting_approval → implementing → done | awaiting_questions → awaiting_answers → (follow-up?) → summarised |
| LLM prompt | Code analysis + diff generation | Requirements analysis + question generation |
| Trigger | Ticket assigned to bot | Same |
| Approval keyword | `/approve` / `/reject` | TBD — e.g. `/done` to close the loop |

---

## What to Reuse Verbatim

Copy these files from the reference repo and modify minimally:

- `src/index.ts` — Express server + webhook routing (remove GitHub-related imports and handlers)
- `src/auth.ts` — HMAC-SHA256 signature verification (no changes needed)
- `src/linear.ts` — Linear comment posting (no changes needed)
- `src/state.ts` — State machine (update `TicketStatus` type and state transitions)
- `render.yaml` — Render deployment config (update service name)
- `.env.example` — Remove `GITHUB_*` vars, keep the rest
- `tsconfig.json` — No changes needed
- `package.json` — Remove `@octokit/rest` dependency, keep everything else

---

## What to Build Fresh

- `src/claude.ts` — New LLM prompt focused on requirement analysis and question generation
  - Input: ticket title + description + conversation history (previous answers)
  - Output: list of clarifying questions OR a final requirements summary
- State machine transitions in `src/state.ts`:
  - `awaiting_questions` → `questions_posted` → `awaiting_answers` → `summarised`
- Comment parsing in `src/index.ts` to detect when the human has answered and trigger follow-up or summary

---

## Environment Variables Needed

```env
GROQ_API_KEY=gsk_...
LINEAR_API_KEY=lin_api_...
LINEAR_AGENT_USER_ID=...         # same bot user as the reference agent
LINEAR_WEBHOOK_SECRET=...        # new secret — create a new webhook in Linear for this server
PORT=3000
```

No `GITHUB_*` variables.

---

## Deployment

Same as the reference agent — deploy to **Render** (free tier):
1. Push to a new GitHub repo
2. Connect to Render → New Web Service
3. Add env vars in Render dashboard
4. Create a **new webhook in Linear** pointing to the new Render URL + `/webhook/linear`
   - Same bot user, different webhook URL and secret
   - Resources: Issues + Comments

---

## Open Questions for the User

Before writing code, clarify:

1. Should the agent ask all questions in one comment, or one question at a time?
2. How many follow-up rounds are allowed before it forces a summary?
3. What keyword does the human use to signal "I'm done answering" — or does the agent decide automatically?
4. Should the requirements summary follow a specific structure (e.g. user stories, acceptance criteria)?
5. Should the agent also label or update the Linear ticket status when done?
