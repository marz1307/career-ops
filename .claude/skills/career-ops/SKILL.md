---
name: career-ops
description: "AI-powered job search and application pipeline. Scans portals (LinkedIn, Indeed, Glassdoor, Greenhouse, Ashby, Lever, Workable, Welcome to the Jungle, Handshake, Reed UK), scores postings against the candidate's profile with A–G blocks, drafts tailored CVs and cover letters, runs interview prep with STAR+R stories, and logs everything to a Notion Applications tracker (auto-created on first run) plus a Notion dashboard view. The agent NEVER auto-submits — it stops before Submit/Send/Apply and waits for human approval. TRIGGER when the user types /career-ops, pastes a job URL, asks to scan job portals, requests a tailored CV or cover letter for a specific role, asks for interview prep for a named company, asks about application status, pipeline, or tracker, or mentions job search, job hunt, applications, recruiter, ATS, or career change. On first run the skill enters onboarding and prompts for CV upload, LinkedIn URL, portfolio URL, target job markets, target roles, scan hour, Bright Data API key, and Notion integration token; then bootstraps the user-layer files, auto-creates the Notion Applications database with the canonical schema, and adds kanban plus by-stage dashboard views. SKIP for general resume formatting questions unrelated to a live job search, or for non-career-related work."
user-invocable: true
argument-hint: "[scan | oferta | ofertas | pdf | apply | batch | tracker | pipeline | contacto | deep | interview-prep | training | project | patterns | followup | setup]"
license: MIT
---

# Career-Ops — AI Job Search Pipeline

## What this skill does

A complete job-search pipeline that runs inside Claude Code:

```
scan portals → score postings (A–G) → draft tailored CV + cover letter → human approves → submit (you click) → Notion tracker logs everything
```

The agent **never auto-submits**. It fills forms, drafts answers, generates PDFs, prepares cover letters — but always stops before Submit / Send / Apply and waits for the user to confirm.

## When invoked

This skill is the canonical entry point for everything career-ops does. Default response to:

- The user types `/career-ops` (with or without arguments).
- The user pastes a job URL or JD into the chat.
- The user asks to "scan jobs", "find roles", "tailor my CV", "draft a cover letter", "evaluate this job", "prep for an interview at X", "show my pipeline", "log this application".

## Step 0 — Detect the repo

The skill operates inside a clone of the `career-ops` repo. On first invocation, verify the current working directory contains:

- `CLAUDE.md` mentioning "Career-Ops"
- `package.json` with `"name": "career-ops"`
- `modes/_shared.md`
- `templates/portals.example.yml`

If any of these are missing, the user is not in the repo. Print:

> "I don't see the career-ops repo here. Clone it with:
>
> ```
> git clone https://github.com/santifer/career-ops
> cd career-ops
> npm install
> ```
>
> Then type `/career-ops` again."

Stop. Do not proceed.

## Step 1 — Onboarding check

Silently check whether the user-layer files exist:

| Required file / state | If missing |
|---|---|
| `cv.md` | Enter onboarding (Step 2). |
| `config/profile.yml` | Enter onboarding (Step 2). |
| `modes/_profile.md` | Copy `modes/_profile.template.md` → `modes/_profile.md` silently. |
| `portals.yml` | Enter onboarding (Step 2). |
| `.env` with `NOTION_TOKEN` | Enter onboarding (Step 2). |
| `config/profile.yml → notion.applications_db_id` | Enter onboarding (Step 2). |

If ALL of the above exist, jump to Step 6 (route the user's request).

## Step 2 — Onboarding: collect inputs

If the user typed `/career-ops` with no arguments, OR they're missing user-layer files, OR they typed `/career-ops setup` / `/career-ops onboarding`, run the AskUserQuestion onboarding flow.

Use **AskUserQuestion** to collect the onboarding inputs. Frame it as:

> "Welcome to career-ops. To set up your personal pipeline I need a few things. You can answer all eight in one go."

Ask these eight questions in a single AskUserQuestion call (the AskUserQuestion tool caps at 4 questions per call, so split into two consecutive batches: 1–4 first, then 5–8):

1. **CV** — `header: "Your CV"`. Multi-select: false. Options:
   - "Paste my CV text in the next message"
   - "Give me a file path (PDF / DOCX / MD) on this machine"
   - "Use my LinkedIn profile only"
   - "Draft from scratch — I'll answer questions"

2. **LinkedIn** — `header: "LinkedIn"`. Multi-select: false. Options:
   - "I'll paste my LinkedIn URL in the next message"
   - "I don't have a LinkedIn / skip"

3. **Portfolio** — `header: "Portfolio"`. Multi-select: false. Options:
   - "I'll paste my portfolio / personal site URL in the next message"
   - "I'll paste my GitHub URL in the next message"
   - "Skip — no portfolio"

4. **Target markets** — `header: "Markets"`. Multi-select: **true**. Options:
   - "United Kingdom"
   - "European Union (broad)"
   - "United States"
   - "Remote (any region)"
   (let the user pick more than one or type "Other" for a custom region)

5. **Target roles** — `header: "Target roles"`. Multi-select: false. Options:
   - "I'll list my target role titles in the next message (e.g. 'Senior Backend Engineer, Staff Platform Engineer')"
   - "Infer from my CV"

6. **Bright Data API key** — `header: "Bright Data"`. Multi-select: false. Options:
   - "I have a Bright Data API key — I'll paste it in the next message"
   - "Skip — fall back to free ATS endpoints only (Greenhouse / Ashby / Lever / Workable)"
   - "What's Bright Data? Explain first"

7. **Notion integration** — `header: "Notion"`. Multi-select: false. Options:
   - "I have a Notion integration token — I'll paste it next"
   - "Walk me through creating one"
   - "Skip Notion — use local tracker only"

8. **Scan schedule** — `header: "Run time"`. Multi-select: false. Options:
   - "07:00 local — catch overnight postings before recruiters open inboxes"
   - "12:30 local — lunchtime sweep"
   - "18:00 local — end-of-day catch-up"
   - "Custom — I'll specify the hour next"
   - "Don't schedule — I'll run scans manually"

If the user picks "Explain first" on Bright Data, tell them:

> "Bright Data is a web-data service. With a key, the scanner can hit LinkedIn, Indeed, Glassdoor, and Welcome to the Jungle through a real browser (more coverage, more reliable). Without a key, the scanner falls back to free ATS JSON endpoints (Greenhouse, Ashby, Lever, Workable). Sign up at https://brightdata.com if you want one. You can always add the key later."

If the user picks "Walk me through" on Notion:

> "1. Go to https://www.notion.com/profile/integrations and click 'New integration'. Name it 'career-ops', leave capabilities at the defaults (Read/Update/Insert content). Click Save.
> 2. Copy the 'Internal Integration Token' (starts with `ntn_`).
> 3. Pick a Notion page where you want the tracker to live (or create a new one). Open the page, click ··· → Connections → Add connections → select 'career-ops'.
> 4. Paste the token here. Tell me the URL of the parent page so I can create the tracker inside it."

## Step 3 — Onboarding: gather the actual data

After the user answers, prompt them for the actual values in plain chat (one message per item — let them paste). For each one received:

### CV
- Pasted text → write directly to `cv.md` as clean markdown (Summary, Experience, Projects, Education, Skills).
- File path → Read the file, convert to clean markdown, write to `cv.md`. For PDF, use the `pdf` skill or `pdftotext` via Bash.
- LinkedIn only → fetch the LinkedIn page (Bright Data MCP if a key was provided, otherwise WebFetch) and synthesise a CV. Write to `cv.md`.
- Draft from scratch → ask 5–8 targeted questions, then write `cv.md`.

### LinkedIn URL
- Write to `config/profile.yml → candidate.linkedin`.

### Portfolio URL
- Write to `config/profile.yml → candidate.portfolio_url` (or `candidate.github` for GitHub).

### Target markets
- Write to `config/profile.yml → target_markets: [<list>]`.
- Use the list to seed `portals.yml.location_filter.allow` and `always_allow`. Multi-region picks merge their per-region defaults.

### Target roles
- If the user pasted titles → write to `config/profile.yml.target_roles.primary: [<list>]` AND seed `portals.yml.title_filter.positive` from the role keywords.
- If "Infer from CV" → extract role titles from the most recent 2 positions in `cv.md` plus any "Open to" line. Confirm the inferred list with the user before saving.

### Bright Data key
- Provided → write `BRIGHTDATA_API_KEY=<value>` to `.env` (create if missing). Never write to `config/profile.yml`.
- Skipped → leave `.env` as-is.

### Notion token + parent page
- Write `NOTION_TOKEN=<value>` to `.env`.
- Ask for the **parent page URL** (the page where the tracker should live). Extract the page ID from the URL (the 32-char hex string).
- Auto-create the Applications database (see Step 4).

### Scan schedule
- If the user picked a preset hour (07:00 / 12:30 / 18:00) or "Custom", confirm the local timezone (default to `config/profile.yml → location.timezone`) and the cadence (default: weekdays). Write to `config/profile.yml`:
  ```yaml
  schedule:
    scan_hour_local: "07:00"     # 24-hour HH:MM
    timezone: "Europe/London"
    days: [1, 2, 3, 4, 5]        # ISO 1=Mon..7=Sun
  ```
- Then call the `/schedule` skill (if available) to register a recurring `/career-ops scan` at that time. If `/schedule` isn't available, surface a one-line cron / Task Scheduler snippet the user can paste in.
- If the user picked "Don't schedule", skip this step entirely.

### profile.yml essentials
After the CV exists, copy `config/profile.example.yml` → `config/profile.yml` and fill from what the user gave you. Prompt once for:

- Full name + email + phone + location + timezone (one message).
- Salary target range and currency.

Write all of it into `config/profile.yml`.

### portals.yml
Copy `templates/portals.example.yml` → `portals.yml`. Update `title_filter.positive` from the target-role keywords and `location_filter` from the target markets.

### modes/_profile.md
If missing, copy `modes/_profile.template.md` → `modes/_profile.md`.

### article-digest.md
Ask one optional question:

> "Have you published any projects / articles / case studies I should know about? Paste links or descriptions and I'll add them to your proof points. Skip if not."

If they give content, write it to `article-digest.md`.

## Step 4 — Auto-create the Notion Applications tracker

This is required for the full workflow. The schema mirrors the canonical one in `modes/notion-tracker.md`.

### Step 4a — Create the database

Call `notion-create-database` with:
- `parent.page_id` = the page ID the user gave you.
- `title` = "🎯 Applications" (or whatever the user named it).
- `properties` = the full schema below. Use the Notion MCP server (`mcp__*notion-create-database` — load via ToolSearch if deferred).

**Canonical schema** (all properties — the Notion MCP accepts this as the `properties` payload):

| Property name | Notion type | Options / config |
|---|---|---|
| Company | title | — |
| Job URL | url | — |
| Position | multi_select | "Analytics Engineer", "Data Scientist", "Data Engineer", "Backend Engineer", "AI Engineer", "Product Manager" (seed from `target_roles`; user adds more later) |
| Source portal | select | "LinkedIn", "Indeed", "Glassdoor", "Welcome to the Jungle", "Handshake", "Greenhouse", "Ashby", "Lever", "Workable", "Reed UK", "Company site", "Other" |
| Country | select | seed from `target_markets` |
| Location | rich_text | — |
| Language | select | "English", "Other" |
| Work model | select | "Remote", "Hybrid", "On-site" |
| Company tier | select | "Tier 1", "Tier 2", "Tier 3" |
| Industry | select | "SaaS", "Fintech", "Healthcare", "E-commerce", "Marketplace", "Consulting", "Other" |
| Seniority | select | "Mid", "Senior", "Lead", "Staff", "Principal", "Head" |
| Recruiter-sim verdict | select | "INVITE", "MAYBE", "REJECT" |
| Match score | number | format `number` |
| Fit notes | rich_text | — |
| JD snapshot | rich_text | — |
| Stage | select | "1. Discovered", "2. Triaged", "3. Drafted", "4. Applied", "5. Assessment/OA", "6. Phone screen", "7. Tech interview", "8. Onsite/Final", "9. Offer", "Signed", "Rejected", "Withdrew", "Not pursuing" |
| CV variant | select | seed from `target_roles` archetypes; "General" as default |
| CL variant | select | "General", "Cover Letter", "Skipped" |
| Discovered date | date | — |
| Apply date | date | — |
| Response date | date | — |
| Next action | rich_text | — |
| Next action date | date | — |
| Recruiter name | rich_text | — |
| Recruiter contact | rich_text | — |
| Salary band | rich_text | — |
| Visa/sponsorship | select | "Required", "Not required", "Unclear" |
| Resume | files | — |
| Cover Letter | files | — |
| Referral? | checkbox | — |
| Application ID | unique_id | prefix "APP" |
| Agent run ID | rich_text | — |

The Notion MCP returns the created `database.id` and `data_source_id`. Write both to `config/profile.yml`:

```yaml
notion:
  applications_db_id: "<32-hex-no-dashes>"
  applications_data_source_id: "<UUID-with-dashes>"
```

### Step 4b — Create the dashboard views

After the database exists, add visualisation views. The Notion MCP exposes `notion-create-view`. Add three:

1. **Pipeline board** (kanban grouped by Stage) — primary view. Card title = Company. Card preview shows Position, Match score, Country.
2. **By score** (table sorted by Match score DESC, filtered to Stage `2. Triaged` / `3. Drafted`) — the user's daily drafting queue.
3. **Active interviews** (board grouped by Stage, filtered to Stages 5–9) — the user's interview cockpit.

If `notion-create-view` is not available in the loaded MCP toolset, fall back to instructing the user:

> "I've created the database. Open it in Notion and add three views manually:
> 1. Board grouped by Stage (your daily kanban).
> 2. Table sorted by Match score DESC, filtered to Stages 2–3 (your drafting queue).
> 3. Board grouped by Stage, filtered to Stages 5–9 (your interview cockpit).
> Or paste the database URL back and I'll add them for you next session."

### Step 4c — Confirm

Print the database URL Notion returned so the user can open it.

## Step 5 — Confirm setup is done

Print a short confirmation:

> "Setup complete. Your user-layer files:
>
> - `cv.md` — your canonical CV
> - `config/profile.yml` — identity, targets, comp, Notion IDs
> - `modes/_profile.md` — archetypes and framing (edit anytime — say 'change my archetypes to X')
> - `portals.yml` — scanner config (target markets + roles applied)
> - `article-digest.md` — proof points
> - `.env` — local secrets (BRIGHTDATA_API_KEY, NOTION_TOKEN)
> - Notion Applications DB at <URL>, with Pipeline / By score / Active interviews views
>
> You can now:
> - Paste a job URL to evaluate it
> - Run `/career-ops scan` to search portals
> - Run `/career-ops pdf` to generate a tailored CV
> - Say 'change my target roles to X' to tweak anything"

Then suggest automation:

> "Want me to scan for new offers on a schedule? Just say 'scan every 3 days' and I'll set up a recurring `/career-ops scan` via `/schedule`."

## Step 6 — Route the user's request

After onboarding (or if it was already done), route based on what the user typed AFTER `/career-ops`:

| User input | Mode |
|---|---|
| URL or JD pasted in chat | auto-pipeline → `modes/auto-pipeline.md` |
| `evaluate <url>` / `oferta <url>` | `modes/oferta.md` |
| `scan` | `modes/scan.md` |
| `pipeline` | `modes/pipeline.md` |
| `pdf` / `cv` | `modes/pdf.md` |
| `apply` / `fill form` | `modes/apply.md` |
| `interview-prep <company>` | `modes/interview-prep.md` |
| `contacto` / `linkedin outreach` | `modes/contacto.md` |
| `deep <company>` / `research <company>` | `modes/deep.md` |
| `tracker` / `status` | `modes/tracker.md` |
| `patterns` | `modes/patterns.md` |
| `followup` | `modes/followup.md` |
| `batch` | `modes/batch.md` |
| `ofertas` / `compare` | `modes/ofertas.md` |
| `training <course>` | `modes/training.md` |
| `project <project>` | `modes/project.md` |
| no args | print the help menu |

For each mode, read the corresponding `modes/<mode>.md` file and follow its instructions. Always read `modes/_shared.md` first (system defaults) then `modes/_profile.md` (user overrides) before executing.

## Ethical rules — non-negotiable

1. **Never auto-submit.** The agent fills forms, drafts answers, generates PDFs — but stops before Submit / Send / Apply.
2. **Honour the score floor.** Applications below `triage.score_floor` (default 70 / 100) go to `Not pursuing`, not drafted.
3. **Quality over speed.** Discourage low-fit applications.
4. **Respect recruiters' time.** Every application a human reads costs someone's attention.
5. **Verify postings are live with Playwright before drafting** (not WebSearch / WebFetch alone). Batch / headless mode is the only exception.

## What this skill does NOT do

- Does not submit applications on behalf of the user.
- Does not impersonate the user in interviews or live recruiter conversations.
- Does not store secrets anywhere except `.env` (gitignored).
- Does not send messages, schedule meetings, or commit code without explicit confirmation.
