# Mode: training — Course / Certification Evaluation

For each course or certification the user asks about, evaluate across 6 dimensions before recommending DO / DON'T DO / DO WITH TIMEBOX.

| Dimension | What it measures |
|-----------|-------------------|
| **North Star alignment** | Does this move toward or away from the target roles in `modes/_profile.md → Your Target Roles`? |
| **Recruiter signal** | What does a hiring manager in the user's target market think when they see this on the CV? Specific to the role family. |
| **Time and effort** | Weeks × hours/week. Total committed hours. |
| **Opportunity cost** | What can't the user do during that time? Build a portfolio project? Apply to more roles? Improve a target-market language? |
| **Risks** | Is the content outdated? Is the brand weak (e.g. unknown provider vs Coursera/IBM/Google)? Is it too basic for the user's current level? Does it duplicate something they already have? |
| **Portfolio deliverable** | Does it produce a demonstrable artefact (project, repo, write-up) or just a certificate? Demonstrable artefacts are 2-3x more valuable. |

## Verdicts

- **DO** → 4–12 week plan with weekly deliverables and a scoreboard.
- **DON'T DO** → name the better alternative with justification. Default better alternatives: ship a portfolio project, deepen a target-market language, write a technical blog post.
- **DO WITH TIMEBOX** (max X weeks) → condensed plan covering only the essentials.

## Priority order (when comparing multiple candidates)

Bias toward training that improves credibility on the user's stated positioning (see `modes/_profile.md`). Generic priorities:

1. **Stack-specific certifications** (e.g. dbt, Databricks, Snowflake, Hugging Face) — directly reinforce the role's tooling.
2. **Target-market language certifications** (e.g. Goethe, DELE, JLPT, TOEFL) — move "claimed level" to "verified level".
3. **Methodology depth** (e.g. MLOps, causal inference, system design) — closes the gap between "I did X" and "I can ship X".
4. **Cloud certifications** (GCP / AWS / Azure) — bridge for industries where the cloud platform is non-negotiable.

## Market signal

Cultural defaults differ across markets:

- **Credentials-heavy markets** (e.g. parts of continental Europe, Japan): formal certifications carry more weight than self-reported skills. Language certifications move the candidate from "claimed B1" to "verified B1".
- **UK / US:** project portfolios and named experience usually beat certifications. Certifications are useful for entry-level signalling or for crossing into a new domain.
- **Asia-Pacific / Middle East:** varies widely. Check the market's hiring norm before recommending.

## Output format

```markdown
## Verdict: {DO | DON'T DO | DO WITH TIMEBOX}

**Course / cert:** {name}, {provider}, {format}, {duration}

### 6-dimension breakdown
| Dimension | Score (1–5) | Rationale |
|-----------|-------------|-----------|
| North Star alignment | X | ... |
| Recruiter signal | X | ... |
| Time and effort | X | ... weeks × Y hours/week |
| Opportunity cost | X | ... |
| Risks | X | ... |
| Portfolio deliverable | X | ... |

**Total weighted score:** X/30

### Recommended next step
{One concrete next action — link to the course, alternative, or timebox plan.}

### Plan (if DO)
| Week | Deliverable | How to demonstrate |
|------|-------------|---------------------|
| 1 | ... | ... |
```

## When NOT to call this mode

- If the user is mid-application and asks "should I learn X this week?" — this is too much overhead for a quick decision. Give a 2-line answer in chat.
- If the cert is on the active in-progress list in `cv.md → Certifications` already — surface progress, don't re-evaluate.
