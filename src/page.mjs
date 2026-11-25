// The page at the Sprite's URL: what Swappy is and how to start. No one's data is ever on it.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function landingPage({ address }) {
  const a = esc(address);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Swappy — a job hunter in your inbox</title>
<meta name="description" content="E-mail Swappy your résumé. It replies with open US jobs that fit you, and new ones every morning.">
<style>
:root{--ink:#14161a;--muted:#5b6270;--accent:#2457f5;--bg:#f6f7fb;--card:#fff}
@media (prefers-color-scheme:dark){:root{--ink:#eef0f4;--muted:#a3a9b6;--accent:#7a9cff;--bg:#0f1115;--card:#181b22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
main{max-width:640px;margin:0 auto;padding:56px 20px}
h1{font-size:40px;line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}p{margin:0 0 14px;color:var(--muted)}
.addr{display:inline-block;margin:18px 0 28px;padding:14px 18px;border-radius:14px;background:var(--card);font:600 20px ui-monospace,Menlo,monospace;color:var(--accent);text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.08)}
ol{padding-left:22px;margin:0 0 24px}li{margin:0 0 10px}li b{color:var(--ink)}
.small{font-size:13px}
</style></head><body><main>
<h1>A job hunter<br>in your inbox.</h1>
<p>E-mail Swappy your résumé, or just what you’re looking for. It replies with open US jobs that fit you, and new ones every morning.</p>
<a class="addr" href="mailto:${a}?subject=Find%20me%20a%20job">${a}</a>
<ol>
<li><b>Send a résumé (PDF) or a line</b> like “remote product designer” or “ICU nurse in Austin, TX”.</li>
<li><b>Get your best five matches</b>, each with why it fits, from thousands of new jobs on employers’ own boards.</li>
<li><b>Reply with a number</b> and Swappy writes an intro note for that job, from your résumé only.</li>
<li><b>New matches every morning.</b> Reply PAUSE to stop, STOP to delete everything it keeps.</li>
</ol>
<p class="small">Swappy runs on a Fly.io Sprite, reads its mail through AgentMail and thinks with Claude (Anthropic), through Sprites connectors. Jobs come from <a href="https://swapplyjobs.com" style="color:var(--accent)">Swapply</a>. It keeps a short summary of your résumé to find matches, nothing more.</p>
</main></body></html>`;
}
