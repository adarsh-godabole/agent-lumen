# 🤖 AI Coding Agent — POC

> A fully working proof of concept for an AI-powered coding agent that integrates Linear, GitHub, and an LLM to automate the journey from ticket to pull request — with mandatory human approval at every step.

---

## How It Works

```
Linear ticket assigned to bot
        ↓
Local Express server (via ngrok)
        ↓
Groq/LLaMA fetches GitHub files → proposes code changes
        ↓
Proposal posted as Linear comment (with diff)
        ↓
Human comments /approve
        ↓
Agent creates branch → applies changes → opens PR
        ↓
PR link posted back on Linear ✅
```

---

## Project Structure

```
ticketing-agent/
├── react-app/               # Target codebase the agent reads and modifies
│   ├── src/
│   │   ├── App.tsx
│   │   └── App.css
│   ├── index.html
│   └── package.json
│
└── agent/                   # The AI agent server
    ├── src/
    │   ├── index.ts         # Express server + webhook routing
    │   ├── claude.ts        # LLM (Groq) API call + prompt
    │   ├── github.ts        # Fetch files, create branch, open PR
    │   ├── linear.ts        # Post comments on Linear
    │   ├── state.ts         # In-memory ticket state machine
    │   └── auth.ts          # HMAC-SHA256 signature verification
    ├── .env.example
    ├── package.json
    └── tsconfig.json
```

---

## Tech Stack

| Component | Technology | Role |
|---|---|---|
| Agent server | TypeScript + Express | Webhook listener + pipeline orchestration |
| LLM | Groq API (LLaMA 3.1) | Code analysis and proposal generation |
| Ticketing | Linear | Webhook trigger, comment posting |
| Code hosting | GitHub REST API | Branch creation, file writes, PR opening |
| Tunnel | ngrok | Expose local server to Linear webhooks |
| State | In-memory Map | Ticket state machine (replaces Firestore) |
| Security | HMAC-SHA256 | Webhook signature verification |

---

## Prerequisites

- Node.js 20+
- A [Groq](https://console.groq.com) account (free, no card required)
- A [GitHub](https://github.com) account
- A [Linear](https://linear.app) account
- [ngrok](https://ngrok.com) installed

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/adarsh-godabole/ticketing-agent.git
cd ticketing-agent/agent
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```env
GROQ_API_KEY=gsk_...
GITHUB_TOKEN=github_pat_...
GITHUB_OWNER=adarsh-godabole
GITHUB_REPO=ticketing-agent
LINEAR_API_KEY=lin_api_...
LINEAR_AGENT_USER_ID=...
LINEAR_WEBHOOK_SECRET=...
PORT=3000
```

#### Getting each key

**Groq API Key**
1. Sign up at [console.groq.com](https://console.groq.com)
2. Settings → API Keys → Create key

**GitHub Personal Access Token**
1. GitHub → Settings → Developer settings → Fine-grained tokens
2. Permissions: `Contents` (read/write), `Pull requests` (read/write), `Metadata` (read)

**Linear API Key + User ID**
1. Linear → Settings → API → Personal API keys → Create key
2. Get your user ID:
```bash
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: YOUR_LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ viewer { id name } }"}'
```

### 3. Start the agent

```bash
npm run dev
```

You should see:
```
🚀 AI Coding Agent running on http://localhost:3000
   Webhook endpoint: POST /webhook/linear
```

### 4. Expose with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`)

### 5. Configure Linear webhook

1. Linear → Settings → API → Webhooks → New webhook
2. URL: `https://abc123.ngrok-free.app/webhook/linear`
3. Resources: **Issues** + **Comments**
4. Secret: same value as `LINEAR_WEBHOOK_SECRET` in your `.env`

---

## Running the Demo

1. Create a Linear issue with a title and description
2. Assign the issue to the bot user (the account whose ID is in `LINEAR_AGENT_USER_ID`)
3. Watch the agent terminal — it will fetch files, call Groq, and post a proposal comment
4. Review the proposal on Linear, then comment `/approve`
5. The agent creates a branch, applies the changes, and opens a PR
6. The PR link is posted back on the Linear ticket

### Approval keywords

| Comment | Action |
|---|---|
| `/approve` | Implement the proposal |
| `/reject [feedback]` | Re-analyse with your feedback appended |

---

## Current Limitations (POC)

This is a proof of concept, not production-ready. Known limitations and their production fixes:

| Limitation | Production Fix |
|---|---|
| In-memory state — lost on restart | Replace with GCP Firestore |
| Local server + ngrok | Deploy to GCP Cloud Run |
| Groq free-tier token limits | Switch to Claude Sonnet 4 API |
| Fetches all files (no vector search) | Vertex AI Vector Search index |
| No async job queue | GCP Cloud Tasks with retries |
| No test execution | Jest on Cloud Run Jobs |
| No role-based approval check | Validate Linear user role via API |

---

## Architecture (from Design Doc)

The POC mirrors the 4-layer pipeline described in the technical design document:

| Layer | Trigger | Output |
|---|---|---|
| Layer 1 — Trigger | Linear webhook fires on ticket assignment | State initialised, job queued |
| Layer 2 — Analysis | Agent fetches code + calls LLM | Proposal posted as Linear comment |
| Layer 3 — Implementation | User approves (Gate 1) | Branch created, files changed |
| Layer 4 — Ship | Changes applied | PR opened, Linear comment posted |

---

## Path to Production

- [ ] Replace Groq with Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- [ ] Replace in-memory state with GCP Firestore
- [ ] Deploy agent to GCP Cloud Run
- [ ] Add GCP Cloud Tasks for async job dispatch and retries
- [ ] Build Vertex AI Vector Search index for large codebases
- [ ] Add Jest test execution on Cloud Run Jobs (Gate 2 approval)
- [ ] Monitoring, alerting, and security hardening

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Webhook 401 error | Check `LINEAR_WEBHOOK_SECRET` matches in Linear and `.env` |
| Agent ignores ticket assignment | Check `LINEAR_AGENT_USER_ID` matches the bot's actual Linear user ID |
| Groq token limit error | The codebase context is too large — reduce files fetched in `github.ts` |
| GitHub 422 on branch create | Branch already exists — it will be auto-deleted and recreated |
| ngrok URL changed | Update the webhook URL in Linear → Settings → API → Webhooks |

---

## License

MIT
