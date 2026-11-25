# Swappy — a job hunter in your inbox

E-mail Swappy your résumé, or one line like *"remote product designer"*. It replies with the five open US jobs
that fit you best, each with why. Reply with a number and it writes you an intro note for that job, from your
résumé only. Every morning it sends the new ones. Reply `PAUSE` to stop, `STOP` to delete everything it keeps.

Built for [Fly.io Hacksgiving](https://fly.io/hacksgiving) (November 2026). It runs on a **Fly.io Sprite** and
talks to the outside world only through **Sprites connectors**:

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

- **The Sprite sleeps between e-mails.** A webhook or the morning nudge wakes it in under a second; idle, it is
  not billed. Everything it keeps (one small JSON file per person) is on the Sprite's own disk.
- **No keys on the machine.** The connectors' gateway adds the AgentMail and Anthropic keys; the Sprite holds none.
- **The public URL is only a doorbell.** `/hook` ignores the request body: Swappy reads AgentMail's own copy of the
  inbox through the authenticated connector. `/tick` can be called by anyone and still sends nothing twice a day.
- **E-mail is untrusted data.** Claude has no tools here; its answers are schema-checked JSON or a short note, and
  they only ever go back to the person who wrote. Job ids it returns are checked against the shortlist. Notes use
  only facts from the résumé, never invented ones.
- **No mail loops, no spam.** Auto-replies, bounces, mailing lists and its own messages are never answered; a
  stranger writing about something else gets one hello, then silence. Sends stay under AgentMail's daily limit,
  with a per-person cap.
- **Claude Opus 5.5** with server-side refusal fallbacks (`fallbacks: "default"`), low effort for reading and
  ranking, medium for notes.

## Run it on a Sprite

```sh
sprite create swappy && sprite use swappy
# In the Fly dashboard → Sprites → Connectors: add Anthropic and AgentMail (your keys), access for "swappy*".
sprite exec -- node scripts/setup.mjs            # shows each connector's gateway URL
sprite exec --env AGENTMAIL_BASE_URL=<agentmail gateway url> -- node scripts/setup.mjs inbox
sprite-env services create swappy --cmd node --args "src/server.mjs" --http-port 8080 \
  --env "ANTHROPIC_BASE_URL=<anthropic gateway url>,AGENTMAIL_BASE_URL=<agentmail gateway url>,AGENTMAIL_INBOX_ID=<inbox id>"
sprite config update --url-auth public
sprite exec --env AGENTMAIL_BASE_URL=<…>,AGENTMAIL_INBOX_ID=<…> -- node scripts/setup.mjs webhook https://<sprite url>
```

Then set the repository variable `SWAPPY_URL` for the morning workflow.

## Develop

```sh
npm install
npm test        # the agent end to end against a fake inbox, a fake Claude and a small job list
```

Locally, `ANTHROPIC_API_KEY` and `AGENTMAIL_API_KEY` with the public base URLs work the same way.
