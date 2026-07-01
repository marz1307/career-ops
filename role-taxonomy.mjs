// role-taxonomy.mjs — read-only consumer of config/role-taxonomy.yml.
//
// OPTIONAL, opt-in module. It READS a user-supplied taxonomy; it hardcodes NO
// role names. The scanner and any scoring script can import this instead of
// hand-maintaining title lists — but the whole pipeline still works with NO
// taxonomy file present (every function degrades gracefully).
//
// To enable: copy config/role-taxonomy.example.yml → config/role-taxonomy.yml
// and edit it to match your target roles. Delete the file to revert to the
// hand-maintained portals.yml title_filter lists.
//
// Exposes:
//   loadTaxonomy(root)                     -> parsed taxonomy | null (absent = fall back)
//   deriveTitleFilter(tax, {includeWatch}) -> { positive:[], negative:[] }
//   classifyTitle(tax, title)              -> { name, archetype, tier, penalty } | null
//   deriveQueries(tax, countries)          -> [{ role, country }] from core archetype names
//
// Tier policy:
//   core     -> positive, no penalty
//   adjacent -> positive, scoring penalty (must clear a higher bar)
//   watch    -> positive ONLY when includeWatch; heavy penalty (hand-review)
//   exclude  -> negative (from `exclusions`)
'use strict';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export const TIER_PENALTY = { core: 0, adjacent: 15, watch: 40 };

/**
 * Load the taxonomy from `<root>/config/role-taxonomy.yml`.
 * Returns the parsed object, or null when the file is absent or malformed —
 * callers MUST treat null as "no taxonomy configured" and fall back to their
 * existing behaviour (never crash).
 *
 * @param {string} [root]
 * @returns {object|null}
 */
export function loadTaxonomy(root = '.') {
  const p = path.join(root, 'config', 'role-taxonomy.yml');
  if (!existsSync(p)) return null;
  let tax;
  try {
    tax = yaml.load(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  if (!tax || !Array.isArray(tax.roles) || !Array.isArray(tax.exclusions)) return null;
  return tax;
}

/**
 * Names that make a title a positive match, given the include-watch flag.
 * `negative` is drawn from the `exclusions` list.
 *
 * @param {object} tax
 * @param {{ includeWatch?: boolean }} [opts]
 * @returns {{ positive: string[], negative: string[] }}
 */
export function deriveTitleFilter(tax, { includeWatch = false } = {}) {
  const tiers = includeWatch ? ['core', 'adjacent', 'watch'] : ['core', 'adjacent'];
  const positive = [];
  for (const r of tax.roles) {
    if (!tiers.includes(r.tier)) continue;
    positive.push(r.name, ...(r.aliases || []));
  }
  const negative = tax.exclusions.map(e => e.name);
  // de-dupe (aliases can repeat a bare name) while preserving order
  const uniq = arr => [...new Set(arr)];
  return { positive: uniq(positive), negative: uniq(negative) };
}

/**
 * Classify a scanned title to its archetype + tier. Case-insensitive substring;
 * the LONGEST matching name/alias wins so "Analytics Engineer" beats "Analytics".
 *
 * @param {object} tax
 * @param {string} title
 * @returns {{ name: string, archetype: string, tier: string, penalty: number }|null}
 */
export function classifyTitle(tax, title) {
  if (!title) return null;
  const lower = String(title).toLowerCase();
  let best = null, bestLen = -1;
  for (const r of tax.roles) {
    for (const cand of [r.name, ...(r.aliases || [])]) {
      const c = cand.toLowerCase();
      if (lower.includes(c) && c.length > bestLen) {
        best = r; bestLen = c.length;
      }
    }
  }
  if (!best) return null;
  return { name: best.name, archetype: best.archetype, tier: best.tier, penalty: TIER_PENALTY[best.tier] ?? 0 };
}

/**
 * Resolve an archetype KEY to the display name used in generated scan queries.
 * Reads the mapping from the taxonomy itself (`archetype_query_names:` or the
 * `archetypes:` list of `{ key, query_name }` objects). Never hardcodes role
 * names. Falls back to using the key verbatim when no mapping is provided.
 *
 * @param {object} tax
 * @param {string} key
 * @returns {string}
 */
function archetypeQueryName(tax, key) {
  const map = tax.archetype_query_names;
  if (map && typeof map === 'object' && map[key]) return map[key];
  if (Array.isArray(tax.archetypes)) {
    for (const a of tax.archetypes) {
      if (a && typeof a === 'object' && a.key === key && a.query_name) return a.query_name;
    }
  }
  return key;
}

/**
 * Generate scan queries = core-tier archetypes × countries. Replaces a
 * hand-maintained query list. One query per distinct core archetype per country.
 * Archetype → query display name comes from the taxonomy (see archetypeQueryName).
 *
 * @param {object} tax
 * @param {string[]} countries
 * @returns {{ role: string, country: string }[]}
 */
export function deriveQueries(tax, countries) {
  const coreArchetypes = [...new Set(tax.roles.filter(r => r.tier === 'core').map(r => r.archetype))];
  const out = [];
  for (const a of coreArchetypes) {
    const role = archetypeQueryName(tax, a);
    if (!role) continue;
    for (const country of countries) out.push({ role, country });
  }
  return out;
}
