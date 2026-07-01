#!/usr/bin/env node
/**
 * cv-qa.mjs — LLM-powered post-draft CV/cover-letter QA agent
 *
 * A generic, self-contained QA pass over a generated CV artifact against a job
 * description and the project's CV quality rubric (modes/cv-quality-rules.md).
 * It runs the checks that the IDE skills (resume-writer / tech-cv-review /
 * humanizer / recruiter-sim) would run interactively, so headless routines can
 * apply the same bar. It drives the Claude CLI (`claude -p`) on your Claude
 * subscription — no API key required.
 *
 * This is decoupled from any single candidate: it reads the CV artifact you
 * point it at (or auto-detects the newest file under output/), reads the JD you
 * pass, and reads modes/cv-quality-rules.md as the rubric. There is no
 * hardcoded candidate profile, no market/language-specific logic, and no
 * personal file paths.
 *
 * Usage:
 *   node cv/cv-qa.mjs \
 *     --cv    output/Candidate_CV_ExampleCo_2026-07-01.html \
 *     --jd    "full JD text"                  # or --jd-file path/to/jd.txt
 *     [--cl   output/Candidate_Cover_Letter_ExampleCo.md]   # optional cover letter
 *     [--company "ExampleCo"]
 *     [--role-title "Analytics Engineer"]
 *     [--dry-run]        # evaluate but do NOT patch or write files
 *     [--json]           # emit JSON result to stdout (default: human-readable)
 *     [--max-regen N]    # max cover-letter regeneration attempts (default: 2; 0 = off)
 *     [--model <id>]     # override the QA model (default: claude-sonnet-5; or env CV_QA_MODEL)
 *
 * Requires: the Claude Code CLI (`claude`) on PATH — it runs on your Claude
 * subscription, so no API key is needed. Set CLAUDE_CLI to the binary path if
 * it is not on PATH. When the CLI is unavailable the script prints a
 * clear message and exits 0 (non-fatal) so pipelines degrade gracefully.
 *
 * Exit codes:
 *   0  — QA passed, OR the Claude CLI is unavailable (graceful skip)
 *   2  — QA flagged issues but auto-patched / regenerated successfully
 *   3  — QA flagged issues that need manual intervention
 *   1  — Script error (API failure, missing files, bad response, etc.)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Resolve inputs
// ---------------------------------------------------------------------------

// CV artifact: explicit --cv, else newest file under output/ that looks like a CV.
function autodetectCv() {
  const outDir = resolve(REPO_ROOT, 'output');
  if (!existsSync(outDir)) return null;
  const candidates = [];
  for (const name of readdirSync(outDir)) {
    if (!/\.(html|md|htm)$/i.test(name)) continue;
    if (!/cv/i.test(name)) continue;
    const full = join(outDir, name);
    try { candidates.push({ full, mtime: statSync(full).mtimeMs }); } catch { /* ignore */ }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? candidates[0].full : null;
}

const CV_PATH    = ARGS['cv'] ? resolve(ARGS['cv']) : autodetectCv();
const CL_PATH    = ARGS['cl'] ? resolve(ARGS['cl']) : null;
const COMPANY    = ARGS['company']    || 'the company';
const ROLE_TITLE = ARGS['role-title'] || '';
const DRY_RUN    = !!ARGS['dry-run'];
const JSON_MODE  = !!ARGS['json'];
const MAX_REGEN  = parseInt(ARGS['max-regen'] ?? '2', 10);

// JD text: --jd "<text>" or --jd-file <path>.
let JD_TEXT = '';
if (typeof ARGS['jd'] === 'string') JD_TEXT = ARGS['jd'];
else if (ARGS['jd-file']) {
  const jdFile = resolve(ARGS['jd-file']);
  if (!existsSync(jdFile)) { console.error(`JD file not found: ${jdFile}`); process.exit(1); }
  JD_TEXT = readFileSync(jdFile, 'utf8');
}

if (!CV_PATH) {
  console.error('Usage: node cv/cv-qa.mjs --cv <path> --jd "<text>" [--cl <path>] [--company "<name>"] [--role-title "<title>"]');
  console.error('No --cv given and no CV-like file found under output/.');
  process.exit(1);
}
if (!existsSync(CV_PATH)) { console.error(`CV not found: ${CV_PATH}`); process.exit(1); }
if (!JD_TEXT.trim()) {
  console.error('A job description is required (--jd "<text>" or --jd-file <path>).');
  process.exit(1);
}
if (CL_PATH && !existsSync(CL_PATH)) { console.error(`Cover letter not found: ${CL_PATH}`); process.exit(1); }

// ---------------------------------------------------------------------------
// Model runner: the Claude CLI (claude -p) on the user's Claude subscription.
// No API key required. Set CLAUDE_CLI if `claude` is not on PATH.
// ---------------------------------------------------------------------------
const CLAUDE_BIN = process.env.CLAUDE_CLI || 'claude';

function claudeAvailable() {
  try {
    const probe = spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', timeout: 20000 });
    return !probe.error && probe.status === 0;
  } catch { return false; }
}

// Graceful degradation when the Claude CLI is unavailable: exit 0 with a clear
// message rather than failing the pipeline (mirrors the rest of career-ops).
if (!claudeAvailable()) {
  console.error(`[cv-qa] Claude CLI ("${CLAUDE_BIN}") not found — skipping the LLM QA pass.`);
  console.error('[cv-qa] Install Claude Code (https://claude.com/claude-code), or set CLAUDE_CLI to the binary path.');
  console.error('[cv-qa] Manual review against modes/cv-quality-rules.md remains the fallback.');
  if (JSON_MODE) {
    console.log(JSON.stringify({ skipped: true, reason: 'no_claude_cli', cv_path: CV_PATH }, null, 2));
  }
  process.exit(0);
}

// QA model, pinned to Sonnet for a good quality/speed balance. Override with
// --model or CV_QA_MODEL (e.g. claude-opus-4-8). Passed to `claude --model`.
const QA_MODEL = ARGS['model'] || process.env.CV_QA_MODEL || 'claude-sonnet-5';

// ---------------------------------------------------------------------------
// Load rubric + artifacts
// ---------------------------------------------------------------------------

const RULES_PATH = resolve(REPO_ROOT, 'modes', 'cv-quality-rules.md');
if (!existsSync(RULES_PATH)) {
  console.error(`modes/cv-quality-rules.md not found — cannot load the QA rubric.`);
  process.exit(1);
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const rubricMd = readFileSync(RULES_PATH, 'utf8');
const isHtmlCv = /\.html?$/i.test(CV_PATH);
const cvRaw    = readFileSync(CV_PATH, 'utf8');
const cvPlain  = isHtmlCv ? stripHtml(cvRaw) : cvRaw;
let   clMd     = CL_PATH ? readFileSync(CL_PATH, 'utf8') : '';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function logMsg(msg) { if (!JSON_MODE) console.log(msg); }

function parseJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response');
  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------------
// QA system prompt — recruiter persona + rubric-driven checks
// ---------------------------------------------------------------------------

const QA_SYSTEM = `You are a senior in-house technical recruiter performing a final QA pass on a
tailored CV${CL_PATH ? ' and cover letter' : ''} before it is submitted for the role of
"${ROLE_TITLE || 'the advertised role'}" at ${COMPANY}.

The rubric below (from the project's cv-quality-rules) is your ground truth. Apply
every applicable rule from it. Your job is to decide, with clinical honesty, whether
this application would earn an interview, and to flag genuine misalignment, quality
gaps, and AI-voice tells.

--- CV QUALITY RUBRIC ---

${rubricMd}

--- END RUBRIC ---

### Step 1: Infer the recruiter persona
Read the JD tone, company type, sector, and seniority signals. Record:
- formality: "high" | "medium" | "low"
- primary_lens: "business-outcomes" | "technical-depth" | "balanced"
- scrutiny: "strict" | "standard" | "relaxed"
- inferred_from: [signals you used]

### Step 2: Run the checks
Ground every check in the rubric above.

**Check A — Role-title / archetype alignment.** Does the CV's headline/tagline and
positioning match the role as advertised? Flag a CV headlined for a different job than
the JD describes.

**Check B — Above-the-fold signal strength (rubric §5).** Extract the 3 most important
requirements in the JD. Are they evidenced in the first ~40% of the CV (profile paragraph
+ most recent role)? If the JD leads with a must-have that only appears late (or not at
all), flag it. Predict the 30-second-scan verdict: INVITE / MAYBE / REJECT.

**Check C — Bullet quality (rubric §2, §4).** Sample the Experience bullets. Are they
XYZ-format (outcome + measure + method)? Any fabricated-looking metrics, banned AI
vocabulary, negative parallelism, forced rule-of-three, or em/en dashes?

${CL_PATH ? `**Check D — Cover-letter quality.** Assess the cover letter for: a hook that does not
open with "I" or reference the application; the role title named as advertised; a
specific number with its consequence for this company; a company/sector-specific
anchor that could NOT appear unchanged in a letter to a different company; zero banned
AI vocabulary; zero em/en dashes; a concrete close. Record cover_letter_word_count.` :
`(No cover letter provided — set cover_letter checks to "N/A" and cover_letter_word_count to 0.)`}

### Step 3: Classify each flag as auto-patchable
A flag is AUTO_PATCHABLE only if it can be fixed by a single, exact, verbatim string
replacement in the CV or cover letter (e.g. fix a tagline, correct the role name in the
cover letter, remove one banned word / one em dash). It is NOT auto-patchable if it needs
structural rewriting or regeneration.

### Step 4: Return ONE JSON object — no prose before or after it — matching this schema:

{
  "recruiter_persona": {
    "formality": "high | medium | low",
    "primary_lens": "business-outcomes | technical-depth | balanced",
    "scrutiny": "strict | standard | relaxed",
    "inferred_from": ["signal1", "signal2"]
  },
  "alignment_score": 0,
  "scan_verdict": "INVITE | MAYBE | REJECT",
  "interview_likelihood": "HIGH | MEDIUM | LOW",
  "checks": {
    "role_title": "PASS | FAIL",
    "above_the_fold": "PASS | FAIL | PARTIAL",
    "bullet_quality": "PASS | FAIL | PARTIAL",
    "cover_letter": "PASS | FAIL | PARTIAL | N/A"
  },
  "flags": [
    {
      "id": "unique_short_id",
      "check": "role_title | above_the_fold | bullet_quality | cover_letter",
      "severity": "CRITICAL | MAJOR | MINOR",
      "location": "cv_tagline | cv_profile | cv_bullet_N | cl_opener | cl_para_2 | etc",
      "description": "What is wrong and why it matters for THIS recruiter at THIS company",
      "auto_patchable": true,
      "patch": { "file": "cv | cl", "old": "exact verbatim string to find", "new": "replacement" }
    }
  ],
  "cover_letter_word_count": 0,
  "cover_letter_verdict": "STRONG | ACCEPTABLE | WEAK | CRITICAL_FAIL | N/A",
  "cover_letter_critique": "One paragraph of specific, honest critique (or 'N/A' if no cover letter).",
  "overall_verdict": "PASS | PATCH_AND_PASS | REGENERATE",
  "auto_patchable_count": 0
}`;

function buildUserMessage(cv, cl) {
  return `## Job Description

${JD_TEXT}

---

## CV (plain text)

\`\`\`
${cv}
\`\`\`
${cl ? `
---

## Cover Letter (Markdown source)

\`\`\`markdown
${cl}
\`\`\`
` : ''}
Evaluate the above against the JD for "${ROLE_TITLE || 'the advertised role'}" at ${COMPANY}.
Apply all applicable rubric rules. Return only the JSON object described in your instructions.`;
}

// ---------------------------------------------------------------------------
// Cover-letter regeneration prompt (generic, rubric-driven)
// ---------------------------------------------------------------------------

function buildRegenSystem(qaResult) {
  const clFlags = (qaResult.flags || []).filter(f => f.check === 'cover_letter' && !f.auto_patchable);
  return `You are rewriting a cover letter that failed QA. Produce a new cover letter that
passes every applicable rule in the rubric below.

--- CV QUALITY RUBRIC ---

${rubricMd}

--- END RUBRIC ---

### What failed
Verdict: ${qaResult.cover_letter_verdict}
Word count: ${qaResult.cover_letter_word_count}
Critique: ${qaResult.cover_letter_critique}
Specific failures:
${clFlags.length ? clFlags.map(f => `- [${f.severity}] ${f.location}: ${f.description}`).join('\n') : '- General quality below the bar (see critique).'}

### Required structure (4 paragraphs, prose only, no lists)
1. Hook — a specific result OR the problem this company is solving. Do NOT start with "I".
   Do NOT reference the application.
2. Primary evidence — one proof point with a number AND its consequence for THIS role at ${COMPANY}.
3. Secondary evidence + a company/sector-specific anchor that could NOT appear unchanged in a
   letter to a different company.
4. Close — availability and a direct, forward-looking sign-off (no "I look forward to hearing from you").

### Non-negotiables
- Role title must appear exactly as advertised${ROLE_TITLE ? `: **${ROLE_TITLE}**` : ' in the JD'}.
- Zero em dashes (—) and zero en dashes (–) anywhere.
- Zero banned AI vocabulary (see the rubric's banned lists).
- Every claim needs a number, a project name, or a named tool.
- "I" must not be the first word.

### Output
Return ONLY the cover letter text in markdown. No JSON, no preamble, no word-count note.
The letter starts on the first line of your response.`;
}

function buildRegenUserMessage(failedCl) {
  return `## Job Description

${JD_TEXT}

---

## Failed cover letter (did not pass QA)

\`\`\`markdown
${failedCl}
\`\`\`

Write the improved cover letter for "${ROLE_TITLE || 'the advertised role'}" at ${COMPANY}.
Start immediately with the letter — no preamble.`;
}

// ---------------------------------------------------------------------------
// Model call — Claude CLI (`claude -p`), subscription-backed, no API key.
// ---------------------------------------------------------------------------

async function callClaude(systemPrompt, userMessage) {
  // The CLI takes a single prompt, so concatenate the system prompt (rubric +
  // instructions) and the per-call payload. Pass it via stdin to avoid
  // command-line length limits — the rubric + CV + JD can be large.
  const prompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  const cliArgs = ['-p', '--output-format', 'text'];
  if (QA_MODEL) cliArgs.push('--model', QA_MODEL);

  const res = spawnSync(CLAUDE_BIN, cliArgs, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });

  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') throw new Error('claude CLI timed out after 5 minutes');
    throw new Error(`claude CLI failed to start: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`claude CLI exited ${res.status}: ${(res.stderr || '').slice(0, 300)}`);
  }
  const out = (res.stdout || '').trim();
  if (!out) throw new Error('claude CLI returned empty output');
  return out;
}

// ---------------------------------------------------------------------------
// Apply auto-patches (verbatim string replacements)
// ---------------------------------------------------------------------------

function applyPatches(flags, currentCvRaw, currentCl) {
  const patchable = (flags || []).filter(f => f.auto_patchable && f.patch);
  let cvPatched = false;
  let clPatched = false;
  let workCv = currentCvRaw;
  let workCl = currentCl;
  const applied = [];
  const failed  = [];

  for (const flag of patchable) {
    const { file, old: oldStr, new: newStr } = flag.patch;
    if (!oldStr || newStr == null || oldStr === newStr) continue;

    if (file === 'cv') {
      if (workCv.includes(oldStr)) {
        workCv = workCv.replaceAll(oldStr, newStr);
        cvPatched = true;
        applied.push(flag.id);
      } else {
        failed.push({ id: flag.id, reason: 'old string not found in CV' });
      }
    } else if (file === 'cl' && CL_PATH) {
      if (workCl.includes(oldStr)) {
        workCl = workCl.replaceAll(oldStr, newStr);
        clPatched = true;
        applied.push(flag.id);
      } else {
        failed.push({ id: flag.id, reason: 'old string not found in cover letter' });
      }
    }
  }

  if (!DRY_RUN) {
    if (cvPatched) writeFileSync(CV_PATH, workCv, 'utf8');
    if (clPatched && CL_PATH) writeFileSync(CL_PATH, workCl, 'utf8');
  }

  return { applied, failed, cvPatched, clPatched, workCv, workCl };
}

// ---------------------------------------------------------------------------
// Should we attempt a cover-letter regeneration?
// ---------------------------------------------------------------------------

function isClRegenCandidate(result) {
  if (!CL_PATH) return false;
  if (result.overall_verdict !== 'REGENERATE') return false;
  if (result.checks?.cover_letter === 'PASS') return false;
  return (result.flags || []).some(f => f.check === 'cover_letter' && !f.auto_patchable);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const timestamp = new Date().toISOString();

  logMsg(`[cv-qa] ${timestamp}`);
  logMsg(`[cv-qa] CV:      ${CV_PATH}`);
  if (CL_PATH) logMsg(`[cv-qa] CL:      ${CL_PATH}`);
  logMsg(`[cv-qa] Company: ${COMPANY} | Role: ${ROLE_TITLE || '(unspecified)'}`);
  logMsg(`[cv-qa] Model:   ${QA_MODEL} | max-regen: ${MAX_REGEN}`);
  logMsg(`[cv-qa] Running QA pass 1...`);

  // ── Initial QA ────────────────────────────────────────────────────────────
  let currentCl = clMd;
  let result;
  try {
    const raw = await callClaude(QA_SYSTEM, buildUserMessage(cvPlain, currentCl));
    result = parseJson(raw);
  } catch (err) {
    console.error(`[cv-qa] QA call failed: ${err.message}`);
    throw err;
  }

  // ── Cover-letter regeneration loop ────────────────────────────────────────
  const regenHistory = [];
  let regenCount = 0;

  while (MAX_REGEN > 0 && isClRegenCandidate(result) && regenCount < MAX_REGEN) {
    regenCount++;
    logMsg(`[cv-qa] Cover letter below bar (${result.cover_letter_verdict}, ${result.cover_letter_word_count} words). Regen ${regenCount}/${MAX_REGEN}...`);

    regenHistory.push({
      attempt: regenCount,
      verdict: result.cover_letter_verdict,
      word_count: result.cover_letter_word_count,
      critique: result.cover_letter_critique,
    });

    let newCL;
    try {
      newCL = await callClaude(buildRegenSystem(result), buildRegenUserMessage(currentCl));
    } catch (err) {
      logMsg(`[cv-qa] Regen call failed: ${err.message} — stopping regen loop`);
      break;
    }

    if (!DRY_RUN) writeFileSync(CL_PATH, newCL, 'utf8');
    currentCl = newCL;
    logMsg(`[cv-qa] New CL written (~${newCL.split(/\s+/).length} words). Re-evaluating...`);

    try {
      const raw = await callClaude(QA_SYSTEM, buildUserMessage(cvPlain, currentCl));
      result = parseJson(raw);
      logMsg(`[cv-qa] Re-QA: ${result.overall_verdict} | CL: ${result.cover_letter_verdict} (${result.cover_letter_word_count} words)`);
    } catch (err) {
      logMsg(`[cv-qa] Re-QA failed: ${err.message} — using last known result`);
      break;
    }
  }

  if (regenCount > 0) {
    logMsg(`[cv-qa] Regen complete. Attempts: ${regenCount}. Final verdict: ${result.overall_verdict}`);
  }

  // ── Apply auto-patchable flags ────────────────────────────────────────────
  let patchResult = null;
  if (result.overall_verdict !== 'PASS' && result.flags && result.flags.length > 0) {
    patchResult = applyPatches(result.flags, cvRaw, currentCl);
  }

  // ── Output ────────────────────────────────────────────────────────────────
  if (JSON_MODE) {
    console.log(JSON.stringify({
      ...result,
      _meta: {
        timestamp,
        model: QA_MODEL,
        cv_path: CV_PATH,
        cl_path: CL_PATH,
        company: COMPANY,
        role_title: ROLE_TITLE,
        dry_run: DRY_RUN,
        regen_attempts: regenCount,
        regen_history: regenHistory,
        patches_applied: patchResult?.applied || [],
        patches_failed: patchResult?.failed || [],
      },
    }, null, 2));
  } else {
    console.log('');
    console.log(`RECRUITER PERSONA : ${result.recruiter_persona?.formality} / ${result.recruiter_persona?.primary_lens} / ${result.recruiter_persona?.scrutiny}`);
    console.log(`ALIGNMENT SCORE   : ${result.alignment_score}/100`);
    console.log(`30-SEC SCAN       : ${result.scan_verdict}`);
    console.log(`INTERVIEW CHANCE  : ${result.interview_likelihood}`);
    console.log(`OVERALL VERDICT   : ${result.overall_verdict}`);
    if (regenCount > 0) console.log(`REGEN ATTEMPTS    : ${regenCount}/${MAX_REGEN}`);
    console.log('');
    console.log('CHECKS:');
    for (const [k, v] of Object.entries(result.checks || {})) {
      console.log(`  ${k.padEnd(18)}: ${v}`);
    }
    console.log('');
    if (result.flags && result.flags.length > 0) {
      console.log(`FLAGS (${result.flags.length}):`);
      for (const flag of result.flags) {
        const tag = flag.auto_patchable ? '[AUTO-PATCHABLE]' : '[MANUAL]';
        console.log(`  [${flag.severity}] ${flag.check} @ ${flag.location} ${tag}`);
        console.log(`    ${flag.description}`);
        if (flag.patch && flag.auto_patchable) {
          console.log(`    OLD: ${String(flag.patch.old).slice(0, 80)}`);
          console.log(`    NEW: ${String(flag.patch.new).slice(0, 80)}`);
        }
        console.log('');
      }
    }
    if (CL_PATH) {
      console.log(`COVER LETTER      : ${result.cover_letter_verdict} (${result.cover_letter_word_count} words)`);
      console.log(`CRITIQUE          : ${result.cover_letter_critique}`);
      console.log('');
    }
    if (patchResult) {
      console.log(`PATCHES APPLIED   : ${patchResult.applied.join(', ') || 'none'}`);
      if (patchResult.failed.length > 0) {
        console.log(`PATCHES FAILED    : ${patchResult.failed.map(f => f.id).join(', ')}`);
      }
      if (DRY_RUN) console.log('(DRY RUN — no files written)');
    }
  }

  // ── Exit code ─────────────────────────────────────────────────────────────
  if (result.overall_verdict === 'PASS') process.exit(0);
  if (patchResult && patchResult.applied.length > 0) process.exit(2);
  if (regenCount > 0 && result.overall_verdict !== 'REGENERATE') process.exit(2);
  process.exit(3);
}

main().catch(err => {
  console.error('[cv-qa] Fatal:', err.message);
  process.exitCode = 1;
});
