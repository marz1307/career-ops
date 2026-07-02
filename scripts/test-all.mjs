#!/usr/bin/env node

/**
 * test-all.mjs — Marketplace test suite for career-ops
 *
 * Run before merging any PR or pushing changes. Validates the
 * marketplace-skill architecture (engine vs workspace, SKILL.md at
 * repo root, no personal data leaks, scripts parse, YAML/JSON valid,
 * required template files present, gitignore covers user-layer).
 *
 * Usage:
 *   node test-all.mjs           # Full run
 *   node test-all.mjs --quick   # Skip the dashboard go-build step
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const QUICK = process.argv.includes('--quick');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

console.log('\n🧪 career-ops marketplace test suite\n');

// ── 1. JS syntax checks ───────────────────────────────────────────

console.log('1. JS syntax');

function walkMjs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git') continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMjs(full));
    else if (e.endsWith('.mjs')) out.push(relative(ROOT, full));
  }
  return out;
}
const mjsFiles = walkMjs(ROOT);
for (const f of mjsFiles) {
  const result = run(NODE, ['--check', f]);
  if (result !== null) pass(`${f} parses`);
  else fail(`${f} has syntax errors`);
}

// ── 2. YAML lint ──────────────────────────────────────────────────

console.log('\n2. YAML lint');

let yaml;
try {
  yaml = (await import('js-yaml')).default;
} catch (e) {
  warn('js-yaml not installed — skipping YAML lint (run `npm install` first)');
  yaml = null;
}

if (yaml) {
  const yamlFiles = [
    'templates/portals.example.yml',
    'config/profile.example.yml',
    'templates/states.yml',
  ];
  for (const f of yamlFiles) {
    if (!fileExists(f)) { fail(`Missing YAML file: ${f}`); continue; }
    try { yaml.load(readFile(f)); pass(`${f} valid YAML`); }
    catch (e) { fail(`${f} invalid YAML: ${e.message.split('\n')[0]}`); }
  }
}

// ── 3. JSON lint ──────────────────────────────────────────────────

console.log('\n3. JSON lint');

const jsonFiles = ['package.json'];
for (const f of jsonFiles) {
  try { JSON.parse(readFile(f)); pass(`${f} valid JSON`); }
  catch (e) { fail(`${f} invalid: ${e.message}`); }
}

// ── 4. SKILL.md frontmatter ───────────────────────────────────────

console.log('\n4. SKILL.md frontmatter');

if (!fileExists('SKILL.md')) {
  fail('SKILL.md missing at repo root');
} else if (yaml) {
  const skillContent = readFile('SKILL.md');
  const m = skillContent.match(/^---\n([\s\S]+?)\n---/);
  if (!m) { fail('SKILL.md has no frontmatter block'); }
  else {
    try {
      const fm = yaml.load(m[1]);
      if (fm.name === 'career-ops') pass('SKILL.md name=career-ops');
      else fail(`SKILL.md name is "${fm.name}", expected "career-ops"`);
      if (fm['user-invocable'] === true) pass('SKILL.md user-invocable: true');
      else fail('SKILL.md user-invocable not set');
      if (typeof fm.description === 'string' && fm.description.length > 50) pass('SKILL.md description present');
      else fail('SKILL.md description missing or too short');
      if (fm.license) pass(`SKILL.md license: ${fm.license}`);
      else warn('SKILL.md license not declared');
    } catch (e) {
      fail(`SKILL.md frontmatter invalid YAML: ${e.message.split('\n')[0]}`);
    }
  }
}

// ── 5. Required template / engine files ───────────────────────────

console.log('\n5. Required engine files');

const required = [
  'SKILL.md', 'README.md', 'LICENSE', 'CLAUDE.md', 'AGENTS.md', 'DATA_CONTRACT.md',
  'package.json', '.env.example', '.gitignore',
  'config/profile.example.yml',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md', 'modes/apply.md',
  'modes/auto-pipeline.md', 'modes/tracker.md', 'modes/notion-tracker.md',
  'templates/portals.example.yml', 'templates/cv-template.html', 'templates/states.yml',
  'scripts/scan/scan.mjs', 'scripts/cv/generate-pdf.mjs',
];
for (const f of required) {
  if (fileExists(f)) pass(`exists: ${f}`);
  else fail(`MISSING: ${f}`);
}

// ── 6. User-layer files NOT tracked ───────────────────────────────

console.log('\n6. User-layer files NOT tracked');

const userLayer = [
  'cv.md', 'config/profile.yml', 'modes/_profile.md',
  'portals.yml', '.env', 'data/applications.md',
];
for (const f of userLayer) {
  const tracked = run('git', ['ls-files', f]);
  if (!tracked) pass(`gitignored / untracked: ${f}`);
  else fail(`USER FILE IS TRACKED (should be gitignored): ${f}`);
}

// ── 7. Personal data leak check ───────────────────────────────────

console.log('\n7. Personal data leak check');

const leakPatterns = [
  'Marvis', 'marvis', 'Osazuwa',
  'marvis.osazuwa@hotmail',
  'Force24', 'FMBN', 'Eraneos', 'Vinted',
  'marz1307.github.io',
  'Lebenslauf', 'Anschreiben', 'cv-de.md',
  // DE-specific portals that were stripped from the marketplace build —
  // guarded so they don't drift back in. eFinancialCareers (UK) is NOT
  // here because the user deliberately added it as a public UK fintech
  // portal (see templates/portals.example.yml + modes/notion-tracker.md).
  'Stepstone', 'stepstone.de',
  'make-it-in-germany', 'careerbee',
  '\\bXing\\b', 'xing.com',
];
const allowed = [
  'package.json',    // author field intentionally contains "Marvis Osazuwa (https://github.com/marz1307)"
  'package-lock.json',
  'README.md',       // may mention marz1307 in install commands
  'scripts/test-all.mjs', // this file lists the patterns
];

let leakFound = 0;
for (const pattern of leakPatterns) {
  const result = run(`git grep -n "${pattern}" 2>/dev/null`);
  if (!result) continue;
  for (const line of result.split('\n')) {
    const file = line.split(':')[0];
    if (allowed.some(a => file === a || file.endsWith('/' + a))) continue;
    fail(`Personal data in ${file}: "${pattern}"`);
    leakFound++;
  }
}
if (leakFound === 0) pass('No personal data leaks');

// ── 8. Credential leak check ──────────────────────────────────────

console.log('\n8. Credential leak check');

// Reconstruct sensitive sentinel from parts so this file doesn't self-match.
const SENTINEL_BD_TOKEN = ['af5091b6', '6eb3', '4246', '9ce6', '8ed1fc3ec88c'].join('-');

const credPatterns = [
  'ntn_[A-Za-z0-9]\\{30,\\}',
  'sk-[A-Za-z0-9]\\{30,\\}',
  'ghp_[A-Za-z0-9]\\{30,\\}',
  SENTINEL_BD_TOKEN,                                 // specific BD token to never leak
];
let credFound = 0;
for (const pattern of credPatterns) {
  // Exclude test-all.mjs itself — the patterns above are literals in this file.
  const result = run(`git grep -nE "${pattern}" -- ':!scripts/test-all.mjs' 2>/dev/null`);
  if (!result) continue;
  for (const line of result.split('\n')) {
    if (line.includes('xxxx')) continue;       // placeholder, fine
    fail(`Possible credential: ${line.slice(0, 100)}`);
    credFound++;
  }
}
if (credFound === 0) pass('No real credentials in repo');

// ── 9. Absolute path check ────────────────────────────────────────

console.log('\n9. Absolute path check');

// Build the regex from non-literal parts so the source line below doesn't self-match.
const absPathRegex = ['/Users/', 'marvi', '|/Users/santifer|C:', '\\\\Users\\\\marvi'].join('');
const absPathResult = run(
  `git grep -nE "${absPathRegex}" -- '*.mjs' '*.sh' '*.md' '*.yml' ':!scripts/test-all.mjs' 2>/dev/null`
);
if (!absPathResult) pass('No personal absolute paths in tracked files');
else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 120)}`);
  }
}

// ── 10. Liveness classifier behaviour ─────────────────────────────

console.log('\n10. Liveness classifier');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'scripts/scan/liveness-core.mjs')).href);

  const expired = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expired.result === 'expired') pass('Expired pages classified as expired');
  else fail(`Expired page misclassified as ${expired.result}`);

  const active = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: '663 JOBS FOUND\nSenior AI Engineer\nJoin our applied AI team to ship production systems.',
    applyControls: ['Apply for this Job'],
  });
  if (active.result === 'active') pass('Active job pages classified as active');
  else fail(`Active job page misclassified as ${active.result}`);
} catch (e) {
  fail(`Liveness classifier crashed: ${e.message}`);
}

// ── 11. Location filter (scan.mjs) ────────────────────────────────

console.log('\n11. Location filter');

try {
  const { buildLocationFilter } = await import(pathToFileURL(join(ROOT, 'scripts/scan/scan.mjs')).href);

  const filter = buildLocationFilter({
    always_allow: ['united kingdom', 'london'],
    allow: ['europe', 'remote'],
    block: ['india', 'singapore'],
  });

  if (filter('London, United Kingdom') === true) pass('always_allow hits pass');
  else fail('always_allow should pass');

  if (filter('Remote, United Kingdom or India') === true) pass('always_allow beats block');
  else fail('always_allow should beat block');

  if (filter('Bengaluru, India') === false) pass('block list rejects');
  else fail('block should reject');

  if (filter('') === true) pass('empty location passes');
  else fail('empty location should pass');

  const nullFilter = buildLocationFilter(null);
  if (nullFilter('Anywhere') === true) pass('null filter is pass-all');
  else fail('null filter should pass all');
} catch (e) {
  fail(`Location filter tests crashed: ${e.message}`);
}

// ── 12. Mode file integrity ───────────────────────────────────────

console.log('\n12. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md',
  'oferta.md', 'pdf.md', 'scan.md', 'batch.md', 'apply.md',
  'auto-pipeline.md', 'contacto.md', 'deep.md', 'ofertas.md',
  'pipeline.md', 'project.md', 'tracker.md', 'training.md',
  'patterns.md', 'followup.md', 'interview-prep.md',
  'response-tracker.md', 'notion-tracker.md', 'cv-quality-rules.md',
];
for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) pass(`mode: ${mode}`);
  else fail(`missing mode: ${mode}`);
}

const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) pass('_shared.md references _profile.md');
else fail('_shared.md must reference _profile.md');

// oferta.md must teach the URL ↔ JD coherence step
const oferta = readFile('modes/oferta.md');
const coherenceMarkers = [
  'Step −1',                            // section heading
  'URL ↔ JD coherence',                 // section title
  'TITLE_MISMATCH',                     // failure-mode flag
  'COMPANY_MISMATCH',                   // failure-mode flag
  'URL_LOST',                           // redirect-to-generic flag
  'JD_DEAD',                            // dead page flag
  'Verified:',                          // required header block
];
for (const marker of coherenceMarkers) {
  if (oferta.includes(marker)) pass(`oferta.md teaches ${marker}`);
  else fail(`oferta.md must teach URL/JD coherence: missing "${marker}"`);
}

// ── 13. Report header coherence (any reports/*.md present must declare URL + Verified) ──

console.log('\n13. Report header coherence');

const reportFiles = run(`ls reports/*.md 2>/dev/null | grep -v gitkeep || true`);
if (!reportFiles) {
  pass('No reports/*.md to audit (fresh workspace — expected)');
} else {
  const files = reportFiles.split('\n').filter(Boolean);
  for (const f of files) {
    const body = readFile(f);
    // Each report MUST declare a URL and a Verified block, per oferta.md report format.
    if (!/\*\*URL:\*\*\s*\S+/.test(body)) {
      fail(`${f}: missing **URL:** line in header`);
      continue;
    }
    if (!/\*\*Verified:\*\*/.test(body)) {
      warn(`${f}: legacy report missing Verified block — regenerate via /career-ops oferta to add it`);
      continue;
    }
    // Title in H1 must agree with role on page (loose check — both fields present).
    const h1 = body.match(/^# Evaluation:\s*([^—]+)—\s*(.+)$/m);
    const roleOnPage = body.match(/Role on page:\s*(.+?)\s*\(/);
    if (h1 && roleOnPage) {
      const h1Role = h1[2].trim().toLowerCase();
      const pageRole = roleOnPage[1].trim().toLowerCase();
      // Loose: share at least one substantive word ≥4 chars.
      const h1Words = new Set(h1Role.split(/\W+/).filter(w => w.length >= 4));
      const overlap = pageRole.split(/\W+/).some(w => w.length >= 4 && h1Words.has(w));
      if (overlap) pass(`${f}: H1 role agrees with verified page role`);
      else fail(`${f}: H1 says "${h1[2].trim()}" but page role on file is "${roleOnPage[1].trim()}" — URL/JD mismatch in report`);
    }
  }
}

// ── 14. Firecrawl + fetch-chain wiring ─────────────────────────────

console.log('\n14. Firecrawl + fetch-chain wiring');

// providers exist
if (fileExists('providers/firecrawl.mjs')) pass('providers/firecrawl.mjs exists');
else fail('providers/firecrawl.mjs missing');
if (fileExists('providers/_fetch-chain.mjs')) pass('providers/_fetch-chain.mjs exists');
else fail('providers/_fetch-chain.mjs missing');

// firecrawl.mjs exports the documented interface
const firecrawlSrc = readFile('providers/firecrawl.mjs');
for (const sym of ['export async function scrape', 'export async function health', 'FIRECRAWL_URL', 'FIRECRAWL_API_KEY']) {
  if (firecrawlSrc.includes(sym)) pass(`firecrawl.mjs declares ${sym}`);
  else fail(`firecrawl.mjs must declare ${sym}`);
}

// _fetch-chain.mjs exports fetchForCoherence and references each tier
const chainSrc = readFile('providers/_fetch-chain.mjs');
for (const sym of ['export async function fetchForCoherence', 'firecrawl', 'bright-data', 'agent-playwright-fallback', 'webfetch']) {
  if (chainSrc.includes(sym)) pass(`_fetch-chain.mjs references ${sym}`);
  else fail(`_fetch-chain.mjs must reference ${sym}`);
}

// .mcp.json registers firecrawl
if (fileExists('.mcp.json')) {
  const mcp = JSON.parse(readFile('.mcp.json'));
  if (mcp?.mcpServers?.firecrawl) pass('.mcp.json registers firecrawl MCP server');
  else fail('.mcp.json must register a "firecrawl" entry under mcpServers');
} else {
  fail('.mcp.json missing');
}

// install scripts present
if (fileExists('scripts/install-firecrawl.sh')) pass('scripts/install-firecrawl.sh exists');
else fail('scripts/install-firecrawl.sh missing');
if (fileExists('scripts/install-firecrawl.ps1')) pass('scripts/install-firecrawl.ps1 exists');
else fail('scripts/install-firecrawl.ps1 missing');

// SKILL.md mentions Q9
const skill = readFile('SKILL.md');
if (skill.includes('header: "Firecrawl"')) pass('SKILL.md has Q9 Firecrawl onboarding');
else fail('SKILL.md must include Q9 Firecrawl onboarding question');

// oferta.md Step −1 uses the fetch-chain
if (oferta.includes('fetchForCoherence')) pass('oferta.md Step −1 routes through fetchForCoherence');
else fail('oferta.md Step −1 must call fetchForCoherence from providers/_fetch-chain.mjs');

// SECURITY.md notes AGPL boundary
const security = fileExists('SECURITY.md') ? readFile('SECURITY.md') : '';
if (security.includes('AGPL') && security.includes('Firecrawl')) pass('SECURITY.md notes Firecrawl AGPL boundary');
else fail('SECURITY.md must explain the Firecrawl AGPL-3.0 boundary');

// ── 15. Dashboard build (Go) ──────────────────────────────────────

if (!QUICK) {
  console.log('\n15. Dashboard build');
  if (fileExists('dashboard/go.mod')) {
    const goBuild = run('cd dashboard && go build -o /tmp/career-dashboard-test . 2>&1');
    if (goBuild !== null) pass('Dashboard compiles');
    else warn('Dashboard build failed (Go toolchain may be missing in CI)');
  } else {
    warn('No dashboard/go.mod — skipping Go build');
  }
} else {
  console.log('\n15. Dashboard build (skipped --quick)');
}

// ── SUMMARY ───────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
