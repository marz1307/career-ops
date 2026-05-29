# career-ops

> An AI-powered job search pipeline that runs in Claude Code. Scans portals, scores postings against your profile, drafts tailored CVs and cover letters, hands them to you for review, and logs everything to your tracker. The agent never submits applications — you do.

[![Made for Claude Code](https://img.shields.io/badge/Made_for-Claude_Code-000?style=flat&logo=anthropic&logoColor=white)](https://www.claude.com/product/claude-code)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What it does

```
scan portals                  →  tracker: Stage 1 (Discovered)
   ↓
job evaluation (A–G blocks)   →  tracker: Stage 2 (Triaged) + Match score
   ↓
[hard floor: < score_floor → Not pursuing, stop]
   ↓
pdf tailoring (CV + CL)       →  tracker: Stage 3 (Drafted) + files attached
   ↓
[human review]
   ↓
apply (you confirm)           →  tracker: Stage 4 (Applied)
```

## Install as a Claude Code skill

Copy the skill folder into your Claude Code skills directory:

```bash
# macOS / Linux
cp -r .claude/skills/career-ops ~/.claude/skills/

# Windows (PowerShell)
Copy-Item -Recurse .claude/skills/career-ops $env:USERPROFILE\.claude\skills\
```

Then in any Claude Code session, type:

```
/career-ops
```

On first run the skill will:

1. Ask you to upload (or paste a path to) your CV.
2. Ask for your LinkedIn URL.
3. Ask for your portfolio URL (optional).
4. Ask which **job markets** you're targeting (UK / EU / US / Remote / multi-select).
5. Ask for your **target roles** (you list them, or it infers from your CV).
6. Ask for your Bright Data API key (powers LinkedIn / Indeed / Glassdoor scraping).
7. Ask for your Notion integration token + parent page URL, then **auto-creates** an Applications database with the canonical schema and three dashboard views (Pipeline board, By score, Active interviews).
8. Ask **what time of day** you want the recurring scan to run (07:00 / 12:30 / 18:00 / custom / off) and registers it via `/schedule`.
9. Generates your `config/profile.yml`, `cv.md`, `portals.yml`, and `.env` from the templates.

After that, you can paste a JD URL, run `/career-ops scan`, draft tailored CVs, or invoke any of the modes listed below.

## How it's wired

| Layer | File | Notes |
|-------|------|-------|
| Agent brain | [`CLAUDE.md`](CLAUDE.md) + [`AGENTS.md`](AGENTS.md) | Routing, ethical rules, mode index |
| Your config | [`config/profile.example.yml`](config/profile.example.yml) + [`modes/_profile.template.md`](modes/_profile.template.md) | Identity, archetypes, scoring weights, comp targets, writing style |
| Your CV | `cv.md` (created on first run) | Canonical CV — mirrors whatever PDF you publish |
| Proof points | `article-digest.md` (created on first run) | Projects, case studies, deeper evidence than the CV |
| Portal scanner | [`templates/portals.example.yml`](templates/portals.example.yml) + [`scan.mjs`](scan.mjs) | LinkedIn, Indeed, Glassdoor (via Bright Data dataset), Greenhouse, Ashby, Lever, Workable, Welcome to the Jungle, Handshake, Reed UK; configurable company list |
| Per-JD evaluation | [`modes/oferta.md`](modes/oferta.md) | A–G evaluation, comp research, tracker write |
| PDF generation | [`modes/pdf.md`](modes/pdf.md) + [`generate-pdf.mjs`](generate-pdf.mjs) | A4 always, role-tailored variants |
| Interview prep | `interview-prep/` (created on first run) | STAR+R stories, company intel, JD-tailored prep |
| Notion contract | [`modes/notion-tracker.md`](modes/notion-tracker.md) | Optional Notion DB integration |
| Batch worker | [`batch/batch-prompt.md`](batch/batch-prompt.md) | Self-contained prompt for `claude -p` parallel evaluations |

## npm scripts

```
npm run scan          # zero-token portal scanner (Greenhouse / Ashby / Lever / Workable APIs)
npm run merge         # merge batch tracker TSVs into applications.md
npm run verify        # data-integrity check on the tracker
npm run dedup         # remove duplicate tracker rows
npm run normalize     # normalise status values
npm run sync-check    # validate CV / profile alignment
npm run pdf           # HTML to ATS-optimised PDF
npm run liveness      # check if a job URL is still active
npm run patterns      # analyse outcomes and report patterns
npm run doctor        # repo health check
```

See [`docs/SCRIPTS.md`](docs/SCRIPTS.md) for the full list.

## Customisation

Everything about you lives in user-layer files that updates will never overwrite. Ask Claude in-session to change anything:

- "Change my target roles to Backend Engineer" → edits `config/profile.yml` and `modes/_profile.md`
- "Add these companies to my portals" → edits `portals.yml`
- "Adjust the scoring weights" → edits `modes/_profile.md`
- "Update my CV" → edits `cv.md`

See [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md) and [`DATA_CONTRACT.md`](DATA_CONTRACT.md) for the user-vs-system file boundary.

## Ethical use

- The agent never submits applications. It fills forms, drafts answers, generates PDFs — but stops before Submit / Send / Apply. You make the final call.
- A hard score floor (default 70 / 100) sends low-fit rows to `Not pursuing` rather than drafting them. Override only with a specific reason.
- Quality over speed. A well-targeted application to 5 companies beats a generic blast to 50.

## Status

Open-source, MIT-licensed, marketplace-ready. Fork it, install it as a skill, and reshape it for your own search.

## Credit

Built on Santiago Fernández de Valderrama's original [career-ops](https://github.com/santifer/career-ops) (MIT). The mode-routing system, the Playwright PDF pipeline, the TSV tracker discipline, and the ethical-use rules are his.

## Licence

MIT. See [LICENSE](LICENSE).
