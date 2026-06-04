#!/usr/bin/env node
/**
 * apply-window.mjs — "Should I submit this application NOW?" helper
 *
 * Codifies the timing research findings (Tue–Thu, 06:30–09:00 local UK)
 * into a deterministic check. Reads `apply.*` from config/profile.yml so
 * the rules can be tuned centrally — no hardcoded times.
 *
 * Usage:
 *   node apply-window.mjs                    # human-readable status
 *   node apply-window.mjs --json             # JSON only
 *   node apply-window.mjs --role "Analytics Engineer" --posted 2026-05-23
 *                                            # also checks freshness for a specific posting
 *
 * Output contract (emits a ROUTINE_CONTRACT block parseable by callers):
 *   IN_WINDOW: true|false
 *   IN_FALLBACK_WINDOW: true|false
 *   IS_PREFERRED_DAY: true|false
 *   IS_ACCEPTABLE_DAY: true|false
 *   IS_AVOID_DAY: true|false
 *   NEXT_WINDOW_LOCAL: ISO timestamp of next preferred-day window open
 *   MINUTES_UNTIL_NEXT_WINDOW: int
 *   MONTH_INTENSITY: peak|strong|hidden|low|dead
 *   FRESHNESS_OK: true|false|n/a    (only if --role and --posted given)
 *   FRESHNESS_CEILING_DAYS: int|n/a
 *   FRESHNESS_AGE_DAYS: int|n/a
 *   RECOMMENDATION: send | hold | send-now-fast | skip-stale
 */

import { readFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";

const args = process.argv.slice(2);
const JSON_ONLY = args.includes("--json");
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const ROLE   = arg("--role");
const POSTED = arg("--posted");

// ── Config ──────────────────────────────────────────────────────────
function loadConfig() {
  const path = "config/profile.yml";
  if (!existsSync(path)) {
    console.error("⚠️  config/profile.yml missing — falling back to hardcoded defaults");
    return {};
  }
  try {
    return yaml.load(readFileSync(path, "utf8")) || {};
  } catch (e) {
    console.error(`⚠️  Failed to parse config/profile.yml: ${e.message}`);
    return {};
  }
}
const APPLY = (loadConfig().apply) || {};
const TZ            = APPLY.local_tz                 ?? "Europe/London";
const PREFERRED     = APPLY.preferred_days           ?? [2, 3, 4];
const ACCEPTABLE    = APPLY.acceptable_days          ?? [1];
const AVOID         = APPLY.avoid_days               ?? [5, 6, 7];
const W_START       = APPLY.window_start_hour        ?? 6.5;
const W_END         = APPLY.window_end_hour          ?? 9.0;
const FB_START      = APPLY.fallback_window_start_hour ?? 12.0;
const FB_END        = APPLY.fallback_window_end_hour   ?? 13.0;
const MONTH_INT     = APPLY.month_intensity          ?? {};
const FRESH_BY_ROLE = APPLY.freshness_days_by_role   ?? {};
const FRESH_DEFAULT = APPLY.freshness_default_days   ?? 7;

// ── Time helpers ────────────────────────────────────────────────────
// Use Intl.DateTimeFormat to get current local time in the configured TZ
// without dragging in moment-tz / luxon. We extract weekday + hour+minute.
function nowInTZ() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdayMap[parts.weekday],
    hourFloat: parseInt(parts.hour, 10) + parseInt(parts.minute, 10) / 60,
    month: parseInt(parts.month, 10),
    raw: parts,
  };
}

// Next preferred-day window open, expressed as ISO timestamp in local TZ.
// We compute by walking forward day-by-day until we land on a preferred day.
function nextWindowLocal(now) {
  let candidateWeekday = now.weekday;
  let daysAhead = 0;
  // If we're past today's window end on a preferred day, we need tomorrow+.
  if (PREFERRED.includes(now.weekday) && now.hourFloat < W_END) {
    // Today's window is either current (hourFloat < W_START → hours until open) or open NOW.
    // Either way the "next window" is today's W_START.
    if (now.hourFloat < W_START) {
      const minutes = Math.round((W_START - now.hourFloat) * 60);
      return { isoLocal: `${now.isoDate}T${formatHour(W_START)}`, minutesAhead: minutes };
    }
    return { isoLocal: `${now.isoDate}T${formatHour(W_START)}`, minutesAhead: 0 };
  }
  // Walk forward
  for (daysAhead = 1; daysAhead <= 8; daysAhead++) {
    candidateWeekday = ((now.weekday - 1 + daysAhead) % 7) + 1;
    if (PREFERRED.includes(candidateWeekday)) break;
  }
  // ISO date d days ahead in TZ — easiest: use Date arithmetic in UTC then re-format
  const baseUTC = new Date(`${now.isoDate}T12:00:00Z`);
  baseUTC.setUTCDate(baseUTC.getUTCDate() + daysAhead);
  const futureDate = baseUTC.toISOString().slice(0, 10);
  const minutes = Math.round((daysAhead * 24 * 60) - (now.hourFloat * 60) + (W_START * 60));
  return { isoLocal: `${futureDate}T${formatHour(W_START)}`, minutesAhead: minutes };
}

function formatHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ── Freshness ───────────────────────────────────────────────────────
function freshnessCheck(role, postedDate) {
  if (!role || !postedDate) return { applicable: false };
  const ceiling = FRESH_BY_ROLE[role] ?? FRESH_DEFAULT;
  const posted = new Date(postedDate + "T00:00:00Z");
  if (isNaN(posted.getTime())) return { applicable: false, error: `Cannot parse --posted: ${postedDate}` };
  const ageDays = (Date.now() - posted.getTime()) / (1000 * 60 * 60 * 24);
  return {
    applicable: true,
    ceiling,
    ageDays: Math.round(ageDays * 10) / 10,
    ok: ageDays <= ceiling,
  };
}

// ── Main ────────────────────────────────────────────────────────────
const now = nowInTZ();
const isPreferred = PREFERRED.includes(now.weekday);
const isAcceptable = ACCEPTABLE.includes(now.weekday);
const isAvoid     = AVOID.includes(now.weekday);
const inWindow    = (isPreferred || isAcceptable) && now.hourFloat >= W_START && now.hourFloat < W_END;
const inFallback  = (isPreferred || isAcceptable) && now.hourFloat >= FB_START && now.hourFloat < FB_END;
const next        = nextWindowLocal(now);
const monthHint   = MONTH_INT[String(now.month)] ?? MONTH_INT[now.month] ?? "unknown";
const fresh       = freshnessCheck(ROLE, POSTED);

// Recommendation
let recommendation;
if (fresh.applicable && !fresh.ok) {
  recommendation = "skip-stale";  // posting is past freshness ceiling
} else if (inWindow) {
  recommendation = "send";
} else if (inFallback) {
  recommendation = "send-now-fast"; // lunch fallback — usable but suboptimal
} else {
  recommendation = "hold";
}

const result = {
  now_local: `${now.isoDate}T${formatHour(now.hourFloat)} ${TZ}`,
  in_window: inWindow,
  in_fallback_window: inFallback,
  is_preferred_day: isPreferred,
  is_acceptable_day: isAcceptable,
  is_avoid_day: isAvoid,
  next_window_local: next.isoLocal,
  minutes_until_next_window: next.minutesAhead,
  month_intensity: monthHint,
  freshness: fresh,
  recommendation,
};

// Emit contract block
function emitContract() {
  const lines = [
    "--- ROUTINE_CONTRACT ---",
    "ROUTINE: apply-window",
    `TIMESTAMP_LOCAL: ${result.now_local}`,
    `IN_WINDOW: ${result.in_window}`,
    `IN_FALLBACK_WINDOW: ${result.in_fallback_window}`,
    `IS_PREFERRED_DAY: ${result.is_preferred_day}`,
    `IS_ACCEPTABLE_DAY: ${result.is_acceptable_day}`,
    `IS_AVOID_DAY: ${result.is_avoid_day}`,
    `NEXT_WINDOW_LOCAL: ${result.next_window_local}`,
    `MINUTES_UNTIL_NEXT_WINDOW: ${result.minutes_until_next_window}`,
    `MONTH_INTENSITY: ${result.month_intensity}`,
    `FRESHNESS_OK: ${fresh.applicable ? fresh.ok : "n/a"}`,
    `FRESHNESS_CEILING_DAYS: ${fresh.applicable ? fresh.ceiling : "n/a"}`,
    `FRESHNESS_AGE_DAYS: ${fresh.applicable ? fresh.ageDays : "n/a"}`,
    `RECOMMENDATION: ${result.recommendation}`,
    "--- END_ROUTINE_CONTRACT ---",
  ];
  console.log(lines.join("\n"));
}

if (JSON_ONLY) {
  console.log(JSON.stringify(result, null, 2));
  emitContract();
} else {
  console.log(`apply-window @ ${result.now_local}`);
  console.log(`  window status:    ${inWindow ? "✅ INSIDE preferred window" : inFallback ? "🟡 inside fallback (lunch)" : "❌ outside window"}`);
  console.log(`  day status:       ${isPreferred ? "✅ preferred day" : isAcceptable ? "🟡 acceptable day" : isAvoid ? "❌ avoid day" : "?"}`);
  console.log(`  next window:      ${next.isoLocal} (${next.minutesAhead} min from now)`);
  console.log(`  month intensity:  ${monthHint}`);
  if (fresh.applicable) {
    console.log(`  freshness:        ${fresh.ok ? "✅" : "❌ stale"} (${fresh.ageDays}d old vs ${fresh.ceiling}d ceiling for ${ROLE})`);
  }
  console.log("");
  const verdictMap = {
    "send":          "✅ SEND now",
    "send-now-fast": "🟡 SEND fast (lunch fallback — quality > nothing)",
    "hold":          "⏸ HOLD until next window",
    "skip-stale":    "❌ SKIP — posting too old for this role family",
  };
  console.log(`  → ${verdictMap[recommendation] || recommendation}`);
  console.log("");
  console.log("--- JSON ---");
  console.log(JSON.stringify(result, null, 2));
  emitContract();
}
