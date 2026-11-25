// Swappy's loop: read the inbox, answer each new e-mail once, and send the morning matches.
//
// A webhook or a timer only says "look": what to do always comes from AgentMail's own copy of the inbox, read
// through the authenticated API, never from the body of a request someone sent to the public URL.
import { dayKey } from './store.mjs';
import { isAutomated, parseAddress } from './mail.mjs';
import { shortlist } from './jobs.mjs';
import * as c from './compose.mjs';

const MAX_TRIES = 3;
const LOOKBACK_MS = 3 * 86_400_000;

/** STOP / PAUSE / RESUME, or a job number, from the first line of the reply (quoted history is not read). */
export function readCommand(body) {
  const first = String(body ?? '').trim().split('\n')[0].trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(stop|unsubscribe|delete( me| my data)?|remove me)$/.test(first)) return { kind: 'stop' };
  if (/^(pause|stop sending|no more( emails)?)$/.test(first)) return { kind: 'pause' };
  if (/^(resume|start|restart|unpause)$/.test(first)) return { kind: 'resume' };
  const n = first.match(/^#?\s*([1-9]|10)\s*(please)?$/);
  if (n) return { kind: 'pick', n: Number(n[1]) };
  return { kind: 'text' };
}

export function createAgent({ mail, llm, jobs, store, config, now = () => new Date(), log = console }) {
  let me = null;
  let running = null;
  let again = false;
  // One thing at a time: a pass over the inbox and the morning run never write the same person's file at once.
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  const canSend = (to) => store.sentToday(now()) < config.maxSendsPerDay && store.sentTodayTo(to, now()) < config.maxRepliesPerSenderPerDay;

  async function reply(messageId, to, body, labels = ['swappy-reply']) {
    if (!canSend(to)) { log.warn('send budget reached; not answering', to.replace(/(.).*@/, '$1…@')); return false; }
    await mail.reply(messageId, { ...body, labels });
    store.countSend(to, now());
    return true;
  }

  async function match(user, max) {
    const all = await jobs.ensure();
    const seen = new Set(user.seen ?? []);
    const short = shortlist(all, user.profile, { seen, limit: 60, today: now() });
    if (!short.length) return [];
    const byId = new Map(short.map((j) => [j.id, j]));
    const picks = await llm.rankJobs({ profile: user.profile, facts: user.resume_facts, candidates: short, max });
    const out = [];
    for (const p of picks) {
      const job = byId.get(p.id);
      if (!job || out.some((o) => o.job.id === job.id)) continue; // only ids from the shortlist, once
      out.push({ job, why: String(p.why).slice(0, 200), url: jobs.pageUrl(job.id) });
      if (out.length >= max) break;
    }
    return out;
  }

  function remember(user, picks) {
    user.lastList = picks.map((m) => ({ id: m.job.id, title: m.job.title, company: m.job.company, location: m.job.location }));
    user.seen = [...new Set([...(user.seen ?? []), ...picks.map((m) => m.job.id)])].slice(-2000);
  }

  async function onProfile(msg, from, user, body) {
    const pdf = (msg.attachments ?? []).find((a) => (a.content_type === 'application/pdf' || /\.pdf$/i.test(a.filename ?? '')) && a.size < 15_000_000);
    const otherFile = !pdf && (msg.attachments ?? []).some((a) => a.content_disposition !== 'inline' && /\.(docx?|pages|rtf|odt)$/i.test(a.filename ?? ''));
    const pdfBase64 = pdf ? (await mail.attachmentBytes(msg.message_id, pdf.attachment_id)).toString('base64') : null;
    const profile = await llm.readProfile({ emailText: `Subject: ${msg.subject ?? ''}\n\n${body}`, pdfBase64, saved: user?.profile ?? null });

    if (!profile.is_job_search && !user) {
      // Not about a job search, from someone Swappy does not know: one hello at most, then silence.
      const known = store.getUser(from);
      if (known?.welcomed) return;
      store.saveUser({ email: from, welcomed: true, active: false, created: now().toISOString() });
      await reply(msg.message_id, from, c.WELCOME);
      return;
    }
    const next = {
      ...(user ?? { email: from, created: now().toISOString(), seen: [] }),
      email: from,
      profile: { ...(user?.profile ?? {}), ...profile, resume_facts: undefined, is_job_search: undefined, missing: undefined },
      resume_facts: profile.resume_facts || user?.resume_facts || '',
      active: true,
      paused: user?.paused ?? false,
      welcomed: true,
    };
    if (!next.profile.target_titles?.length) {
      store.saveUser(next);
      await reply(msg.message_id, from, otherFile ? c.plainEmail(c.NOT_PDF) : c.ASK_ROLE(profile.missing));
      return;
    }
    const first = !user?.lastList;
    const picks = await match(next, 5);
    if (!picks.length) {
      next.lastDigest = dayKey(now());
      store.saveUser(next);
      await reply(msg.message_id, from, c.NO_MATCHES);
      return;
    }
    remember(next, picks);
    next.lastDigest = dayKey(now());
    store.saveUser(next);
    const body2 = c.matchesEmail({ name: next.profile.name, picks, first });
    if (otherFile) body2.text = `${c.NOT_PDF}\n\n${body2.text}`;
    await reply(msg.message_id, from, body2);
  }

  async function onPick(msg, from, user, n) {
    const chosen = user.lastList?.[n - 1];
    if (!chosen) return onProfile(msg, from, user, String(n));
    if (!user.resume_facts) { await reply(msg.message_id, from, c.NEED_RESUME); return; }
    const job = jobs.byId(chosen.id) ?? chosen;
    const { description, applyUrl } = await jobs.details(chosen.id);
    const note = await llm.writeNote({ facts: user.resume_facts, profile: user.profile ?? {}, job, description });
    await reply(msg.message_id, from, c.noteEmail({ job, note, applyUrl, pageUrl: jobs.pageUrl(chosen.id), appUrl: config.appUrl }), ['swappy-note']);
  }

  async function handle(item) {
    const from = parseAddress(item.from);
    if (!from || from === me) return 'skip';
    const msg = await mail.getMessage(item.message_id);
    if (isAutomated(msg, from)) return 'skip';
    const body = String(msg.extracted_text ?? msg.text ?? msg.preview ?? '').trim();
    const user = store.getUser(from);
    const cmd = readCommand(body);
    if (cmd.kind === 'stop') {
      const had = Boolean(user);
      store.deleteUser(from);
      if (had) await reply(msg.message_id, from, c.STOPPED);
      return 'stop';
    }
    if (cmd.kind === 'pause' && user) { store.saveUser({ ...user, paused: true }); await reply(msg.message_id, from, c.PAUSED); return 'pause'; }
    if (cmd.kind === 'resume' && user) { store.saveUser({ ...user, paused: false, active: true }); await reply(msg.message_id, from, c.RESUMED); return 'resume'; }
    if (cmd.kind === 'pick' && user?.lastList?.length) { await onPick(msg, from, user, cmd.n); return 'note'; }
    await onProfile(msg, from, user?.profile ? user : null, body);
    return 'profile';
  }

  async function pass() {
    if (!me) me = parseAddress((await mail.getInbox())?.email ?? config.inboxId) ?? config.inboxId.toLowerCase();
    const after = new Date(now().getTime() - LOOKBACK_MS).toISOString();
    const list = await mail.listMessages({ after, limit: 100, ascending: true });
    for (const item of list?.messages ?? []) {
      const id = item.message_id;
      if (!id || store.isProcessed(id)) continue;
      const labels = item.labels ?? [];
      if (labels.includes('swappy-done') || labels.includes('sent') || labels.some((l) => l.startsWith('swappy-reply') || l === 'swappy-note' || l === 'swappy-digest')) { store.markProcessed(id); continue; }
      try {
        const what = await handle(item);
        await mail.label(id, ['swappy-done'], ['unread']).catch(() => {});
        store.markProcessed(id);
        log.info('handled', id.slice(0, 12), what);
      } catch (e) {
        const tries = store.failed(id);
        log.error('failed', id.slice(0, 12), tries, String(e?.message ?? e).slice(0, 300));
        if (tries >= MAX_TRIES) {
          const from = parseAddress(item.from);
          if (from && from !== me) await reply(id, from, c.OOPS).catch(() => {});
          store.markProcessed(id);
        }
      }
    }
  }

  /** Read the inbox. Calls that arrive while a pass runs are folded into one more pass after it. */
  function processInbox() {
    if (running) { again = true; return running; }
    running = serial(async () => { do { again = false; await pass(); } while (again); }).finally(() => { running = null; });
    return running;
  }

  /** The morning matches: once a day per person, from digestHourUtc on, only jobs they have not been sent. */
  const digest = () => serial(digestNow);
  async function digestNow() {
    if (now().getUTCHours() < config.digestHourUtc) return { sent: 0, reason: 'too early' };
    const today = dayKey(now());
    let sent = 0;
    for (const user of store.allUsers()) {
      if (!user.active || user.paused || !user.profile?.target_titles?.length || user.lastDigest === today) continue;
      if (!canSend(user.email)) break;
      try {
        const picks = await match(user, 3);
        user.lastDigest = today;
        if (picks.length) remember(user, picks);
        store.saveUser(user);
        if (!picks.length) continue;
        const body = c.matchesEmail({ name: user.profile.name, picks, first: false });
        const subject = `${picks.length} new ${picks.length === 1 ? 'match' : 'matches'} for you today`;
        await mail.send({ to: user.email, subject, ...body, labels: ['swappy-digest'] });
        store.countSend(user.email, now());
        sent++;
      } catch (e) {
        log.error('digest failed', String(e?.message ?? e).slice(0, 300));
      }
    }
    return { sent };
  }

  return { processInbox, digest, handle };
}
