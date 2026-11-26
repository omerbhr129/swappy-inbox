// Swappy's front door on the Sprite (port 8080, the Sprite's public URL).
//   POST /hook   AgentMail's webhook: "a message arrived". The body is not read: Swappy looks at the inbox itself.
//   POST /tick   the daily nudge (a scheduled GitHub Action): send the morning matches, then look at the inbox.
//                Anyone may call it; it does nothing twice a day for the same person.
//   GET  /       what Swappy is and its address.
//   GET  /demo.mp4  the demo video, if public/demo.mp4 is on the Sprite (not in the repository).
// A request to the URL wakes the Sprite; between e-mails it sleeps and costs nothing.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createJobs } from './jobs.mjs';
import { createLlm } from './llm.mjs';
import { createMail } from './mail.mjs';
import { createAgent } from './agent.mjs';
import { landingPage } from './page.mjs';

const config = loadConfig();
const store = createStore(config.dataDir);
const jobs = createJobs({ postingsUrl: config.postingsUrl, siteBase: config.siteBase });
const llm = createLlm({ baseURL: config.anthropicBaseURL, apiKey: config.anthropicApiKey, model: config.model });
const mail = createMail({ base: config.agentmailBase, key: config.agentmailKey, inboxId: config.inboxId, attachmentKey: config.attachmentKey });
const agent = createAgent({ mail, llm, jobs, store, config });

const look = (why) => agent.processInbox().catch((e) => console.error('inbox pass failed', why, String(e?.message ?? e).slice(0, 300)));

let address = config.inboxId;
mail.getInbox().then((i) => { if (i?.email) address = i.email; }).catch(() => {});

/** A file with byte ranges (browsers seek a video with them); nothing but the one configured path is ever read. */
function serveFile(req, res, file, type) {
  let size;
  try { size = statSync(file).size; } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
    status = 206;
    head['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  head['content-length'] = end - start + 1;
  res.writeHead(status, head);
  if (req.method === 'HEAD') { res.end(); return; }
  // a read that fails mid-way (the file replaced or gone) ends this one response, never the server
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  req.resume(); // the body is never needed
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  if (req.method === 'POST' && path === '/hook') { send(202, 'looking'); look('hook'); return; }
  if ((req.method === 'POST' || req.method === 'GET') && path === '/tick') {
    send(202, 'ticking');
    agent.digest().then((r) => console.log('digest', r)).catch((e) => console.error('digest failed', String(e?.message ?? e))).finally(() => look('tick'));
    return;
  }
  if (req.method === 'GET' && path === '/health') { send(200, 'ok'); return; }
  if ((req.method === 'GET' || req.method === 'HEAD') && path === '/demo.mp4') { serveFile(req, res, config.demoFile, 'video/mp4'); return; }
  if (req.method === 'GET' && path === '/') { send(200, landingPage({ address }), 'text/html; charset=utf-8'); return; }
  send(404, 'not found');
});

server.listen(config.port, () => {
  console.log(`swappy listening on :${config.port} as ${config.inboxId}`);
  look('boot'); // anything that arrived while the Sprite slept
});
// While awake, a look every two minutes in case a webhook was missed. Asleep, nothing runs and nothing is billed.
setInterval(() => look('timer'), 2 * 60 * 1000).unref();
