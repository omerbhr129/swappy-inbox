# Swappy — a job hunter in your inbox

**Try it: e-mail [swappy@agentmail.to](mailto:swappy@agentmail.to)** with your résumé attached, or one line like
*"remote product designer"* or *"backend engineer in Austin, TX"*.

Swappy replies in the same thread with the five open US jobs that fit you best, each with a reason taken from your
background. Reply with a number and it writes you a short intro note for that job, using only what is in your
résumé, plus the employer's own apply link. Every morning it sends the new ones. Reply `PAUSE` to stop, `STOP` to
delete everything it keeps about you.

```
You:     Hi Swappy, my résumé is attached.                        [Jordan-Rivera-Resume.pdf]

Swappy:  Hi Jordan, here are 5 open roles that fit what you sent me:
         1. Senior Product Designer - Patient Matching — Rula (Remote (US))
            Your patient intake redesign and health tech experience map directly onto patient matching flows.
         2. UX Design — MeridianLink (Remote (US))
            Remote B2B SaaS UX role where your design system and analytics dashboard work apply.
         …
         Reply with a number (like "2") and I'll write you a short intro note for that job.

You:     1

Swappy:  Here's an intro note for Senior Product Designer - Patient Matching at Rula:
         "Hi, I'm a product designer with 6 years in B2B SaaS and health tech. … As Senior Product Designer at
          Northwind Health, I led a patient intake redesign across 40 clinics that raised completion from 61% to
          84%. …"
         Apply on Rula's site: https://jobs.ashbyhq.com/rula/…
```

*(Jordan Rivera is a fictional person made for the demo.)*

Built for [Fly.io Hacksgiving](https://fly.io/hacksgiving) (November 2026). It runs on a **Fly.io Sprite** and
talks to the outside world through **Sprites connectors**:

| Connector | What Swappy uses it for |
|---|---|
| **AgentMail** | its own e-mail inbox: read new mail, reply in the thread, send the morning e-mail |
| **Anthropic** | Claude reads the résumé, ranks the shortlist, writes the notes |

The jobs are [Swapply](https://swapplyjobs.com)'s public index of new US jobs from employers' own boards
(Greenhouse, Lever, Ashby and others), a few thousand fresh roles a day.

## How it works

```
 you ──e-mail──▶ AgentMail inbox ──webhook "look"──▶ Sprite (asleep until now)
                                                     │  read the inbox through the AgentMail connector
                                                     │  résumé PDF ──▶ Claude: profile (schema-checked JSON)
                                                     │  5,000 jobs ──local shortlist──▶ 60 ──▶ Claude: best 5 + why
                                                     ▼
 you ◀──reply in the same thread── AgentMail ◀────── reply
 every morning: GitHub Action ──POST /tick──▶ Sprite ──▶ new matches only, once a day per person
```

A first reply costs two Claude calls (read the profile, rank the shortlist); a note is one more.

- **The Sprite sleeps between e-mails.** AgentMail's webhook wakes it in seconds; idle, it is not billed. A GitHub
  Action nudges it every morning for the daily matches, and every 20 minutes as a safety net in case a webhook was
  missed. Everything it keeps (one small JSON file per person, never the résumé file) is on the Sprite's own disk.
- **The provider keys live in the connectors.** Fly's gateway adds the Anthropic and AgentMail keys to each call;
  the code never sees them. (One exception, below: an optional read-only key for attachments.)
- **The public URL is only a doorbell.** `/hook` ignores the request body: Swappy reads AgentMail's own copy of the
  inbox through the authenticated connector. `/tick` can be called by anyone and still sends nothing twice a day.
- **E-mail is untrusted data.** Claude has no tools here; its answers are schema-checked JSON or a short note, and
  they only ever go back to the person who wrote. Job ids it returns are checked against the shortlist. Notes use
  only facts from the résumé, never invented ones.
- **No mail loops, no spam, no runaway bill.** Auto-replies, bounces, mailing lists and its own messages are never
  answered; a stranger writing about something else gets one hello, then silence. Sends stay under AgentMail's
  daily limit with a per-person cap, and Claude calls have a hard daily ceiling (150).
- **Claude Opus 5.5** with server-side refusal fallbacks (`fallbacks: "default"`), low effort for reading and
  ranking, medium for notes.

## What the AgentMail connector does not pass, and what Swappy does about it

Found while building this, in case it saves someone else an afternoon:

| Through the Sprites AgentMail gateway | Swappy's way around it |
|---|---|
| A single message by id is refused when the id contains `=` (most Gmail Message-IDs do) | It reads the message from its thread (`GET /threads/{id}` works) |
| Replying to such a message is refused for the same reason | It sends a new message with `In-Reply-To` and `References` headers, so mail apps still thread it |
| Labelling such a message is refused | It skips the label; its own processed list on disk is what counts |
| Attachments (`/attachments`, `/raw`) are not proxied at all | An optional second AgentMail key, **read-only and limited to this one inbox**, in `~/.agentmail-key`, used only to download attachments. Without it, Swappy tells the sender it can't open files yet and asks them to paste their résumé's text |
| Webhook admin is not proxied | The webhook is made once in AgentMail's console |

## Run it on a Sprite

```sh
sprite create swappy && sprite use swappy
# In the Fly dashboard → Sprites → Connectors: add Anthropic and AgentMail (your keys), access for "swappy*".
sprite exec -- node scripts/setup.mjs            # shows each connector's gateway URL
sprite exec --env AGENTMAIL_BASE_URL=<agentmail gateway url> -- node scripts/setup.mjs inbox
sprite-env services create swappy --cmd node --args "src/server.mjs" --http-port 8080 \
  --env "ANTHROPIC_BASE_URL=<anthropic gateway url>,AGENTMAIL_BASE_URL=<agentmail gateway url>,AGENTMAIL_INBOX_ID=<inbox id>"
sprite config update --url-auth public
sprite exec --env AGENTMAIL_BASE_URL=<…>,AGENTMAIL_INBOX_ID=<…> -- node scripts/setup.mjs check
```

Then:

1. In AgentMail's console: **Webhooks → Add endpoint** → `https://<sprite url>/hook`, event `message.received`.
2. Set the repository variable `SWAPPY_URL` to the Sprite's URL, for the wake-up workflow.
3. Optional, to read attached résumés: create a second AgentMail key, scoped to this inbox, **read-only**, copy it,
   and pipe it straight onto the Sprite without it touching a file or the screen:
   `pbpaste | sprite exec --stdin -- sh -c 'umask 077; cat > ~/.agentmail-key'`. It is read at each use; no restart.

## Develop

```sh
npm install
npm test        # the agent end to end against a fake inbox, a fake Claude and a small job list
```

Locally, `ANTHROPIC_API_KEY` and `AGENTMAIL_API_KEY` with the public base URLs work the same way.
