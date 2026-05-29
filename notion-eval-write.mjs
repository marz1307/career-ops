#!/usr/bin/env node
/**
 * notion-eval-write.mjs — auto-eval routine writer
 *
 * Writes Match score + Recruiter-sim verdict + Fit notes + Agent run ID to a
 * Notion Applications page, then either promotes Stage to "2. Triaged"
 * (PROMOTE) or archives the page (DEMOTE, per triage.trash_below_floor).
 *
 * Auth: NOTION_TOKEN env var.
 *
 * Usage:
 *   node notion-eval-write.mjs --page <id> --score <0-100> \
 *     --verdict <INVITE|MAYBE|REJECT> --decision <promote|demote> \
 *     --runid <id> --notes "<fit notes text>"
 *
 * Exit 0 on success, non-zero on failure (prints WRITE_ERROR ...).
 */
import process from "node:process";

const args = process.argv.slice(2);
function arg(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("WRITE_ERROR: NOTION_TOKEN not set"); process.exit(5); }

const pageId = arg("--page");
const score = parseInt(arg("--score"), 10);
const verdict = arg("--verdict");
const decision = (arg("--decision") || "").toLowerCase();
const runid = arg("--runid");
const notes = arg("--notes") || "";

if (!pageId || Number.isNaN(score) || !verdict || !decision) {
  console.error("WRITE_ERROR: missing required arg (--page --score --verdict --decision)");
  process.exit(2);
}
if (!["promote", "demote", "notpursuing"].includes(decision)) {
  console.error("WRITE_ERROR: --decision must be promote|demote|notpursuing"); process.exit(2);
}
if (!["INVITE", "MAYBE", "REJECT"].includes(verdict)) {
  console.error("WRITE_ERROR: --verdict must be INVITE|MAYBE|REJECT"); process.exit(2);
}

const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const properties = {
  "Match score": { number: score },
  "Recruiter-sim verdict": { select: { name: verdict } },
  "Fit notes": { rich_text: [{ text: { content: notes.slice(0, 1900) } }] },
  "Agent run ID": { rich_text: [{ text: { content: runid || "auto-eval" } }] },
};
if (decision === "promote") {
  properties["Stage"] = { select: { name: "2. Triaged" } };
} else if (decision === "notpursuing") {
  properties["Stage"] = { select: { name: "Not pursuing" } };
}

const body = { properties };
if (decision === "demote") body.archived = true;

async function patchWithRetry() {
  const delays = [0, 1000, 4000, 16000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH", headers, body: JSON.stringify(body),
    });
    if (res.ok) return true;
    const txt = await res.text();
    if (res.status === 429 || res.status >= 500) { lastErr = `${res.status} ${txt}`; continue; }
    console.error(`WRITE_ERROR: ${res.status} ${txt}`); process.exit(1);
  }
  console.error(`WRITE_ERROR: retries exhausted ${lastErr || ""}`); process.exit(1);
}
let lastErr = "";
await patchWithRetry();
console.log(`WRITE_OK page=${pageId} score=${score} verdict=${verdict} decision=${decision}`);
