// The jobs Swappy matches against: Swapply's public index of new US jobs (one row per job page on
// swapplyjobs.com), and each job's own public page for its description and the employer's apply link.

const REFRESH_MS = 6 * 60 * 60 * 1000;
const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|myworkdayjobs\.com|bamboohr\.com|jobvite\.com|icims\.com)/i;

export const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

export const tokenize = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9+#.\s/-]/g, ' ').split(/[\s/,-]+/).filter(Boolean);

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'at', 'with', 'or', 'i', 'ii', 'iii', 'iv', 'role', 'roles', 'job', 'jobs', 'position']);
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|vice president|chief|manager)\b/i;
const JUNIOR = /\b(intern|internship|junior|jr\.?|entry|graduate|new grad|apprentice)\b/i;

/** Two words match when one starts the other (engineer / engineering, dev / developer), from 3 letters. */
function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

// Level words say how senior, not what the job is: "Senior Product Designer" must not match "Senior Product Manager"
// on "senior" (the level is weighed separately, below and by the model).
const LEVEL = new Set(['senior', 'sr', 'sr.', 'junior', 'jr', 'jr.', 'staff', 'principal', 'lead', 'entry', 'mid']);

/** How much of a wanted title a job title has. Its last word is the job itself (designer, engineer, nurse): without it, 0. */
function phraseScore(phrase, titleWords) {
  const words = tokenize(phrase).filter((w) => !STOP.has(w) && !LEVEL.has(w));
  if (!words.length) return 0;
  if (!titleWords.some((t) => wordsMatch(words[words.length - 1], t))) return 0;
  const hit = words.filter((w) => titleWords.some((t) => wordsMatch(w, t))).length;
  return hit / words.length;
}

/**
 * A job's place against the person's: 'match' (their city, or a state they named as a whole), 'state' (another
 * city in the state of a city they named: maybe commutable, the model decides), 'remote', 'elsewhere' or 'unknown'.
 */
export function placeFit(job, profile) {
  const loc = String(job.location ?? '');
  const lower = loc.toLowerCase();
  const wanted = (profile.locations ?? []).map((l) => String(l));
  const jobState = (loc.match(/,\s*([A-Z]{2})\b/) ?? [])[1];
  let near = false;
  for (const w of wanted) {
    const [first, second] = w.split(',').map((x) => x.trim());
    if (!second && first && STATES.has(first.toUpperCase())) { if (jobState === first.toUpperCase()) return 'match'; continue; }
    if (first && first.length > 2 && lower.includes(first.toLowerCase())) return 'match';
    if (second && jobState === second.toUpperCase()) near = true;
  }
  if (job.remote) return 'remote';
  if (near) return 'state';
  return wanted.length ? 'elsewhere' : 'unknown';
}

/**
 * The jobs worth showing the model: a title that matches what they want, a place they can work, not seen before.
 * Cheap and local, so the model ranks a short list instead of thousands of rows.
 */
export function shortlist(jobs, profile, { seen = new Set(), limit = 60, today = new Date() } = {}) {
  const titles = (profile.target_titles ?? []).filter(Boolean);
  if (!titles.length) return [];
  const skills = (profile.skills ?? []).flatMap((s) => tokenize(s)).filter((w) => w.length > 2 && !STOP.has(w));
  const remote = profile.remote ?? 'unknown';
  const out = [];
  for (const job of jobs) {
    if (seen.has(job.id)) continue;
    const titleWords = tokenize(job.title);
    const best = Math.max(...titles.map((t) => phraseScore(t, titleWords)));
    if (best < 0.5) continue;
    const place = placeFit(job, profile);
    if (remote === 'remote_only' && !job.remote) continue;
    if (remote === 'onsite_only' && place !== 'match' && (profile.locations ?? []).length) continue;
    if (place === 'elsewhere') continue; // on site, somewhere they did not name
    let score = best * 10;
    score += Math.min(4, skills.filter((s) => titleWords.some((t) => wordsMatch(s, t))).length * 2);
    if (place === 'match') score += 3;
    if (place === 'state') score -= 2;
    if (place === 'remote' && remote !== 'onsite_only') score += 2;
    const level = profile.seniority ?? 'unknown';
    if ((level === 'intern' || level === 'junior') && SENIOR.test(job.title)) score -= 5;
    if ((level === 'senior' || level === 'lead' || level === 'executive') && JUNIOR.test(job.title)) score -= 5;
    const ageDays = (today - new Date(job.date)) / 86_400_000;
    if (ageDays <= 3) score += 1;
    out.push({ job, score });
  }
  out.sort((a, b) => b.score - a.score || String(b.job.date).localeCompare(String(a.job.date)));
  return out.slice(0, limit).map((x) => x.job);
}

/** postings.json → jobs: [title, company, location, remote, ats, date, slug]. */
export function readPostings(doc) {
  const rows = Array.isArray(doc?.jobs) ? doc.jobs : [];
  const jobs = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const [title, company, location, remote, ats, date, slug] = r;
    if (typeof title !== 'string' || typeof slug !== 'string' || !/^[a-z0-9-]{3,200}$/.test(slug)) continue;
    jobs.push({ id: slug, title, company: String(company ?? ''), location: String(location ?? ''), remote: remote === 1 || remote === true, ats: String(ats ?? ''), date: String(date ?? '') });
  }
  return jobs;
}

export function createJobs({ postingsUrl, siteBase, fetchImpl = fetch, now = () => Date.now() }) {
  let cache = { at: 0, jobs: [], byId: new Map() };

  async function ensure() {
    if (cache.jobs.length && now() - cache.at < REFRESH_MS) return cache.jobs;
    try {
      const res = await fetchImpl(postingsUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`postings ${res.status}`);
      const jobs = readPostings(await res.json());
      if (jobs.length) cache = { at: now(), jobs, byId: new Map(jobs.map((j) => [j.id, j])) };
    } catch (e) {
      if (!cache.jobs.length) throw e; // the last good list stays in use
    }
    return cache.jobs;
  }

  const pageUrl = (id) => `${siteBase}/jobs/posting/${encodeURIComponent(id)}`;

  /** A job's description and the employer's own apply link, from its public page. */
  async function details(id) {
    const res = await fetchImpl(pageUrl(id), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { description: '', applyUrl: null };
    const html = await res.text();
    const applyUrl = [...html.matchAll(/href="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).find((u) => ATS_HOSTS.test(new URL(u).hostname)) ?? null;
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ');
    const start = text.indexOf('About the job');
    const description = (start >= 0 ? text.slice(start + 'About the job'.length) : text).slice(0, 7000).trim();
    return { description, applyUrl };
  }

  return { ensure, pageUrl, details, byId: (id) => cache.byId.get(id) ?? null };
}
