#!/usr/bin/env node
/**
 * funnel-metrics.mjs — Real outcome metrics for career-ops
 *
 * A complement to "Match score". Match score measures how well a JD fits the
 * candidate profile — it carries NO employer signal and does not, on its own,
 * predict outcomes (it's common to see rejected applications average a HIGHER
 * match score than the pipeline as a whole). The metrics that actually debug a
 * job search are response rate and screen rate, sliced by the levers you
 * control: source portal, country, referral, and sponsorship.
 *
 * Pulls every Applications row from Notion via REST (same auth + config as
 * notion-query.mjs) and computes:
 *   - the funnel (counts by stage)
 *   - response rate   = got any company response / applications submitted
 *   - screen rate     = reached Stage 5+ (got past the first stage) / applications
 *   - rejection rate  = explicit rejections / applications
 *   - the same, sliced by source portal, country, referral, sponsorship
 *   - a match-score reality check (avg score: progressed vs rejected vs pending)
 *
 * Auth: NOTION_TOKEN env var (internal integration token, `ntn_`/`secret_`).
 * Reads the database ID from config/profile.yml → notion.applications_database_id.
 *
 * Usage:
 *   node funnel-metrics.mjs --summary        human-readable report (default)
 *   node funnel-metrics.mjs --json           structured JSON to stdout
 *   node funnel-metrics.mjs --min-cohort 3   hide slices with < 3 applications
 */

import { readFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";

const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const JSON_ONLY = args.includes("--json");
const MIN_COHORT = parseInt(arg("--min-cohort", "1"), 10) || 1;

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("ROUTINE_ABORT: NOTION_TOKEN env var not set.");
  console.error("Get an internal integration token from https://www.notion.com/my-integrations,");
  console.error('add it to the Applications DB, then `setx NOTION_TOKEN "ntn_..."`.');
  process.exit(5);
}

function loadConfig() {
  const path = "config/profile.yml";
  if (!existsSync(path)) return {};
  try { return yaml.load(readFileSync(path, "utf8")) || {}; }
  catch { return {}; }
}
const CFG = loadConfig();
// Same key + fallback as notion-query.mjs: /v1/databases/{id}/query expects the
// *database* UUID. Set notion.applications_database_id in config/profile.yml.
const DATABASE_ID =
  (CFG.notion && CFG.notion.applications_database_id) ||
  "eace68a2-e454-4a6d-ab9d-ed5dfcd65c72";
const ENDPOINT = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;

// --- Stage taxonomy (mirrors the Notion Stage select in notion-tracker.md) ---
const APPLIED_STAGES = [
  "4. Applied", "5. Assessment/OA", "6. Phone screen",
  "7. Tech interview", "8. Onsite/Final", "9. Offer", "Signed", "Rejected",
];
// "Got past the first stage" — an assessment or live human conversation.
const PROGRESSED_STAGES = [
  "5. Assessment/OA", "6. Phone screen", "7. Tech interview",
  "8. Onsite/Final", "9. Offer", "Signed",
];

async function query(startCursor = null) {
  const body = { page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Notion API ${res.status}: ${t.slice(0, 500)}`);
  }
  return res.json();
}

function extractTitle(props) {
  const titleProp = Object.values(props).find(p => p && p.type === "title");
  if (!titleProp || !titleProp.title || titleProp.title.length === 0) return "";
  return titleProp.title.map(t => t.plain_text).join("");
}
function row(page) {
  const p = page.properties || {};
  const sel = n => (p[n] && p[n].type === "select" ? p[n].select?.name ?? null : null);
  const dat = n => (p[n] && p[n].type === "date" ? p[n].date?.start ?? null : null);
  const num = n => (p[n] && p[n].type === "number" ? p[n].number : null);
  // Referral? is a checkbox in the canonical schema (notion-tracker.md), but
  // tolerate a select too in case a workspace modelled it that way.
  const referral = () => {
    const f = p["Referral?"];
    if (!f) return null;
    if (f.type === "checkbox") return f.checkbox ? "Referral" : "No referral";
    if (f.type === "select") return f.select?.name ?? null;
    return null;
  };
  return {
    company: extractTitle(p),
    stage: sel("Stage"),
    apply_date: dat("Apply date"),
    response_date: dat("Response date"),
    referral: referral(),
    portal: sel("Source portal"),
    country: sel("Country"),
    sponsorship: sel("Visa/sponsorship"),
    match_score: num("Match score"),
  };
}

// --- Classification ---------------------------------------------------------
const inApplied = r => APPLIED_STAGES.includes(r.stage) || !!r.apply_date;
const progressed = r => PROGRESSED_STAGES.includes(r.stage);
const rejected = r => r.stage === "Rejected";
// A response = the company did something: progressed us, rejected us, or a
// response date is logged. Silence (still "4. Applied", no response date) = ghosted.
const responded = r => progressed(r) || rejected(r) || !!r.response_date;

function rate(n, d) { return d ? +(100 * n / d).toFixed(1) : null; }

function sliceBy(rows, key) {
  const groups = {};
  for (const r of rows) {
    const k = r[key] || "(unset)";
    (groups[k] ||= []).push(r);
  }
  const out = [];
  for (const [k, rs] of Object.entries(groups)) {
    const cohort = rs.filter(inApplied);
    if (cohort.length < MIN_COHORT) continue;
    const resp = cohort.filter(responded).length;
    const prog = cohort.filter(progressed).length;
    const rej = cohort.filter(rejected).length;
    out.push({
      group: k,
      applications: cohort.length,
      responded: resp,
      progressed: prog,
      rejected: rej,
      response_rate_pct: rate(resp, cohort.length),
      screen_rate_pct: rate(prog, cohort.length),
      rejection_rate_pct: rate(rej, cohort.length),
    });
  }
  return out.sort((a, b) => b.applications - a.applications);
}

function avg(xs) {
  const v = xs.filter(x => typeof x === "number");
  return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
}

async function main() {
  const all = [];
  let cursor = null;
  do {
    const r = await query(cursor);
    for (const page of r.results) all.push(row(page));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  const funnel = {};
  for (const r of all) funnel[r.stage || "(unset)"] = (funnel[r.stage || "(unset)"] || 0) + 1;

  const cohort = all.filter(inApplied);
  const resp = cohort.filter(responded).length;
  const prog = cohort.filter(progressed).length;
  const rej = cohort.filter(rejected).length;
  const ghosted = cohort.length - resp;

  const headline = {
    applications_submitted: cohort.length,
    responses: resp,
    response_rate_pct: rate(resp, cohort.length),
    reached_first_stage_or_beyond: prog,
    screen_rate_pct: rate(prog, cohort.length),
    rejections: rej,
    rejection_rate_pct: rate(rej, cohort.length),
    silent_no_response: ghosted,
  };

  // Match-score reality check — shows whether the metric predicts outcomes.
  const match_score_check = {
    avg_score_progressed: avg(cohort.filter(progressed).map(r => r.match_score)),
    avg_score_rejected: avg(cohort.filter(rejected).map(r => r.match_score)),
    avg_score_silent: avg(cohort.filter(r => inApplied(r) && !responded(r)).map(r => r.match_score)),
    note: "If rejected ≈ or > progressed, Match score is not predicting outcomes. Manage to response/screen rate instead.",
  };

  const result = {
    generated_at: new Date().toISOString(),
    total_rows_in_db: all.length,
    funnel,
    headline,
    match_score_check,
    by_referral: sliceBy(all, "referral"),
    by_source_portal: sliceBy(all, "portal"),
    by_country: sliceBy(all, "country"),
    by_sponsorship: sliceBy(all, "sponsorship"),
  };

  if (JSON_ONLY) { console.log(JSON.stringify(result, null, 2)); return; }

  const pct = v => (v === null ? "  —" : `${String(v).padStart(4)}%`);
  const line = "─".repeat(72);
  console.log("\nCAREER-OPS FUNNEL METRICS  (the real KPIs — not Match score)");
  console.log(line);
  console.log(`Applications submitted : ${headline.applications_submitted}`);
  console.log(`Responses              : ${headline.responses}   (response rate ${pct(headline.response_rate_pct)})`);
  console.log(`Past the first stage   : ${headline.reached_first_stage_or_beyond}   (screen rate   ${pct(headline.screen_rate_pct)})`);
  console.log(`Rejections             : ${headline.rejections}   (rejection rate${pct(headline.rejection_rate_pct)})`);
  console.log(`Silent / no response   : ${headline.silent_no_response}`);
  console.log(line);
  console.log("MATCH-SCORE REALITY CHECK (avg Match score by outcome)");
  console.log(`  progressed: ${match_score_check.avg_score_progressed ?? "—"}   rejected: ${match_score_check.avg_score_rejected ?? "—"}   silent: ${match_score_check.avg_score_silent ?? "—"}`);
  console.log(`  → ${match_score_check.note}`);

  const table = (title, rows) => {
    console.log(line);
    console.log(title);
    console.log("  " + "group".padEnd(22) + "apps".padStart(5) + "resp%".padStart(8) + "screen%".padStart(9) + "rej%".padStart(7));
    for (const r of rows) {
      console.log(
        "  " + String(r.group).slice(0, 22).padEnd(22) +
        String(r.applications).padStart(5) +
        pct(r.response_rate_pct).padStart(8) +
        pct(r.screen_rate_pct).padStart(9) +
        pct(r.rejection_rate_pct).padStart(7),
      );
    }
  };
  table("BY REFERRAL", result.by_referral);
  table("BY SOURCE PORTAL", result.by_source_portal);
  table("BY COUNTRY", result.by_country);
  table("BY SPONSORSHIP", result.by_sponsorship);
  console.log(line);
  console.log(`(cohort = rows that reached "Applied" or beyond; min slice size ${MIN_COHORT})\n`);
}

main().catch(err => {
  console.error("ROUTINE_ABORT:", err.message);
  process.exit(1);
});
