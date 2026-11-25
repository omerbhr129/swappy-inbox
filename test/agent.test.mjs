// The agent end to end against a fake inbox, a fake Claude and a small job list: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, readCommand } from '../src/agent.mjs';
import { createStore } from '../src/store.mjs';
import { isAutomated, parseAddress } from '../src/mail.mjs';
import { placeFit, readPostings, shortlist } from '../src/jobs.mjs';
import { loadConfig } from '../src/config.mjs';

const POSTINGS = { jobs: [
  ['Senior Product Designer', 'Acme', 'Remote (US)', 1, 'g', '2026-11-25', 'acme-senior-product-designer-1'],
  ['Product Designer', 'Beta Co', 'New York, NY', 0, 'l', '2026-11-24', 'beta-product-designer-2'],
  ['Product Designer II', 'Gamma', 'Austin, TX', 0, 'a', '2026-11-25', 'gamma-product-designer-ii-3'],
  ['Staff Software Engineer', 'Delta', 'Remote (US)', 1, 'g', '2026-11-25', 'delta-staff-software-engineer-4'],
  ['UX Designer', 'Epsilon', 'Remote (US)', 1, 'g', '2026-11-20', 'epsilon-ux-designer-5'],
  ['Design Intern', 'Zeta', 'New York, NY', 0, 'g', '2026-11-25', 'zeta-design-intern-6'],
] };

function fakeMail(inbox) {
  const sent = [];
  const labels = [];
  return {
    sent, labels, inbox,
    getInbox: async () => ({ email: 'swappy@agentmail.to' }),
    listMessages: async () => ({ messages: inbox.map((m) => ({ message_id: m.message_id, from: m.from, labels: m.labels ?? ['received', 'unread'] })) }),
    getMessage: async (id) => inbox.find((m) => m.message_id === id),
    attachmentBytes: async () => Buffer.from('%PDF-1.4 fake'),
    reply: async (id, body) => { sent.push({ kind: 'reply', id, ...body }); return { message_id: `r-${id}` }; },
    send: async (body) => { sent.push({ kind: 'send', ...body }); return { message_id: 'd1' }; },
    label: async (id, add, remove) => { labels.push({ id, add, remove }); },
  };
}

function fakeLlm(profile) {
  const calls = { read: 0, rank: 0, note: 0, lastPdf: null };
  return {
    calls,
    readProfile: async ({ pdfBase64 }) => { calls.read++; calls.lastPdf = pdfBase64; return profile; },
    rankJobs: async ({ candidates, max }) => { calls.rank++; return [...candidates.slice(0, max).map((j) => ({ id: j.id, why: `fits: ${j.title}` })), { id: 'not-in-the-shortlist', why: 'made up' }]; },
    writeNote: async ({ job }) => { calls.note++; return `I'd love to help ${job.company} as a designer.`; },
  };
}

const DESIGNER = {
  is_job_search: true, name: 'Dana', target_titles: ['Product Designer'], seniority: 'mid', skills: ['Figma'],
  locations: ['New York, NY'], remote: 'remote_ok', resume_facts: 'Product designer at Foo 2021-2025; Figma.', missing: null,
};

function setup(inbox, profile = DESIGNER, at = '2026-11-25T15:00:00Z') {
  const config = { ...loadConfig({}), dataDir: mkdtempSync(join(tmpdir(), 'swappy-')), inboxId: 'swappy@agentmail.to' };
  const store = createStore(config.dataDir);
  const mail = fakeMail(inbox);
  const llm = fakeLlm(profile);
  const all = readPostings(POSTINGS);
  const jobs = {
    ensure: async () => all,
    byId: (id) => all.find((j) => j.id === id) ?? null,
    pageUrl: (id) => `https://swapplyjobs.com/jobs/posting/${id}`,
    details: async () => ({ description: 'Design things.', applyUrl: 'https://job-boards.greenhouse.io/x/jobs/1' }),
  };
  const now = () => new Date(at);
  const agent = createAgent({ mail, llm, jobs, store, config, now, log: { info() {}, warn() {}, error() {} } });
  return { agent, mail, llm, store, config };
}

test('a résumé gets matches once; a number gets a note; STOP deletes everything', async () => {
  const inbox = [{ message_id: 'm1', from: 'Dana <Dana@Example.com>', subject: 'job hunt', extracted_text: 'Find me design jobs', attachments: [{ attachment_id: 'a1', filename: 'cv.pdf', content_type: 'application/pdf', size: 1000 }] }];
  const { agent, mail, llm, store } = setup(inbox);
  await agent.processInbox();
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].kind, 'reply');
  assert.match(mail.sent[0].text, /Hi Dana/);
  assert.match(mail.sent[0].text, /1\. /);
  assert.doesNotMatch(mail.sent[0].text, /made up/, 'an id the model invented is dropped');
  assert.doesNotMatch(mail.sent[0].text, /Software Engineer/, 'not a designer job');
  assert.ok(llm.calls.lastPdf, 'the PDF went to Claude');
  const user = store.getUser('dana@example.com');
  assert.ok(user.lastList.length >= 1);
  assert.equal(user.profile.resume_facts, undefined, 'the facts are kept beside the profile, not in it');

  await agent.processInbox();
  assert.equal(mail.sent.length, 1, 'the same message is never answered twice');

  inbox.push({ message_id: 'm2', from: 'dana@example.com', extracted_text: '2\n\nOn Tue Swappy wrote: ...' });
  await agent.processInbox();
  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].text, /intro note for/);
  assert.match(mail.sent[1].text, /greenhouse/);
  assert.deepEqual(mail.sent[1].labels, ['swappy-note']);

  inbox.push({ message_id: 'm3', from: 'dana@example.com', extracted_text: 'STOP' });
  await agent.processInbox();
  assert.equal(store.getUser('dana@example.com'), null);
  assert.match(mail.sent[2].text, /deleted everything/);
});

test('auto-replies, bounces and our own messages are never answered', async () => {
  const inbox = [
    { message_id: 'a', from: 'boss@corp.com', subject: 'Out of office', extracted_text: 'away', headers: { 'Auto-Submitted': 'auto-replied' } },
    { message_id: 'b', from: 'MAILER-DAEMON@mx.example.com', subject: 'Undeliverable', extracted_text: 'bounce' },
    { message_id: 'c', from: 'Swappy <swappy@agentmail.to>', extracted_text: 'our own reply' },
    { message_id: 'd', from: 'x@y.com', extracted_text: 'sent one', labels: ['sent'] },
  ];
  const { agent, mail, llm } = setup(inbox);
  await agent.processInbox();
  assert.equal(mail.sent.length, 0);
  assert.equal(llm.calls.read, 0);
});

test('a stranger writing about something else gets one hello, then silence', async () => {
  const inbox = [{ message_id: 's1', from: 'spam@ads.com', extracted_text: 'Buy our SEO services' }];
  const { agent, mail } = setup(inbox, { ...DESIGNER, is_job_search: false, target_titles: [] });
  await agent.processInbox();
  inbox.push({ message_id: 's2', from: 'spam@ads.com', extracted_text: 'Following up!' });
  await agent.processInbox();
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].text, /I’m Swappy/);
});

test('the morning run: once a day, not before the hour, only new jobs, not when paused', async () => {
  const inbox = [{ message_id: 'm1', from: 'dana@example.com', extracted_text: 'design jobs please' }];
  const early = setup(inbox, DESIGNER, '2026-11-26T09:00:00Z');
  assert.deepEqual(await early.agent.digest(), { sent: 0, reason: 'too early' });

  const s = setup(inbox, DESIGNER, '2026-11-25T15:00:00Z');
  await s.agent.processInbox();
  const firstList = s.store.getUser('dana@example.com').lastList.map((j) => j.id);
  // The next morning:
  const next = setup([], DESIGNER, '2026-11-26T14:00:00Z');
  next.store.saveUser(s.store.getUser('dana@example.com'));
  const r1 = await next.agent.digest();
  const r2 = await next.agent.digest();
  assert.equal(r2.sent, 0, 'not twice the same day');
  const digests = next.mail.sent.filter((m) => m.kind === 'send');
  assert.equal(digests.length, r1.sent);
  for (const d of digests) for (const id of firstList) assert.ok(!d.text.includes(id), 'only jobs not sent before');

  const paused = setup([], DESIGNER, '2026-11-27T14:00:00Z');
  paused.store.saveUser({ ...s.store.getUser('dana@example.com'), paused: true });
  assert.equal((await paused.agent.digest()).sent, 0);
});

test('the send budget holds, overall and per person', async () => {
  const inbox = Array.from({ length: 5 }, (_, i) => ({ message_id: `q${i}`, from: 'eager@example.com', extracted_text: 'design jobs' }));
  const s = setup(inbox);
  s.config.maxRepliesPerSenderPerDay = 2;
  await s.agent.processInbox();
  assert.equal(s.mail.sent.length, 2);
});

test('the Claude ceiling: past it, nothing is spent and the mail waits for tomorrow', async () => {
  const inbox = Array.from({ length: 4 }, (_, i) => ({ message_id: `c${i}`, from: `p${i}@example.com`, extracted_text: 'design jobs' }));
  const s = setup(inbox);
  s.config.maxLlmCallsPerDay = 4; // two people: a read and a rank each
  await s.agent.processInbox();
  assert.equal(s.llm.calls.read + s.llm.calls.rank + s.llm.calls.note, 4);
  assert.equal(s.mail.sent.length, 2);
  assert.ok(!s.store.isProcessed('c3'), 'not answered, not dropped: tomorrow');
});

test('commands and addresses', () => {
  assert.deepEqual(readCommand('STOP'), { kind: 'stop' });
  assert.deepEqual(readCommand('Pause.'), { kind: 'pause' });
  assert.deepEqual(readCommand('3\n\n> quoted'), { kind: 'pick', n: 3 });
  assert.deepEqual(readCommand('#2 please'), { kind: 'pick', n: 2 });
  assert.equal(readCommand('I have 3 years of experience').kind, 'text');
  assert.equal(parseAddress('"Dana D" <Dana@Example.COM>'), 'dana@example.com');
  assert.equal(parseAddress('nonsense'), null);
  assert.ok(isAutomated({ headers: { 'List-Unsubscribe': '<x>' } }, 'news@x.com'));
  assert.ok(!isAutomated({ headers: {}, subject: 'Re: jobs' }, 'dana@example.com'));
});

test('the shortlist: title, place, level, remote', () => {
  const jobs = readPostings(POSTINGS);
  const ids = shortlist(jobs, DESIGNER, { today: new Date('2026-11-25') }).map((j) => j.id);
  assert.ok(ids.includes('beta-product-designer-2'), 'in New York');
  assert.ok(ids.includes('acme-senior-product-designer-1'), 'remote is fine');
  assert.ok(!ids.includes('gamma-product-designer-ii-3'), 'Austin is not one of their places');
  assert.ok(!ids.includes('delta-staff-software-engineer-4'));
  const remoteOnly = shortlist(jobs, { ...DESIGNER, remote: 'remote_only' });
  assert.ok(remoteOnly.length > 0 && remoteOnly.every((j) => j.remote), 'remote only: nothing on site');
  assert.equal(remoteOnly[0].id, 'acme-senior-product-designer-1', 'the full title match first');
  assert.equal(placeFit({ location: 'Austin, TX', remote: false }, { locations: ['TX'] }), 'match');
  assert.equal(shortlist(jobs, { ...DESIGNER, target_titles: [] }).length, 0);
});
