// Swappy's inbox, through AgentMail's API (https://docs.agentmail.to). On the Sprite the base URL is the
// connector's gateway, which adds the API key; locally it is api.agentmail.to with AGENTMAIL_API_KEY.

export function createMail({ base, key = null, inboxId, fetchImpl = fetch }) {
  if (!inboxId) throw new Error('AGENTMAIL_INBOX_ID is not set');
  const headers = { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
  const inbox = `/v0/inboxes/${encodeURIComponent(inboxId)}`;
  // Through the Sprites gateway (no key here) AgentMail's attachment endpoints are not proxied, and a message's own
  // path is refused when its id holds "=" (most Gmail ids). So a message is read from its thread, a reply is a new
  // message threaded by its headers, and attachments are read only with a direct key.
  const viaGateway = !key;

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`agentmail ${method} ${path.split('?')[0]} → ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    canReadAttachments: !viaGateway,
    getInbox: () => call('GET', inbox),
    /** Newest messages first unless `ascending`; `after` is an ISO time. */
    listMessages({ after, limit = 50, ascending = true } = {}) {
      const q = new URLSearchParams({ limit: String(limit), ascending: String(ascending) });
      if (after) q.set('after', after);
      return call('GET', `${inbox}/messages?${q}`);
    },
    /** One message in full (its text and attachments list), from the list item's thread. */
    async getMessage(item) {
      if (!item?.thread_id) return call('GET', `${inbox}/messages/${encodeURIComponent(item.message_id)}`);
      const thread = await call('GET', `${inbox}/threads/${encodeURIComponent(item.thread_id)}`);
      const found = (thread?.messages ?? []).find((m) => m.message_id === item.message_id);
      if (!found) throw new Error('message not found in its thread');
      return found;
    },
    /** The attachment's bytes (AgentMail answers with a signed, short-lived download URL). Direct key only. */
    async attachmentBytes(messageId, attachmentId) {
      if (viaGateway) throw new Error('attachments are not readable through the gateway');
      const meta = await call('GET', `${inbox}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      if (!meta?.download_url || !/^https:\/\//.test(meta.download_url)) throw new Error('no download url');
      const res = await fetchImpl(meta.download_url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`attachment download ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** A reply to `msg`: a new message to `to`, in the same conversation (Re: subject, In-Reply-To, References). */
    reply(msg, to, { text, html, labels }) {
      const h = Object.fromEntries(Object.entries(msg?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const id = String(msg?.message_id ?? '');
      const refs = `${h.references ?? ''} ${id}`.trim().split(/\s+/).slice(-10).join(' ');
      const subject = String(msg?.subject ?? '').trim() || 'Your job search';
      return call('POST', `${inbox}/messages/send`, {
        to: [to], subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, text, html, labels,
        ...(id ? { headers: { 'In-Reply-To': id, References: refs } } : {}),
      });
    },
    send: ({ to, subject, text, html, labels }) => call('POST', `${inbox}/messages/send`, { to, subject, text, html, labels }),
    /** Labels on a received message (bookkeeping only: what was handled is also kept on the Sprite's disk). */
    async label(messageId, add = [], remove = []) {
      if (viaGateway && /=/.test(messageId)) return null;
      return call('PATCH', `${inbox}/messages/${encodeURIComponent(messageId)}`, { add_labels: add, remove_labels: remove });
    },
  };
}

/** "Jane Doe <jane@x.com>" → "jane@x.com" (lower case), or null. */
export function parseAddress(from) {
  const s = String(from ?? '');
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/) ?? s.match(/([^\s<>"]+@[^\s<>"]+)/);
  const addr = m?.[1]?.toLowerCase().replace(/^mailto:/, '');
  return addr && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : null;
}

/** An auto-reply, a bounce, a mailing list or a no-reply sender: never answered (no mail loops). */
export function isAutomated(message, address) {
  const h = Object.fromEntries(Object.entries(message?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h['auto-submitted'] && h['auto-submitted'] !== 'no') return true;
  if (h['x-autoreply'] || h['x-autorespond'] || h['list-id'] || h['list-unsubscribe']) return true;
  if (/^(bulk|list|junk|auto_reply)$/.test(h.precedence ?? '')) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|notifications?)@/.test(address ?? '')) return true;
  return /^(auto(matic)? reply|out of (the )?office|undeliverable|delivery status notification)/i.test(String(message?.subject ?? ''));
}
