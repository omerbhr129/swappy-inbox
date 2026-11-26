// Swappy's front door on the Sprite (port 8080, the Sprite's public URL).
//   POST /hook   AgentMail's webhook: "a message arrived". The body is not read: Swappy looks at the inbox itself.
//   POST /tick   the daily nudge (a scheduled GitHub Action): send the morning matches, then look at the inbox.
//                Anyone may call it; it does nothing twice a day for the same person.
//   GET  /       what Swappy is and its address.
// A request to the URL wakes the Sprite; between e-mails it sleeps and costs nothing.
import { createServer } from 'node:http';
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
  if (req.method === 'GET' && path === '/') { send(200, landingPage({ address }), 'text/html; charset=utf-8'); return; }
  send(404, 'not found');
});

server.listen(config.port, () => {
  console.log(`swappy listening on :${config.port} as ${config.inboxId}`);
  look('boot'); // anything that arrived while the Sprite slept
});
// While awake, a look every two minutes in case a webhook was missed. Asleep, nothing runs and nothing is billed.
setInterval(() => look('timer'), 2 * 60 * 1000).unref();
