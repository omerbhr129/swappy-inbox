// What Swappy keeps, on the Sprite's own disk: one small JSON file per person (their search, a short factual
// summary of their résumé, the jobs already sent), and the inbox's bookkeeping. Never the résumé file itself.
// "STOP" deletes the person's file.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const fileFor = (email) => createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32) + '.json';

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, path);
}

export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function createStore(dir) {
  const users = join(dir, 'users');
  mkdirSync(users, { recursive: true });
  const statePath = join(dir, 'state.json');
  let state = readJson(statePath, { processed: {}, failures: {}, sends: {}, perSender: {} });
  const saveState = () => writeJson(statePath, state);

  return {
    getUser: (email) => readJson(join(users, fileFor(email)), null),
    saveUser: (user) => writeJson(join(users, fileFor(user.email)), user),
    deleteUser: (email) => { const p = join(users, fileFor(email)); if (existsSync(p)) rmSync(p); },
    allUsers: () => readdirSync(users).filter((f) => f.endsWith('.json')).map((f) => readJson(join(users, f), null)).filter(Boolean),

    isProcessed: (id) => Boolean(state.processed[id]),
    markProcessed(id, at = Date.now()) {
      state.processed[id] = at;
      delete state.failures[id];
      // Forget what is older than two weeks: the inbox is only read three days back.
      for (const [k, t] of Object.entries(state.processed)) if (at - t > 14 * 86_400_000) delete state.processed[k];
      saveState();
    },
    /** One more failed try at a message; returns how many so far. */
    failed(id) { state.failures[id] = (state.failures[id] ?? 0) + 1; saveState(); return state.failures[id]; },

    /** E-mails sent today, in all and to one person (AgentMail's daily allowance, and fairness). */
    sentToday: (now) => state.sends[dayKey(now)] ?? 0,
    sentTodayTo: (email, now) => state.perSender[`${dayKey(now)}:${email.toLowerCase()}`] ?? 0,
    countSend(email, now) {
      const d = dayKey(now);
      state.sends = { [d]: (state.sends[d] ?? 0) + 1 };
      const key = `${d}:${email.toLowerCase()}`;
      const kept = Object.fromEntries(Object.entries(state.perSender).filter(([k]) => k.startsWith(`${d}:`)));
      state.perSender = { ...kept, [key]: (kept[key] ?? 0) + 1 };
      saveState();
    },
  };
}
