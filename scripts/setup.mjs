// One-time setup, run ON THE SPRITE (the connectors' gateway only answers calls from a Sprite):
//   node scripts/setup.mjs                 lists the connectors and their gateway URLs
//   node scripts/setup.mjs inbox           creates Swappy's AgentMail inbox (swappy@agentmail.to, or the next free name)
//   node scripts/setup.mjs check           reads the inbox through the connector (who the key is, the newest mail)
// The "message received" webhook is made in AgentMail's console (the gateway does not proxy webhook admin):
// Webhooks → Add endpoint → https://<sprite-url>/hook, event message.received. Its body is never trusted.
import { loadConfig } from '../src/config.mjs';

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

if (cmd === 'check') {
  const headers = config.agentmailKey ? { authorization: `Bearer ${config.agentmailKey}` } : {};
  const me = await fetch(`${config.agentmailBase}/v0/auth/me`, { headers });
  console.log('key', me.status, (await me.text()).slice(0, 300));
  const list = await fetch(`${config.agentmailBase}/v0/inboxes/${encodeURIComponent(config.inboxId)}/messages?limit=3`, { headers });
  console.log('messages', list.status, (await list.text()).slice(0, 300));
  process.exit(0);
}

console.error('unknown command', cmd);
process.exit(1);
