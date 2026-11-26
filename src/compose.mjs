// What Swappy writes back. Plain text first (it reads well in any inbox), with a light HTML twin.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIGN = '— Swappy';
const FOOT = 'Jobs come from Swapply (swapplyjobs.com), refreshed every day from employers’ own job boards.';

function html(paragraphs) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#14161a;max-width:560px">${paragraphs.join('')}</div>`;
}
const p = (inner, style = '') => `<p style="margin:0 0 14px;${style}">${inner}</p>`;
const muted = (inner) => p(inner, 'color:#6b7280;font-size:13px');

export function matchesEmail({ name, picks, first, controls = true, notice = null }) {
  const hi = name ? `Hi ${name},` : 'Hi,';
  const intro = first ? `Here ${picks.length === 1 ? 'is 1 open role' : `are ${picks.length} open roles`} that fit what you sent me:` : `${picks.length === 1 ? '1 new role' : `${picks.length} new roles`} for you today:`;
  const lines = picks.map((m, i) => `${i + 1}. ${m.job.title} — ${m.job.company} (${m.job.location})\n   ${m.why}\n   ${m.url}`);
  const how = 'Reply with a number (like "2") and I’ll write you a short intro note for that job, using only what’s in your résumé.';
  const care = first
    ? 'I’ll send new matches each morning. Reply PAUSE to stop them, or STOP and I’ll delete everything I keep about you. I keep a short summary of your résumé to find matches; your e-mails are read with Claude (Anthropic).'
    : 'Reply PAUSE to stop these, or STOP to delete everything I keep about you.';
  const text = [hi, '', ...(notice ? [notice, ''] : []), intro, '', lines.join('\n\n'), '', how, controls ? care : '', '', SIGN, FOOT].filter((x) => x !== '').join('\n').replace(/\n(?=\d+\. )/g, '\n\n');
  const items = picks.map((m, i) => `<li style="margin:0 0 14px"><a href="${esc(m.url)}" style="color:#1d4ed8;font-weight:600;text-decoration:none">${esc(m.job.title)}</a> — ${esc(m.job.company)} <span style="color:#6b7280">(${esc(m.job.location)})</span><br><span>${esc(m.why)}</span></li>`).join('');
  return {
    text,
    html: html([p(esc(hi)), notice ? muted(esc(notice)) : '', p(esc(intro)), `<ol style="padding-left:20px;margin:0 0 14px">${items}</ol>`, p(esc(how)), controls ? muted(esc(care)) : '', p(SIGN), muted(esc(FOOT))]),
  };
}

export function noteEmail({ job, note, applyUrl, pageUrl, appUrl }) {
  const head = `Here’s an intro note for ${job.title} at ${job.company}. Paste it into the application, or send it to their recruiter:`;
  const apply = applyUrl ? `Apply on ${job.company}’s site: ${applyUrl}` : `The job: ${pageUrl}`;
  const swap = `Or let Swapply tailor your résumé, fill in the form and send it for you (you pay only once it’s confirmed sent): ${appUrl}`;
  return {
    text: [head, '', note, '', apply, swap, '', SIGN].join('\n'),
    html: html([p(esc(head)), `<blockquote style="margin:0 0 14px;padding:12px 14px;background:#f3f4f6;border-radius:8px;white-space:pre-wrap">${esc(note)}</blockquote>`,
      p(applyUrl ? `<a href="${esc(applyUrl)}" style="color:#1d4ed8">Apply on ${esc(job.company)}’s site</a>` : `<a href="${esc(pageUrl)}" style="color:#1d4ed8">The job</a>`),
      muted(`Or let <a href="${esc(appUrl)}" style="color:#1d4ed8">Swapply</a> tailor your résumé, fill in the form and send it for you. You pay only once it’s confirmed sent.`), p(SIGN)]),
  };
}

export function plainEmail(...lines) {
  const body = [...lines, '', SIGN];
  return { text: body.join('\n'), html: html(body.map((l) => (l ? p(esc(l)) : ''))) };
}

export const WELCOME = plainEmail(
  'Hi, I’m Swappy. I find open US jobs that fit you and e-mail them to you.',
  'Send me your résumé (PDF) or just tell me what you’re looking for, like “remote product designer” or “nurse in Austin, TX”.',
  'I’ll reply with the best matches, and send new ones every morning.',
);
export const ASK_ROLE = (missing) => plainEmail(
  'Thanks! One more thing so I can search:',
  missing || 'What kind of role are you looking for, and where (a city, or remote)?',
);
export const NO_MATCHES = plainEmail(
  'I looked through today’s new jobs and nothing fit you well enough to send.',
  'I’ll look again every morning and write when something does. You can also reply with a broader role or more places.',
);
export const NEED_RESUME = plainEmail(
  'To write a note that sounds like you, I need your background: paste your résumé’s text into a reply.',
);
export const CANT_OPEN = 'I can’t open attachments yet, so I matched from your e-mail. Paste your résumé’s text into a reply and I’ll sharpen these and write intro notes in your voice.';
export const CANT_OPEN_ASK = 'Thanks! I can’t open attachments yet. Reply with the role you want and where (a city, or remote), or paste your résumé’s text, and I’ll send matches right away.';
export const NOT_PDF = 'I can read résumés sent as PDF. If yours is a Word file, export it as PDF or paste the text into your reply.';
export const STOPPED = plainEmail('Done. I deleted everything I kept about you, and I won’t write again unless you e-mail me.');
export const PAUSED = plainEmail('Paused. No more morning e-mails. Reply RESUME whenever you want them back.');
export const RESUMED = plainEmail('Back on. You’ll get new matches each morning.');
export const OOPS = plainEmail('Sorry, something went wrong on my side while reading your e-mail. Please try again in a few minutes.');
