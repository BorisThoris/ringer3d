import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Shot } from '../core/types';
import type { Agent, MatchResult } from './agents';
import type { Observation } from './game';

/**
 * An agent in another process, any language: it reads one JSON message per line on stdin and
 * answers each `observe` with one JSON shot per line on stdout.
 *
 *   -> {"type":"observe","obs":{...Observation}}
 *   <- {"placeAngle":1.57,"aimAngle":-1.57,"power":0.7,"spin":0}
 *   -> {"type":"end","seat":0,"result":{...}}
 *
 * Anything it prints to stderr is passed through. See examples/agents/.
 */
export function stdioAgent(command: string, name = `stdio:${command}`): Agent {
  let child: ChildProcessWithoutNullStreams | null = null;
  let lines: AsyncIterator<string> | null = null;
  const start = () => {
    if (child) return;
    child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.pipe(process.stderr);
    lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  };
  const send = (msg: unknown) => child!.stdin.write(JSON.stringify(msg) + '\n');
  return {
    name,
    async act(obs: Observation): Promise<Shot> {
      start();
      send({ type: 'observe', obs });
      for (;;) {
        const next = await lines!.next();
        if (next.done) throw new Error(`${name} exited without answering`);
        const text = next.value.trim();
        if (!text) continue;
        try {
          return JSON.parse(text) as Shot;
        } catch {
          process.stderr.write(`[${name}] ${text}\n`); // not JSON: treat it as a log line
        }
      }
    },
    end(result: MatchResult, seat: number) {
      if (child) send({ type: 'end', seat, result: { ...result, log: undefined } });
    },
    close() {
      child?.stdin.end();
      child?.kill();
      child = null;
    },
  };
}
