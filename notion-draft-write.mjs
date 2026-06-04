#!/usr/bin/env node
/**
 * notion-draft-write.mjs
 *
 * Auto-draft companion to notion-eval-write.mjs. Writes the Stage-3
 * page-property update for a drafted Applications row: Stage -> "3. Drafted",
 * CV variant, CL variant, Agent run ID, and a Fit-notes value (caller assembles
 * the sentinel + preserved prior notes). File properties (Resume / Cover Letter)
 * are set separately by notion-upload-file.mjs.
 *
 * Usage:
 *   node notion-draft-write.mjs --page <id> \
 *     --cvvariant "EN-tailored" --clvariant "EN" \
 *     --runid <id> --notes "<full fit notes text>" [--json]
 *
 * Exit codes: 0 ok, 1 api error, 2 bad args, 5 no token.
 */
const args = process.argv.slice(2);
function arg(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const JSON_ONLY = args.includes("--json");

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error("WRITE_ERROR: NOTION_TOKEN not set"); process.exit(5); }

const pageId = arg("--page");
const cvVariant = arg("--cvvariant");
const clVariant = arg("--clvariant");
const runid = arg("--runid");
const notes = arg("--notes") || "";
const stage = arg("--stage") || "3. Drafted";

if (!pageId) { console.error("WRITE_ERROR: --page required"); process.exit(2); }

const properties = {
  "Stage": { select: { name: stage } },
  "Fit notes": { rich_text: [{ text: { content: notes.slice(0, 1990) } }] },
};
if (cvVariant) properties["CV variant"] = { select: { name: cvVariant } };
if (clVariant) properties["CL variant"] = { select: { name: clVariant } };
if (runid) properties["Agent run ID"] = { rich_text: [{ text: { content: runid } }] };

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

let lastErr = "";
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH", headers, body: JSON.stringify({ properties }),
    });
    if (res.ok) {
      const j = await res.json();
      if (JSON_ONLY) console.log(JSON.stringify({ status: "ok", page: j.id, stage }));
      else console.log(`OK ${pageId} -> ${stage}`);
      process.exit(0);
    }
    const txt = await res.text();
    lastErr = `${res.status} ${txt}`;
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 30000)); continue; }
    console.error(`WRITE_ERROR: ${lastErr}`); process.exit(1);
  } catch (e) { lastErr = e.message; await new Promise(r => setTimeout(r, 5000)); }
}
console.error(`WRITE_ERROR: retries exhausted ${lastErr}`); process.exit(1);
