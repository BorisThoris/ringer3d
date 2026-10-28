// Open Cloud helpers for the Ringer 3D experience. The API key is read from a file outside the
// repo (ROBLOX_KEY_FILE, default D:/agent-work/ringer3d/roblox-secrets/opencloud.key).
import { readFileSync } from 'node:fs';

export const UNIVERSE = 10773508905;
export const PLACE = 114836219465070;

const KEY_FILE = process.env.ROBLOX_KEY_FILE ?? 'D:/agent-work/ringer3d/roblox-secrets/opencloud.key';
const key = () => readFileSync(KEY_FILE, 'utf8').trim();

export async function api(method, url, body, contentType = 'application/json') {
  const r = await fetch(url, {
    method,
    headers: { 'x-api-key': key(), ...(body !== undefined ? { 'content-type': contentType } : {}) },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 400)}`);
  return json ?? text;
}

/** Upload a place file as a new version: 'Saved' (draft) or 'Published' (live). */
export function publishPlace(file, versionType = 'Published') {
  return api(
    'POST',
    `https://apis.roblox.com/universes/v1/${UNIVERSE}/places/${PLACE}/versions?versionType=${versionType}`,
    readFileSync(file),
    'application/xml',
  );
}

/**
 * Run a Luau script on a fresh cloud server for a place version and wait for it: returns
 * { state, output, logs }. Used to smoke-test the live game with no Studio.
 */
export async function runLuau(script, version, timeout = '120s') {
  const base = `https://apis.roblox.com/cloud/v2/universes/${UNIVERSE}/places/${PLACE}${version ? `/versions/${version}` : ''}/luau-execution-session-tasks`;
  let task = await api('POST', base, { script, timeout });
  for (let i = 0; i < 120 && !['COMPLETE', 'FAILED', 'CANCELLED'].includes(task.state); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    task = await api('GET', `https://apis.roblox.com/cloud/v2/${task.path}`);
    if (process.env.LUAU_DEBUG) console.error('poll', task.state, task.path);
  }
  let logs = [];
  try {
    const l = await api('GET', `https://apis.roblox.com/cloud/v2/${task.path}/logs?view=STRUCTURED`);
    logs = (l.luauExecutionSessionTaskLogs ?? []).flatMap((x) => x.structuredMessages ?? x.messages ?? []);
  } catch (e) {
    logs = [String(e)];
  }
  return { state: task.state, output: task.output, error: task.error, logs };
}
