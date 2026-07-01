// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SmartRecruiters provider — hits the public Posting API:
//   https://api.smartrecruiters.com/v1/companies/{companyId}/postings
// Paginates (limit=100) up to a hard cap, normalises to Job[]. Used for
// companies whose careers site is SmartRecruiters-backed (e.g. Delivery Hero
// at careers.deliveryhero.com → companyId "DeliveryHero").

const ALLOWED_HOSTS = new Set(['api.smartrecruiters.com']);
const PAGE = 100;
const MAX_PAGES = 15; // safety cap: 1500 postings/company per scan

function assertSrUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`smartrecruiters: invalid URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new Error(`smartrecruiters: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname))
    throw new Error(`smartrecruiters: untrusted hostname "${parsed.hostname}"`);
  return parsed;
}

// Resolve the SmartRecruiters companyId from an explicit `api:` URL or a
// careers_url like https://careers.<co>.com/... (falls back to `sr_company`).
function resolveCompanyId(entry) {
  if (entry.sr_company) return String(entry.sr_company);
  if (entry.api) {
    const p = assertSrUrl(entry.api);
    const m = p.pathname.match(/\/v1\/companies\/([^/]+)\/postings/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

/** @type {Provider} */
export default {
  id: 'smartrecruiters',

  detect(entry) {
    try {
      const id = resolveCompanyId(entry);
      return id ? { url: `https://api.smartrecruiters.com/v1/companies/${id}/postings` } : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const companyId = resolveCompanyId(entry);
    if (!companyId) throw new Error(`smartrecruiters: cannot derive companyId for ${entry.name}`);
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings`;
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${base}?limit=${PAGE}&offset=${page * PAGE}`;
      assertSrUrl(url);
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const content = Array.isArray(json?.content) ? json.content : [];
      for (const p of content) {
        if (!p?.id || !p?.name) continue;
        const loc = p.location || {};
        const remote = loc.remote ? 'Remote' : (loc.hybrid ? 'Hybrid' : '');
        const place = loc.fullLocation || [loc.city, loc.country].filter(Boolean).join(', ');
        out.push({
          title: String(p.name).trim(),
          url: `https://jobs.smartrecruiters.com/${companyId}/${p.id}`,
          company: entry.name,
          location: [place, remote].filter(Boolean).join(' · '),
        });
      }
      const total = Number(json?.totalFound || 0);
      if (content.length < PAGE || (page + 1) * PAGE >= total) break;
    }
    return out;
  },
};
