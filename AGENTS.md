# Career-Ops — AI Job Search Pipeline

## Origin

Originally built and used by [santifer](https://santifer.io) for AI/automation roles, [career-ops](https://github.com/santifer/career-ops) is an end-to-end job search and application tool. This marketplace build keeps the architecture generic so any candidate can install it as a Claude Code skill and reshape it for their own market and target roles.

## Architecture: who owns what

There are two layers and a strict rule about where personal data goes.

**User Layer (your personalisation — never overwritten by updates):**
- `cv.md` · `config/profile.yml` · `modes/_profile.md` · `article-digest.md` · `portals.yml`
- `writing-samples/` · `interview-prep/`
- `data/*` · `reports/*` · `output/*`

**System Layer (default rules and routing — overrideable via `_profile.md`):**
- `modes/_shared.md` · `modes/oferta.md` and all other mode files
- `AGENTS.md` · `CLAUDE.md` · `*.mjs` scripts · `dashboard/*` · `templates/*` · `batch/*`

**THE RULE: when changing anything candidate-specific (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets, seniority band, confidentiality stance), ALWAYS write to `modes/_profile.md` or `config/profile.yml`. NEVER edit `modes/_shared.md` for personal content.** `_profile.md` reads after `_shared.md` and overrides it. This is the discipline that keeps the override architecture intact.

## What is career-ops

AI-powered job search automation built on Claude Code. End-to-end pipeline: scan job portals → evaluate offers with A–G blocks → draft tailored CV + cover letter → human approves → submit → log everything to the tracker.

### Main files

| File | Function |
|------|----------|
| `cv.md` | Canonical CV. Created during onboarding from the candidate's uploaded CV, LinkedIn, or typed input. |
| `article-digest.md` | Deep proof points beyond the one-page CV — full project inventory, MCP / Claude skills / eval-spec evidence. |
| `config/profile.yml` | Identity, contact, target roles, comp, language preferences, file output conventions, reference CV variants. |
| `modes/_profile.md` | Archetypes, adaptive framing, scoring weights, seniority band, confidentiality calibration, comp scripts, location policy, writing style. **Read first by every mode.** |
| `modes/_shared.md` | System defaults — auto-updatable in upstream, overridden by `_profile.md`. |
| `portals.yml` | Portal scanner config (LinkedIn, Indeed, Greenhouse, Ashby, Lever, Workable, Welcome to the Jungle, Handshake, Reed UK) and tracked companies. |
| `writing-samples/` | `WRITING_STYLE.md` — voice rules for all candidate-facing output. |
| `interview-prep/story-bank.md` | Master STAR+R stories. Appended to by every Block F run. |
| `data/applications.md` | Local tracker cache. Notion is system of record when wired up. |
| `data/pipeline.md` | Inbox of pending URLs to evaluate. |
| `data/scan-history.tsv` | Scanner dedup history. |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`). A–F + G (Posting Legitimacy) + Machine Summary YAML. |
| `templates/cv-template.html` | HTML template for CV rendering. Single-column, ATS-clean. |
| `templates/cv-template.tex` | LaTeX/Overleaf template (alternative). |
| `templates/states.yml` | Canonical application states. |
| `scripts/cv/generate-pdf.mjs` | Playwright HTML → PDF renderer. |
| `scripts/cv/generate-latex.mjs` | LaTeX CV validator + pdflatex compiler. |
| `scripts/scan/scan.mjs` | Zero-token portal scanner — hits Greenhouse/Ashby/Lever/SmartRecruiters APIs directly. |
| `providers/smartrecruiters.mjs` | Scanner provider for SmartRecruiters-backed careers sites (public Posting API). Auto-loaded; enable per company with `provider: smartrecruiters` + `sr_company` in `portals.yml`. |
| `scripts/scan/sponsor-check.mjs` | UK licensed-sponsor lookup for candidates who need UK sponsorship (`config/profile.yml → work_eligibility.needs_uk_sponsorship`). Matches an employer against the local gov.uk register to tell whether it can sponsor a Skilled Worker visa. Drives the `uk-sponsor-licensed` / `uk-sponsor-route-mismatch` / `uk-no-sponsor-licence` tags in `oferta.md` Step 6. |
| `scripts/scan/role-taxonomy.mjs` | Optional, opt-in title-filter/archetype source. Reads `config/role-taxonomy.yml` (copy from `.example.yml`); absent → scanner uses `portals.yml title_filter`. |
| `scripts/metrics/funnel-metrics.mjs` | Real outcome KPIs from the Notion Applications DB (response / screen / rejection rate by portal, country, referral, sponsorship). Needs `NOTION_TOKEN`. |
| `scripts/metrics/caveats-audit.mjs` | Zero-LLM lint over generated CVs / cover letters for `cv-quality-rules.md` violations. |
| `scripts/cv/cv-qa.mjs` | LLM post-draft QA over a generated CV vs the JD + `cv-quality-rules.md`. Runs on the Claude subscription via the `claude` CLI (no API key); skips gracefully if the CLI is unavailable. |
| `scripts/scan/check-liveness.mjs` · `scripts/scan/liveness-core.mjs` · `scripts/scan/liveness-browser.mjs` | Job posting liveness checks. |
| `scripts/tracker/merge-tracker.mjs` · `scripts/tracker/dedup-tracker.mjs` · `scripts/tracker/normalize-statuses.mjs` · `scripts/tracker/verify-pipeline.mjs` | Tracker maintenance scripts. |
| `scripts/metrics/analyze-patterns.mjs` | Pattern analysis on rejection / response data (JSON output). |
| `scripts/metrics/followup-cadence.mjs` | Follow-up cadence calculator (JSON output). |
| `scripts/cv/cv-sync-check.mjs` | Sanity check: cv.md alignment with `profile.yml`. |
| `scripts/doctor.mjs` | Repo health check. |

### Skill modes (slash commands)

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `oferta` |
| Asks to compare offers | `ofertas` |
| Wants LinkedIn outreach | `contacto` |
| Asks for company research | `deep` |
| Preps for interview at specific company | `interview-prep` |
| Wants to generate CV/PDF | `pdf` |
| Wants LaTeX CV | `latex` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks about rejection patterns | `patterns` |
| Asks about follow-ups | `followup` |

### CV source of truth

- `cv.md` is the canonical CV created during onboarding.
- `article-digest.md` carries detailed proof points and the additional projects not on the one-page CV.
- **NEVER hardcode metrics.** Read them from these files at evaluation time. For project metrics, `article-digest.md` takes precedence over `cv.md`.

### Language

Default modes are in `modes/` (English). To add another language, copy the English modes into `modes/<lang>/` and translate. Set `language.modes_dir: modes/<lang>` in `config/profile.yml` to switch globally.

---

## Ethical Use — CRITICAL

**This system is designed for quality, not quantity.** The goal is to help the user find and apply to roles where there is a genuine match — not to spam companies with mass applications.

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs, prepare cover letters — but always STOP before clicking Submit / Send / Apply. The user makes the final call.
- **Honour the score floor.** Applications with Match score below `triage.score_floor` (default 70) are auto-routed to `Not pursuing`, not drafted, not surfaced for human review.
- **Strongly discourage low-fit applications.** If the A–G global score is below 4.0/5, explicitly recommend against applying. The user's time and the recruiter's time are both valuable. Only proceed if the user has a specific reason to override.
- **Respect recruiters' time.** Every application a human reads costs someone's attention. Only send what's worth reading.

---

## Offer Verification — MANDATORY

**NEVER trust WebSearch/WebFetch alone to verify if an offer is still active.** ALWAYS use Playwright when running interactively:
1. `browser_navigate` to the URL.
2. `browser_snapshot` to read content.
3. Only footer/navbar without JD = closed. Title + description + Apply button = active.

**Exception for batch workers (headless mode):** Playwright is not available in headless pipe mode. Use WebFetch as fallback and mark the report header with `**Verification:** unconfirmed (batch mode)`.

---

## Headless / Batch Mode

Spawning headless workers for batch processing uses Claude Code:

```
claude -p "prompt"
```

The self-contained prompt is in `batch/batch-prompt.md`.

---

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data).
- Scripts in `.mjs`, configuration in YAML.
- Output in `output/` (gitignored), Reports in `reports/`.
- JDs in `jds/` (referenced as `local:jds/{file}` in `pipeline.md`).
- Batch in `batch/` (gitignored except scripts and prompts).
- Report numbering: sequential 3-digit zero-padded, max existing + 1.
- **RULE: After each batch of evaluations, run `npm run merge`** (or `node scripts/tracker/merge-tracker.mjs`) to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in `applications.md` if `company+role` already exists.** Update the existing entry.

### TSV format for tracker additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (status BEFORE score in TSV):**
1. `num` — sequential integer
2. `date` — YYYY-MM-DD
3. `company` — short company name
4. `role` — job title
5. `status` — canonical status (e.g., `Evaluated`) — see `templates/states.yml`
6. `score` — format `X.X/5` (e.g., `4.2/5`)
7. `pdf` — `✅` or `❌`
8. `report` — markdown link `[num](reports/...)`
9. `notes` — one-line summary

In `applications.md` the order is reversed (score BEFORE status). `scripts/tracker/merge-tracker.mjs` handles the column swap.

### Pipeline integrity

1. **NEVER edit `applications.md` to ADD new entries** — write a TSV in `batch/tracker-additions/` and let `scripts/tracker/merge-tracker.mjs` handle the merge.
2. **YES you can edit `applications.md` to UPDATE status / notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF). Include `**Legitimacy:** {tier}` (see Block G in `modes/oferta.md`).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `npm run verify` (or `node scripts/tracker/verify-pipeline.mjs`).
6. Normalise statuses: `npm run normalize` (or `node scripts/tracker/normalize-statuses.mjs`).
7. Dedup: `npm run dedup` (or `node scripts/tracker/dedup-tracker.mjs`).

### Canonical states (`applications.md`)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `SKIP` | Doesn't fit, don't apply |

Rules: no markdown bold in the status field, no dates in the status field, no extra text. Dates go in the date column, notes in the notes column.

---

## Notion integration (optional)

If the user wants Notion as system of record, the contract lives in `modes/notion-tracker.md`. The user provides:

- A Notion internal-integration token (`NOTION_TOKEN` in `.env`).
- An Applications database ID and data source ID (added to `config/profile.yml → notion.*`).

`data/applications.md` continues to work in parallel as a local cache.

Stage pipeline: `1. Discovered → 2. Triaged → 3. Drafted → 4. Applied → 5. Assessment/OA → 6. Phone screen → 7. Tech interview → 8. Onsite/Final → 9. Offer → Signed` (terminals: `Rejected`, `Withdrew`, `Not pursuing`).

Contract rules:
- Dedup on `Job URL` before insert.
- Hard score floor: Match score ≥ `triage.score_floor` (default 70) to surface for drafting. Below → Stage `Not pursuing`, no human triage.
- Priority: Match score DESC end to end.

---

## Common customisation requests

When the user asks to change something, edit it directly. You read the same files you use, so you know exactly what to edit.

- "Change my target roles" → edit `config/profile.yml.target_roles` and `modes/_profile.md → Your Target Roles`.
- "Change my comp targets" → edit `config/profile.yml.compensation` and `modes/_profile.md → Your Comp Targets`.
- "Add these companies to my portals" → edit `portals.yml.tracked_companies`.
- "Add a new project to my proof points" → edit `article-digest.md`.
- "Append a new STAR story" → edit `interview-prep/story-bank.md` in the documented format.
- "Update my CV" → edit `cv.md`.
- "Change the CV template design" → edit `templates/cv-template.html`.
- "Adjust the scoring weights" → edit `modes/_profile.md → Scoring Weights`. Never edit `modes/_shared.md` for user-specific content.
- "Loosen / tighten the seniority filter" → edit `modes/_profile.md → Seniority band` AND `portals.yml.title_filter.negative` AND `config/profile.yml.target_roles.archetypes[].level`. All three must stay in sync.
