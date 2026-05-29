# CV Quality Rules — local distillation of IDE skill caveats

**Why this file exists.** The IDE-level skills that produced the gold-standard CVs in `generate-pdf-tailored.mjs` — `resume-writer`, `tech-cv-review`, `humanizer`, `recruiter-sim` — don't load under headless `claude -p`. The scheduled `auto-draft` and `auto-eval` routines can't invoke them. This file distils their caveats so the routines can apply the same standards inline.

`auto-draft.md` and `auto-eval.md` must **read this file once at start** and apply every rule below to every CV they generate or evaluate.

---

## 1. Template authority

The canonical CV format lives in `generate-pdf-tailored.mjs`. It produces variants for the user's archetypes (configured in `_profile.md`).

**Never re-implement the HTML/CSS structure.** Always shell out to `node generate-pdf-tailored.mjs --variant <v> --lang <l> --out <dir>` with the appropriate flags. The single content model in that file is the source of truth — never duplicate it elsewhere.

**Variant selection (auto-draft step 2c):**
- Map the JD's title to one of the archetypes defined in `modes/_profile.md → Your Adaptive Framing`.
- If unclear, pick the most general variant.

**Language selection:**
- JD majority in language X AND user has a `--lang x` build → use it.
- Otherwise → English.

---

## 2. Google XYZ format — every bullet must comply

Rubric: every Experience bullet should read "Accomplished **[X]** as measured by **[Y]**, by doing **[Z]**."

When tailoring (e.g. emphasising a different metric for a specific JD), preserve XYZ structure:

- **X** — outcome verb + scope (e.g. "Cut daily pipeline compute by ~95%")
- **Y** — the measurement (percentages, counts, time saved, dataset size)
- **Z** — the method (e.g. "by re-architecting high-volume revenue models as incremental on an append-only raw layer with deterministic hash IDs")

**Never invent metrics.** If a bullet you want to write lacks an honest measurable, use scope (`over 40 dbt models`, `5 daily schedules`), cardinality (`across 8 backend domains`), counts, or timebox. Fabricated percentages are a fireable offence.

---

## 3. ATS keyword density

For each JD scored ≥ score floor, `auto-draft` extracts JD-required terms.

**Tailoring policy:**
- Reorder the skills section so the JD's top stack categories appear first.
- If a JD requires a tool that appears in the CV content but not in the skills line for the chosen variant — escalate the category, don't fabricate experience.
- **NEVER** add a tool to the skills line that doesn't already appear somewhere in the content model. If a JD needs Kafka and the user hasn't used it, drop the row or surface the gap in the cover letter ("currently deepening on Kafka via …").

---

## 4. Humanizer rules — no AI tells

These are the patterns that recruiters use to spot LLM-written CVs. **Every bullet, every Profile sentence, every cover-letter line must pass these checks.**

### Banned vocabulary (high-signal AI words)
`leverage` (as verb), `synergize`, `delve`, `align with`, `crucial`, `pivotal`, `key role`, `interplay`, `intricate`, `intricacies`, `tapestry`, `testament`, `underscore` (verb), `vibrant`, `landscape` (abstract), `enduring`, `garner`, `foster` (when used for engagement/community), `showcase`, `boasts`, `nestled`, `in the heart of`, `passionate about`, `results-driven`, `I excel at`.

### Banned constructions
- **Copula avoidance** — replace `serves as`, `stands as`, `marks`, `represents` with `is` / `was`.
- **Negative parallelism** — `not just X, but Y` / `it's not merely … it's …` → replace with the direct statement.
- **Rule of three forced lists** — if you can only honestly defend two items, write two. Three for the sake of rhythm is a tell.
- **Elegant variation** — don't cycle synonyms. Repeat the noun.
- **False ranges** — `from X to Y` only when X and Y are on a real scale.
- **Inflated stakes** — no "transformative", "groundbreaking" without numbers behind them.
- **Em / en dashes in paste-ready text** — ZERO `—` and ZERO `–` in any output file. This includes CV body text, cover letters, and form-answers drafts. Use colons, commas, parentheses, periods, or "to" for ranges ("3 to 5 years", never "3–5 years"). **Self-check before saving any draft: grep for `—` and `–` and rewrite every match. No exceptions.**

### Banned formatting tics
- Mechanical boldface on every keyword.
- Inline-header vertical lists where every item starts `**Header:** description`. Fine in dedicated Projects sub-fields; don't extend into Experience bullets.

### Voice rules
- Vary sentence length. Short. Then a longer one that earns its length by carrying real content. Then medium.
- Specific over abstract.
- Concrete tool / number / decision in every bullet.

---

## 5. Recruiter-sim — the 30-second-scan verdict

A senior in-house tech recruiter spends ≤30 seconds on first scan and assigns one of: **INVITE / MAYBE / REJECT**. Before submitting any tailored CV, `auto-draft` must mentally run the scan and predict the verdict.

**Predictors of INVITE (every CV should hit ≥4 of these):**
1. Profile sentence states role + 2 differentiating capabilities in the first 15 words.
2. Most recent role title matches or strictly outranks the JD's target title.
3. Stack line in latest role lists ≥3 of the JD's top stack items.
4. Quantified impact in first bullet of latest role.
5. Project section validates the Experience section (no contradiction).
6. Education includes the target market's recognised degree.

**Predictors of REJECT (any one is fatal):**
- Title mismatch in last role with no bridging story.
- Zero numbers in Experience.
- AI-tell vocabulary in Profile.
- Skills line ≠ Experience evidence (e.g. lists Spark with no Spark bullet).
- Missing graduation date for current degree.

If the predicted verdict is REJECT, **do not submit**. Log to tracker: `[auto-draft] PREDICTED_REJECT: {reason}`. Operator decides whether to escalate manually.

---

## 6. Market-specific friction

### UK
- Location signalling: city + country in header.
- Optional: declare right-to-work status in cover letter if JD is sponsorship-sensitive.

### EU scale-up
- Lean on the deepest technical project. Equity / scale-up framing belongs in cover letter, not CV.

### FAANG / US-tech
- EN only. Strip photo if the template has one.
- Bullet format already FAANG-compliant (XYZ).

For other markets the user is targeting, define market-specific guidance in `modes/_profile.md → Market-specific touches`.

---

## 7. Honest-probability self-check

After producing a tailored CV, `auto-draft` should estimate (in Fit notes) the realistic interview-conversion probability per 100 apps at the target's tier:

| Target tier | Baseline rate for mid-level data/AE candidate |
|---|---|
| FAANG | 1–3% |
| Top EU tech | 4–8% |
| Tier-2 enterprise | 6–12% |
| Scale-up / data-product startups | 8–18% |

If predicted rate < baseline by ≥5 percentage points, flag as `[probability_below_baseline]` in Fit notes — usually signals a gap that should be addressed before submission.

---

## 8. Process — how auto-draft applies these rules

1. **Read this file** (`modes/cv-quality-rules.md`) once at routine start.
2. **Pick variant + lang** per Section 1.
3. **Extract keywords** from JD.
4. **Run** `node generate-pdf-tailored.mjs --variant <v> --lang <l> --out output/cv-drafts/{APP-id}/ --tailor-keywords "<keywords>"`.
5. **Self-audit the output** against Sections 2–5 before accepting:
   - Every bullet: XYZ-compliant?
   - Any banned vocabulary (Section 4)?
   - 30-second-scan predicted INVITE or MAYBE? (REJECT → block).
6. **Apply Section 6** market-specific touches in the cover letter (not the CV — CV stays uniform).
7. **Log honest probability** per Section 7 in Fit notes.

---

## 9. What this file does NOT replace

- Manual review by the user remains the gold standard. This file gets the auto-draft pipeline to ~85% of skill-driven quality without IDE plugins. The remaining 15% (subtle voice, market intuition, NDA-sensitive phrasing) is intentionally a human responsibility at the Stage-4 review checkpoint.
- The IDE skills are still useful when the user is in an interactive Claude Code session — they auto-trigger on CV file events. This file is the *fallback for headless routines only*.
