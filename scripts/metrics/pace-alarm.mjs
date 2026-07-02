#!/usr/bin/env node
/**
 * pace-alarm.mjs — apply-pace monitor + apply-window adherence tracker
 *
 * Reads `data/applications.md` (the local cache mirror of Notion) and
 * surfaces the apply pace for the last 7 days plus `WINDOW_ADHERENCE_PCT`
 * (fraction of applies that landed on preferred days per `apply.preferred_days`).
 *
 * Targets are read from `config/profile.yml → pace.*` (single source of truth):
 *   - target_per_day, target_per_week
 *   - alarm_threshold_per_day, alarm_consecutive_days
 *   - staleness_threshold_hours (defaults to 36 if absent)
 *
 * Status field: "ok | warning | alarm | error".
 * Alarm is auto-downgraded to "warning" when the local cache is stale
 * (cannot trust a 0/7d reading against an unwritten mirror).
 *
 * Usage:
 *   node pace-alarm.mjs              # human-readable + JSON + contract block
 *   node pace-alarm.mjs --json       # JSON + contract block only
 *   node pace-alarm.mjs --target 35  # override per-day target
 *
 * Scheduled: 17:00 UK weekdays via `CareerOps_PaceCheck` Task Scheduler
 * entry. The wrapper validates the emitted ROUTINE_CONTRACT block.
 *
 * NOTE: reads the local-cache (applications.md) not Notion directly. The
 * cache is intended to be parallel-write by `modes/apply.md` when the user
 * submits applications; if Cowork side hasn't been wired, the cache will
 * stay empty and pace-alarm will surface a stale-cache warning instead
 * of a false alarm.
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import yaml from "js-yaml";

const args = process.argv.slice(2);
const JSON_ONLY = args.includes("--json");

// Read targets from config/profile.yml (single source of truth). CLI
// --target still overrides for ad-hoc tuning.
function loadConfig() {
  const path = "config/profile.yml";
  if (!existsSync(path)) return {};
  try {
    return yaml.load(readFileSync(path, "utf8")) || {};
  } catch (e) {
    console.error(`⚠️  Failed to parse ${path}: ${e.message}. Falling back to defaults.`);
    return {};
  }
}
const CONFIG = loadConfig();
const PACE_CFG = CONFIG.pace || {};
const APPLY_CFG = CONFIG.apply || {};
// ISO weekday: 1=Mon..7=Sun. applications.md only records DATE, not time,
// so we can only assess day-of-week adherence — not hour-of-day. The hour
// gate lives in apply-window.mjs (used at submit-time).
const APPLY_PREFERRED_DAYS  = APPLY_CFG.preferred_days  ?? [2, 3, 4];
const APPLY_ACCEPTABLE_DAYS = APPLY_CFG.acceptable_days ?? [1];

const TARGET_PER_DAY = (() => {
  const i = args.indexOf("--target");
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10);
  return PACE_CFG.target_per_day ?? 29;
})();
const TARGET_PER_WEEK = PACE_CFG.target_per_week ?? (TARGET_PER_DAY * 7);
const ALARM_THRESHOLD_PER_DAY = PACE_CFG.alarm_threshold_per_day ?? 25;
const ALARM_CONSECUTIVE_DAYS = PACE_CFG.alarm_consecutive_days ?? 2;

const APPLICATIONS_PATH = "data/applications.md";
// Cache freshness threshold: apply.md is meant to parallel-write to
// applications.md whenever an application is submitted. If the file
// hasn't been touched in >threshold hours, pace numbers are advisory.
const STALENESS_THRESHOLD_HOURS = PACE_CFG.staleness_threshold_hours ?? 36;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function parseApplicationsMd(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    // A missing cache is not an error — the file is a local mirror that
    // apply.md writes on the first submit. Treat "never written yet" as an
    // empty dataset so pace surfaces a stale-cache warning (per this file's
    // header) rather than a hard exit-1 false alarm. checkStaleness() already
    // flags the absence. Any OTHER read failure (permissions, etc.) is fatal.
    if (e.code === "ENOENT") return { rows: [] };
    return { rows: [], error: `Cannot read ${path}: ${e.message}` };
  }
  // Find the table rows. Format:
  // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
  // |---|...
  // | 1 | 2026-05-23 | Zalando | Analytics Engineer | 4.3/5 | Applied | ✅ | [001](...) | ... |
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;
    if (line.toLowerCase().includes("| # |")) continue; // header
    const cells = line.split("|").map(s => s.trim());
    // cells[0] is "" (before first |); cells[1] is the # column
    if (cells.length < 7) continue;
    const num = cells[1];
    const date = cells[2];
    const company = cells[3];
    const role = cells[4];
    const status = cells[6]; // status column (per AGENTS.md: score before status in applications.md)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({ num, date, company, role, status });
  }
  return { rows };
}

function countAppliedByDate(rows) {
  const counts = {};
  for (const r of rows) {
    const status = (r.status || "").toLowerCase();
    if (status === "applied" || status === "responded" || status === "interview" || status === "offer") {
      counts[r.date] = (counts[r.date] || 0) + 1;
    }
  }
  return counts;
}

function rollingWindow(counts, days) {
  const window = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i);
    window.push({ date: d, count: counts[d] || 0 });
  }
  return window;
}

function evaluate(window7) {
  const counts = window7.map(d => d.count);
  const todayCount = counts[counts.length - 1];
  const sum = counts.reduce((a, b) => a + b, 0);
  const avg = sum / window7.length;

  // Consecutive low days ending today (or yesterday if today is fresh)
  let consec = 0;
  for (let i = counts.length - 1; i >= 0; i--) {
    if (counts[i] < ALARM_THRESHOLD_PER_DAY) consec++;
    else break;
  }

  let status, suggestion;
  if (consec >= ALARM_CONSECUTIVE_DAYS) {
    status = "alarm";
    suggestion = `Apply pace below ${ALARM_THRESHOLD_PER_DAY}/day for ${consec} consecutive days. Expand fan-out: broaden role-family filter in portals.yml (add adjacent titles), enable extra EMEA countries in location_filter, or relax title_filter.negative to surface borderline roles.`;
  } else if (avg < ALARM_THRESHOLD_PER_DAY) {
    status = "warning";
    suggestion = `Rolling 7-day average ${avg.toFixed(1)}/day vs ${TARGET_PER_DAY}/day target. Not yet alarm but trending. Review the top-of-funnel: is scan returning enough hits? Check the funnel in /career-ops tracker.`;
  } else if (avg < TARGET_PER_DAY) {
    status = "warning";
    suggestion = `Rolling 7-day average ${avg.toFixed(1)}/day vs ${TARGET_PER_DAY}/day target. Above the alarm floor (${ALARM_THRESHOLD_PER_DAY}) but below target. Monitor.`;
  } else {
    status = "ok";
    suggestion = `On pace. ${avg.toFixed(1)}/day average, ${sum} applied in last 7 days vs ${TARGET_PER_WEEK} weekly target.`;
  }

  return {
    today: today(),
    applied_today: todayCount,
    applied_last_7_days: window7.map(d => d.count),
    rolling_7_day_sum: sum,
    rolling_7_day_avg_per_day: Math.round(avg * 10) / 10,
    target_per_day: TARGET_PER_DAY,
    target_per_week: TARGET_PER_WEEK,
    alarm_threshold_per_day: ALARM_THRESHOLD_PER_DAY,
    status,
    consecutive_low_days: consec,
    suggestion,
  };
}

// ── Apply-window adherence ──────────────────────────────────────────
// Of the applications submitted in the last 7 days, what fraction landed
// on a preferred day (Tue–Thu by default)? Volume alone is a poor metric
// per the 2026-05-25 timing research — apps submitted on Fri/weekend are
// ~50% as likely to convert. This metric makes that visible.
function computeWindowAdherence(rows) {
  const dayCounts = { preferred: 0, acceptable: 0, avoid: 0, unknown: 0 };
  let total = 0;
  // Look at applied/responded/interview/offer rows in the last 7 days
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  for (const r of rows) {
    const status = (r.status || "").toLowerCase();
    if (!["applied", "responded", "interview", "offer"].includes(status)) continue;
    const d = new Date(r.date + "T00:00:00Z");
    if (isNaN(d.getTime()) || d < cutoff) continue;
    // ISO weekday: getUTCDay() returns 0=Sun..6=Sat — convert to 1=Mon..7=Sun
    const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    total++;
    if (APPLY_PREFERRED_DAYS.includes(isoDow)) dayCounts.preferred++;
    else if (APPLY_ACCEPTABLE_DAYS.includes(isoDow)) dayCounts.acceptable++;
    else dayCounts.avoid++;
  }
  if (total === 0) {
    return {
      total_applied_7d: 0,
      preferred_day_count: 0,
      acceptable_day_count: 0,
      avoid_day_count: 0,
      adherence_pct: null,        // can't compute on empty sample
      note: "no applied rows in last 7 days",
    };
  }
  return {
    total_applied_7d: total,
    preferred_day_count: dayCounts.preferred,
    acceptable_day_count: dayCounts.acceptable,
    avoid_day_count: dayCounts.avoid,
    // Adherence = fraction landing on preferred OR acceptable days.
    adherence_pct: Math.round(((dayCounts.preferred + dayCounts.acceptable) / total) * 1000) / 10,
    preferred_pct: Math.round((dayCounts.preferred / total) * 1000) / 10,
  };
}

// Cache freshness: applications.md is a local mirror of Notion. If it
// hasn't been touched in >STALENESS_THRESHOLD_HOURS, the pace number is
// not trustworthy — callers should treat the result as advisory.
function checkStaleness() {
  if (!existsSync(APPLICATIONS_PATH)) {
    return {
      stale: true,
      reason: `${APPLICATIONS_PATH} does not exist — local cache never written`,
      mtime_iso: null,
      hours_since_mtime: null,
    };
  }
  const mtime = statSync(APPLICATIONS_PATH).mtime;
  const hours = (Date.now() - mtime.getTime()) / (1000 * 60 * 60);
  if (hours > STALENESS_THRESHOLD_HOURS) {
    return {
      stale: true,
      reason: `${APPLICATIONS_PATH} last modified ${hours.toFixed(1)}h ago (>${STALENESS_THRESHOLD_HOURS}h threshold) — local cache likely out of sync with Notion`,
      mtime_iso: mtime.toISOString(),
      hours_since_mtime: Math.round(hours * 10) / 10,
    };
  }
  return {
    stale: false,
    reason: null,
    mtime_iso: mtime.toISOString(),
    hours_since_mtime: Math.round(hours * 10) / 10,
  };
}

// Emit the routine output-contract block on stdout. Routine prompts
// echo this verbatim instead of constructing it from individual values,
// preventing transcription drift between doc and script.
function emitContractBlock(result, staleness) {
  const wa = result.window_adherence || {};
  const lines = [
    "--- ROUTINE_CONTRACT ---",
    "ROUTINE: pace-check",
    `TIMESTAMP_UTC: ${new Date().toISOString()}`,
    `TODAY_COUNT: ${result.applied_today}`,
    `YESTERDAY_COUNT: ${result.applied_last_7_days[result.applied_last_7_days.length - 2] ?? 0}`,
    `ROLLING_7D_AVG: ${result.rolling_7_day_avg_per_day}`,
    `TARGET_PER_DAY: ${result.target_per_day}`,
    `ALARM_THRESHOLD_PER_DAY: ${result.alarm_threshold_per_day}`,
    `CONSECUTIVE_BELOW_TARGET_DAYS: ${result.consecutive_low_days}`,
    `WEEKLY_ACTUAL: ${result.rolling_7_day_sum}`,
    `WEEKLY_TARGET: ${result.target_per_week}`,
    `WEEKLY_GAP: ${Math.max(0, result.target_per_week - result.rolling_7_day_sum)}`,
    `ALARM_TRIGGERED: ${result.status === "alarm"}`,
    `CACHE_STALE: ${staleness.stale}`,
    `CACHE_MTIME: ${staleness.mtime_iso ?? "n/a"}`,
    `CACHE_HOURS_OLD: ${staleness.hours_since_mtime ?? "n/a"}`,
    `WINDOW_TOTAL_APPLIED_7D: ${wa.total_applied_7d ?? 0}`,
    `WINDOW_PREFERRED_COUNT: ${wa.preferred_day_count ?? 0}`,
    `WINDOW_ACCEPTABLE_COUNT: ${wa.acceptable_day_count ?? 0}`,
    `WINDOW_AVOID_COUNT: ${wa.avoid_day_count ?? 0}`,
    `WINDOW_ADHERENCE_PCT: ${wa.adherence_pct ?? "n/a"}`,
    `WINDOW_PREFERRED_PCT: ${wa.preferred_pct ?? "n/a"}`,
    "--- END_ROUTINE_CONTRACT ---",
  ];
  console.log(lines.join("\n"));
}

function main() {
  const staleness = checkStaleness();
  const { rows, error } = parseApplicationsMd(APPLICATIONS_PATH);
  if (error) {
    const result = { status: "error", error, cache_staleness: staleness };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const counts = countAppliedByDate(rows);
  const window7 = rollingWindow(counts, 7);
  const result = evaluate(window7);
  result.cache_staleness = staleness;
  result.window_adherence = computeWindowAdherence(rows);

  // Soft-downgrade the alarm if the cache is stale. We can't trust a
  // "0 apps in 7 days" reading if the mirror hasn't been written to.
  if (staleness.stale && result.status === "alarm") {
    result.status = "warning";
    result.suggestion = `[CACHE STALE — ${staleness.reason}] Downgraded alarm to warning. ` + result.suggestion;
  }

  if (JSON_ONLY) {
    console.log(JSON.stringify(result, null, 2));
    emitContractBlock(result, staleness);
    return;
  }

  const wa = result.window_adherence || {};
  console.log(`pace-alarm @ ${result.today}`);
  console.log(`  applied today: ${result.applied_today}`);
  console.log(`  last 7 days:   ${result.applied_last_7_days.join(", ")}`);
  console.log(`  7-day sum:     ${result.rolling_7_day_sum}  (target ${result.target_per_week}/week)`);
  console.log(`  7-day avg/day: ${result.rolling_7_day_avg_per_day}  (target ${result.target_per_day}/day, alarm < ${result.alarm_threshold_per_day})`);
  console.log(`  consec. low:   ${result.consecutive_low_days} day(s)`);
  console.log(`  cache freshness: ${staleness.stale ? "STALE — " + staleness.reason : "ok (" + staleness.hours_since_mtime + "h old)"}`);
  if (wa.total_applied_7d > 0) {
    console.log(`  window adherence: ${wa.adherence_pct}% on preferred/acceptable days (${wa.preferred_day_count}/${wa.acceptable_day_count}/${wa.avoid_day_count} pref/accept/avoid out of ${wa.total_applied_7d})`);
  } else {
    console.log(`  window adherence: ${wa.note ?? "n/a"}`);
  }
  console.log(`  status:        ${result.status.toUpperCase()}`);
  console.log("");
  console.log(`  ${result.suggestion}`);
  // Bonus advisory if adherence is weak but volume is decent
  if (wa.adherence_pct !== null && wa.adherence_pct !== undefined && wa.adherence_pct < 60 && wa.total_applied_7d >= 5) {
    console.log("");
    console.log(`  ⚠ Window adherence below 60% — most applications landed on suboptimal days (Fri/weekend). Per timing research, those convert at roughly half the rate of Tue–Thu submissions. Shift sends to Tue–Thu 06:30–09:00 UK.`);
  }
  console.log("");
  console.log("--- JSON ---");
  console.log(JSON.stringify(result, null, 2));
  emitContractBlock(result, staleness);
}

main();
