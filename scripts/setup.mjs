// One-time setup, run ON THE SPRITE (the connectors' gateway only answers calls from a Sprite):
//   node scripts/setup.mjs                 lists the connectors and their gateway URLs
//   node scripts/setup.mjs inbox           creates Swappy's AgentMail inbox (swappy@agentmail.to, or the next free name)
//   node scripts/setup.mjs webhook <url>   points the inbox's "message received" webhook at <url>/hook
import { loadConfig } from '../src/config.mjs';
import { createMail } from '../src/mail.mjs';

const [cmd, arg] = process.argv.slice(2);
const config = loadConfig();

if (!cmd) {
  const res = await fetch('https://api.sprites.dev/v1/gateway/list');
  console.log(res.status, await res.text());
  process.exit(0);
}

if (cmd === 'inbox') {
  const headers = { 'content-type': 'application/json', ...(config.agentmailKey ? { authorization: `Bearer ${config.agentmailKey}` } : {}) };
  for (const username of ['swappy', 'swappy-jobs', 'swappyjobs', 'hey-swappy']) {
    const res = await fetch(`${config.agentmailBase}/v0/inboxes`, { method: 'POST', headers, body: JSON.stringify({ username, display_name: 'Swappy' }) });
    const text = await res.text();
    if (res.ok) { const inbox = JSON.parse(text); console.log('created', inbox.email, 'inbox_id =', inbox.inbox_id); process.exit(0); }
    console.log(username, res.status, text.slice(0, 160));
  }
  process.exit(1);
}

if (cmd === 'webhook') {
  if (!arg || !/^https:\/\//.test(arg)) { console.error('usage: node scripts/setup.mjs webhook https://<sprite-url>'); process.exit(1); }
  const mail = createMail({ base: config.agentmailBase, key: config.agentmailKey, inboxId: config.inboxId });
  const hook = await mail.createWebhook(`${arg.replace(/\/+$/, '')}/hook`);
  console.log('webhook', hook.webhook_id, '→', hook.url, '(its signing secret is not needed: Swappy never trusts the body)');
  process.exit(0);
}

console.error('unknown command', cmd);
process.exit(1);
