# Lumen — Requirement Intelligence Agent
> **"Illuminating requirements before a single line of code is written."**

---

## 1. What is Lumen?

Lumen is an AI-powered requirement intelligence agent. Its name comes from the Latin word for *light* — requirements arrive dark, full of ambiguity, gaps, and hidden conflicts. Lumen illuminates them.

Lumen acts as a bridge between the **product owner / client** and the **development team**. It sits at the very beginning of the development pipeline, before any code is written, and ensures that every requirement is:

- Fully understood
- Free of ambiguity
- Cross-validated against the existing codebase
- Cross-validated against Figma designs
- Enriched with edge cases the product owner may not have considered

The final output of Lumen is a **structured technical document** that feeds directly into the **Coding Agent** (the downstream agent that writes code, creates branches, and opens pull requests).

---

## 2. The Problem Lumen Solves

In a typical development workflow:

1. Client or product owner writes a requirement
2. Requirement is handed to the development team
3. Developers start building
4. **Midway through development**, open questions and edge cases surface
5. Work stops, clarifications are sought, rework begins

This is expensive, slow, and avoidable.

Lumen intercepts at step 2 — before development starts — and systematically surfaces every open question, gap, conflict, and edge case. By the time a developer receives the requirement, it is complete.

---

## 3. Agent Name

| Property | Value |
|---|---|
| **Name** | Lumen |
| **Origin** | Latin — *light* / scientific unit of luminous flux |
| **Metaphor** | Requirements arrive dark (ambiguous). Lumen illuminates them before code is written. |

---

## 4. Pipeline Position

Lumen is the **first agent** in a two-agent pipeline:

```
Client / Product Owner
        │
        │  Requirement document
        ▼
┌─────────────────────────┐
│         LUMEN           │
│  Requirement Agent      │
│                         │
│  · Codebase analysis    │
│  · Figma audit          │
│  · UX edge cases        │
│  · Conflict detection   │
│  · Iterative Q&A loop   │
└───────────┬─────────────┘
            │  Technical document
            ▼
┌─────────────────────────┐
│      CODING AGENT       │
│                         │
│  · Branch creation      │
│  · Code changes         │
│  · Pull request         │
└─────────────────────────┘
```

---

## 5. How Lumen Works — End to End

### Phase 1 — Ingestion
Lumen receives the requirement document from the product owner or client. At the same time it loads:
- The **CLAUDE.md hierarchy** (codebase index — see Section 6)
- The **Figma design references** (connection method TBD — see Section 8)

### Phase 2 — Analysis
Lumen runs four parallel analysis passes against the requirement:

| Analyser | What it does |
|---|---|
| **Codebase navigator** | Navigates the CLAUDE.md hierarchy top-down, identifying which modules are relevant to the requirement and detecting conflicts between the new requirement and existing system flows |
| **Figma mismatch detector** | Two-way audit: flags requirements with no matching Figma screen, and Figma screens with no matching requirement |
| **UX edge case generator** | Applies UX best practices to surface edge cases the requirement does not address (empty states, scale, error states, interaction behaviour) |
| **Conflict detector** | Cross-references the new requirement against existing codebase flows to detect integration conflicts, data model clashes, and behavioural inconsistencies |

### Phase 3 — Question Generation
All four analysers produce questions. Lumen consolidates and groups them by category:
- Requirement gaps
- UX edge cases
- Figma mismatches
- Codebase conflicts

Questions are posted to the product owner.

### Phase 4 — Iterative Q&A Loop
The product owner reviews and answers the questions. Lumen evaluates each answer:
- **Answer is specific and actionable** → question resolved
- **Answer is vague** (e.g. "TBD", "as per standard") → Lumen generates a follow-up question

This loop continues until Lumen is satisfied that all questions are resolved.

### Phase 5 — Technical Document Generation
Once all questions are resolved, Lumen generates a structured technical document (see Section 9). This document is the handoff artefact to the Coding Agent.

---

## 6. Codebase Navigation — CLAUDE.md Hierarchy

Reading an entire codebase for every requirement analysis is token-prohibitive. Lumen instead navigates a pre-built hierarchical index of `CLAUDE.md` files embedded within the codebase.

### Structure

```
/project-root
├── CLAUDE.md                        ← Master index (system overview, tech stack, module map)
├── /auth
│   ├── CLAUDE.md                    ← Auth flows: login, registration, session, OAuth
│   └── /oauth
│       └── CLAUDE.md                ← OAuth detail: providers, token handling, account linking
├── /ui
│   ├── CLAUDE.md                    ← UI: component library, design system, patterns
│   └── /components
│       └── CLAUDE.md                ← Component behaviours, props, edge cases
├── /api
│   └── CLAUDE.md                    ← API contracts, endpoints, error codes, rate limits
└── /db
    └── CLAUDE.md                    ← Data models, relationships, constraints
```

### Navigation Strategy

| Step | Action | Token cost |
|---|---|---|
| 1 | Read master `CLAUDE.md` — identify relevant modules | Low |
| 2 | Read module-level `CLAUDE.md` files for flagged modules only | Medium |
| 3 | Drill into sub-module `CLAUDE.md` files if conflict detected | Low–Medium |
| 4 | Raw source files are never read | Zero |

### What a CLAUDE.md file should contain

Each `CLAUDE.md` file should describe:
- **Purpose** — what this module does
- **Key flows** — the main user or system flows handled here
- **Data models** — the key data structures, fields, and relationships
- **Dependencies** — what other modules this one depends on
- **Edge cases** — known edge cases or gotchas in this module
- **Constraints** — things that must not be changed or broken

---

## 7. Four Analysers — Detail

### 7.1 Codebase Navigator

- Reads the `CLAUDE.md` hierarchy top-down
- Identifies which modules are touched by the new requirement
- For each touched module, checks whether the new requirement introduces a conflict with existing documented behaviour

**Example:**
> Requirement: Add Google Sign-In to the login page
>
> Navigator reads `/auth/CLAUDE.md` → finds: "Users register with email + password. Email is the unique identifier."
>
> Navigator reads `/auth/oauth/CLAUDE.md` → finds: no account-linking logic exists
>
> **Conflict detected:** A user who previously registered with email/password may attempt Google Sign-In with the same email. No resolution logic exists.
>
> **Question generated:** If a user signs in with Google using an email that already exists as a password-based account, should accounts be merged, linked, or should an error be shown?

---

### 7.2 Figma Mismatch Detector

Performs a two-way audit between the requirement document and the Figma design files.

**Direction 1 — Requirement → Figma:**
For every screen or flow described in the requirement, check whether a matching Figma screen exists.
- Match found → OK
- No match → **Flag:** "This requirement refers to a screen that is not present in Figma"

**Direction 2 — Figma → Requirement:**
For every screen in Figma, check whether it maps to a stated requirement.
- Match found → OK
- No match → **Flag:** "This Figma screen has no corresponding requirement — is it in scope?"

> **Note:** The method by which Lumen accesses Figma designs (API, plugin, or export) is not yet defined. This is marked as TBD and will be resolved in Phase 2 of the production roadmap.

---

### 7.3 UX Edge Case Generator

Applies a built-in library of UX best practices to each UI element described in the requirement. Generates questions about states and interactions that are typically missing from high-level requirement documents.

**Example edge cases by UI element:**

| UI element | Edge cases Lumen checks |
|---|---|
| Dropdown / select | Empty state, 100+ items (search?), placeholder text, disabled state, mobile behaviour |
| Form fields | Validation messages, character limits, paste behaviour, autofill, error recovery |
| Auth flows | Account conflict, session expiry, concurrent sessions, password reset edge cases |
| Lists / tables | Empty state, loading state, pagination vs infinite scroll, sort/filter persistence |
| Modals / dialogs | Scroll behaviour, mobile sizing, background scroll lock, escape key, back button |

**Example:**
> Requirement: "Show a list of options in a dropdown."
>
> Questions generated:
> - What should appear if the list is empty — hide the dropdown or show a "no results" message?
> - If there are more than 100 items, should a search field appear inside the dropdown?
> - What is the placeholder text when no option is selected?

---

### 7.4 Conflict Detector

Cross-references the new requirement against existing system flows, data models, and integrations documented in the CLAUDE.md hierarchy. Identifies:
- **Integration conflicts** — new feature clashes with existing feature
- **Data model clashes** — new data requirements conflict with existing schema
- **Shared resource contention** — new feature competes for a resource already in use
- **Behavioural inconsistencies** — new feature behaves differently from analogous existing features

**Example:**
> Requirement: Add Google Sign-In
>
> Existing system: Email is used as a unique identifier across user accounts
>
> Conflict: Google Sign-In may introduce duplicate email registrations if a user already has a password-based account with the same email
>
> Question: What should happen when a Google Sign-In email matches an existing password-based account?

---

## 8. Figma Integration

The connection method between Lumen and Figma is **not yet decided**. Options under consideration:

| Option | Description | Pros | Cons |
|---|---|---|---|
| Figma REST API | Lumen calls the Figma API to read file structure and screen metadata | Real-time, no manual step | Requires OAuth setup, API access |
| Figma plugin | A custom plugin exports structured data from Figma on demand | Flexible, can export rich data | Requires plugin development |
| Manual export / upload | Designer exports Figma frames and uploads them to Lumen | Simple to implement | Manual step, not real-time |

**Decision:** Defer to Phase 2 of the production roadmap. Build Lumen's Figma mismatch detector with a clean interface so the connection method can be swapped in without changing the analysis logic.

---

## 9. Technical Document Output

Once all questions are resolved, Lumen produces a structured technical document. This is the handoff artefact to the Coding Agent.

### Sections

| Section | Contents |
|---|---|
| **Disambiguated requirement** | Original requirement rewritten with all ambiguities resolved and all decisions recorded |
| **Acceptance criteria** | Testable, specific criteria derived from the Q&A loop |
| **Affected modules** | List of codebase modules impacted, sourced from CLAUDE.md navigation |
| **Figma references** | Screen-by-screen mapping between requirement sections and Figma frames |
| **Technical risk notes** | Conflicts and integration concerns identified during codebase analysis |
| **Open decisions log** | All decisions made during Q&A, with rationale, for audit trail |

### Format

The technical document should be output as structured **Markdown** or **JSON** — whichever format the Coding Agent is configured to accept as input.

---

## 10. Q&A Loop — Sufficiency Rules

Lumen considers a question **resolved** when the answer is:
- Specific (not "TBD" or "as per standard")
- Actionable (a developer can implement from this answer without further clarification)
- Non-contradictory (does not conflict with another answer already given)

If any of these conditions fail, Lumen generates a follow-up question and the loop continues.

---

## 11. Human-in-the-Loop Principles

Lumen never makes product decisions autonomously. It:
- **Asks** — never assumes
- **Flags** — never resolves conflicts without human input
- **Documents** — every decision made during the Q&A loop is logged with rationale
- **Defers** — if a question cannot be resolved with the information available, it escalates rather than guesses

---

## 12. Tech Stack (POC)

| Component | Technology | Notes |
|---|---|---|
| Agent server | TypeScript + Express.js | Stateless HTTP server |
| LLM | Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Requirement analysis, question generation, sufficiency evaluation |
| Codebase index | CLAUDE.md hierarchy (Markdown files) | Pre-authored per module; navigated top-down |
| Figma integration | TBD | Connection method defined in Phase 2 |
| State | In-memory Map | Replaced with Firestore in production |
| Output format | Structured Markdown / JSON | Compatible with Coding Agent input |

---

## 13. Current Limitations (POC)

| Limitation | Problem | Production fix |
|---|---|---|
| CLAUDE.md maintenance | Files must be authored and kept up to date manually | Automate via CI/CD step on every merge to main |
| Figma integration | Access method not yet defined | Evaluate Figma REST API vs plugin vs export in Phase 2 |
| No persistent state | Q&A session state lost on restart | Replace with Firestore keyed by requirement ID |
| No role-based approval | Any user can answer questions and trigger output | Validate responder role via platform API |
| Single-pass Figma analysis | Cannot detect partial mismatches within a screen | Deeper Figma parsing with component-level diffing |
| In-line processing | Analysis runs synchronously in the request handler | Move to async job queue with retries |

---

## 14. Path to Production

| Phase | Deliverable |
|---|---|
| Phase 1 | Core agent: requirement ingestion + CLAUDE.md codebase analysis + question generation (all 4 categories) |
| Phase 2 | Figma integration: define and implement connection method |
| Phase 3 | Iterative Q&A loop with sufficiency evaluation |
| Phase 4 | Persistent state: Firestore-backed session per requirement |
| Phase 5 | Technical document generator: structured output |
| Phase 6 | Coding Agent handoff: technical document passed as structured input |
| Phase 7 | Hardening: monitoring, alerting, role-based approval, audit trail |

---

## 15. Relationship to the Coding Agent

Lumen is the upstream agent in a two-agent pipeline. The **Coding Agent** (documented separately) takes the technical document produced by Lumen and:

1. Creates a Git branch
2. Applies file changes via the GitHub API
3. Opens a pull request
4. Posts the PR link back to the ticketing system

Lumen ensures the Coding Agent receives a complete, unambiguous specification — eliminating the open questions that would otherwise surface during implementation.

---

## 16. Example End-to-End Walkthrough

**Requirement received:**
> "Add Google Sign-In to the login page."

**Lumen analysis:**

*Codebase conflict detected (from `/auth/CLAUDE.md`):*
> Users currently register with email + password. Google Sign-In may introduce duplicate email conflicts. No account-linking logic exists.

*Figma mismatch detected:*
> No Google Sign-In screen found in Figma. Login page exists but only shows email/password fields.

*UX edge cases generated:*
> - What happens on the login page if the user has no Google account?
> - Should the Google Sign-In button appear above or below the existing form?
> - What is the error state if Google authentication fails?

**Questions posted to product owner:**
1. If a user signs in with Google using an email that already exists as a password-based account — should accounts be merged, linked, or should an error be shown?
2. The Google Sign-In screen is not present in Figma. Should one be added, or should the existing login page be updated?
3. What should appear if Google authentication fails — a generic error, or a specific message?
4. Should the Google Sign-In button appear above or below the email/password form?

**Product owner answers → Lumen generates technical document → Coding Agent receives clean specification.**

---

*Lumen — built to illuminate, not to assume.*