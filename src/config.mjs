// Everything Swappy reads from its environment. On the Sprite, the two providers are reached through Sprites
// connectors: the gateway holds the API keys, so the Sprite never does (README: "Run it on a Sprite").
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 8080),
    dataDir: env.DATA_DIR ?? here('../data/'),

    // Anthropic: the connector's gateway URL (or nothing, for api.anthropic.com with ANTHROPIC_API_KEY).
    anthropicBaseURL: env.ANTHROPIC_BASE_URL || undefined,
    // Behind the gateway the real key is added by Fly; the SDK still wants a value to send.
    anthropicApiKey: env.ANTHROPIC_API_KEY || 'added-by-the-sprites-gateway',
    model: env.SWAPPY_MODEL || 'claude-opus-5-5',

    // AgentMail: the connector's gateway URL (or the public API with AGENTMAIL_API_KEY).
    agentmailBase: (env.AGENTMAIL_BASE_URL || 'https://api.agentmail.to').replace(/\/+$/, ''),
    agentmailKey: env.AGENTMAIL_API_KEY || null,
    inboxId: env.AGENTMAIL_INBOX_ID || '',

    // The jobs: Swapply's public index of new US jobs (the same one swapplyjobs.com/jobs/search reads).
    postingsUrl: env.POSTINGS_URL || 'https://swapplyjobs.com/data/postings.json',
    siteBase: (env.SITE_BASE || 'https://swapplyjobs.com').replace(/\/+$/, ''),
    appUrl: 'https://apps.apple.com/app/apple-store/id6785090261?pt=128650812&ct=swappy-inbox&mt=8',

    // A hard ceiling on Claude calls a day, whatever arrives: the bill can never run away.
    maxLlmCallsPerDay: Number(env.MAX_LLM_CALLS_PER_DAY ?? 150),
    // AgentMail's free plan sends 100 e-mails a day; Swappy stays under it and keeps a share per person.
    maxSendsPerDay: Number(env.MAX_SENDS_PER_DAY ?? 90),
    maxRepliesPerSenderPerDay: Number(env.MAX_REPLIES_PER_SENDER ?? 12),
    // The morning e-mail goes out from this hour (UTC) on: 13:00 UTC is 8 am in New York.
    digestHourUtc: Number(env.DIGEST_HOUR_UTC ?? 13),
    publicUrl: env.PUBLIC_URL || '',
  };
}
