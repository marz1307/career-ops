#!/usr/bin/env node
/**
 * notion-write-eval.mjs — Batch-apply auto-eval decisions to the Applications DB.
 *
 * Reads a decisions JSON file (array) and applies each via the Notion REST API.
 * Auth: NOTION_TOKEN env var (same token notion-query.mjs uses).
 *
 * Decision record shape:
 *   {
 *     "id": "<page-uuid>",
 *     "company": "<short>",            // for logging only
 *     "decision": "PROMOTE" | "DEMOTE" | "FETCH_FAILED" | "SKIP_NO_URL",
 *     "match_score": 82,               // omit for SKIP_NO_URL
 *     "verdict": "INVITE|MAYBE|REJECT",// omit for SKIP_NO_URL
 *     "fit_notes": "…",
 *     "agent_run_id": "auto-eval-2026-05-25-2100"
 *   }
 *
 * Semantics (per modes/oferta.md):
 *   PROMOTE      → set Match score, Recruiter-sim verdict, Fit notes,
 *                  Agent run ID, Stage="2. Triaged".
 *   DEMOTE       → set Match score, Recruiter-sim verdict, Fit notes,
 *                  Agent run ID, then archive the page (archived:true).
 *   FETCH_FAILED → set Fit notes, Agent run ID, Stage="Not pursuing".
 *   SKIP_NO_URL  → set Fit notes only, leave Stage at "1. Discovered".
 *
 * Usage: node notion-write-eval.mjs --in data/.routine-tmp/decisions.json [--dry]
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const IN = arg("--in");
const DRY = args.includes("--dry");

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("ABORT: NOTION_TOKEN not set"); process.exit(5); }
if (!IN) { console.error("ABORT: --in <file> required"); process.exit(2); }

const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function patch(pageId, body, attempt = 1) {
  const res = await fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH", headers: HEADERS, body: JSON.stringify(body),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt <= 3) {
      const wait = [1000, 4000, 16000][attempt - 1];
      await sleep(wait);
      return patch(pageId, body, attempt + 1);
    }
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

function propsFor(d) {
  const p = {};
  if (typeof d.match_score === "number") p["Match score"] = { number: d.match_score };
  if (d.verdict) p["Recruiter-sim verdict"] = { select: { name: d.verdict } };
  if (d.fit_notes) p["Fit notes"] = { rich_text: [{ type: "text", text: { content: d.fit_notes.slice(0, 1990) } }] };
  if (d.agent_run_id) p["Agent run ID"] = { rich_text: [{ type: "text", text: { content: d.agent_run_id } }] };
  return p;
}

const decisions = JSON.parse(readFileSync(IN, "utf8"));
const result = { ok: 0, fail: 0, byDecision: {}, errors: [] };

for (const d of decisions) {
  result.byDecision[d.decision] = (result.byDecision[d.decision] || 0) + 1;
  try {
    if (d.decision === "PROMOTE") {
      const props = propsFor(d);
      props["Stage"] = { select: { name: "2. Triaged" } };
      if (!DRY) await patch(d.id, { properties: props });
    } else if (d.decision === "DEMOTE") {
      const props = propsFor(d);
      if (!DRY) await patch(d.id, { properties: props });
      if (!DRY) await patch(d.id, { archived: true });
    } else if (d.decision === "FETCH_FAILED") {
      const props = propsFor(d);
      props["Stage"] = { select: { name: "Not pursuing" } };
      if (!DRY) await patch(d.id, { properties: props });
    } else if (d.decision === "SKIP_NO_URL") {
      const props = propsFor(d); // fit notes only; no stage change
      if (!DRY) await patch(d.id, { properties: props });
    } else {
      throw new Error("unknown decision: " + d.decision);
    }
    result.ok++;
    console.error(`OK   ${d.decision.padEnd(12)} ${d.company || d.id}${typeof d.match_score === "number" ? " (" + d.match_score + ")" : ""}`);
    await sleep(120); // gentle pacing under Notion's ~3 req/s
  } catch (e) {
    result.fail++;
    result.errors.push(`${d.company || d.id}: ${e.message}`);
    console.error(`FAIL ${d.decision.padEnd(12)} ${d.company || d.id}: ${e.message}`);
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.fail > 0 ? 1 : 0);
