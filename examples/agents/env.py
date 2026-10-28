"""Drive Ringer 3D as an environment from Python (a gym-style loop for learning agents).

    npm run headless:build
    python examples/agents/env.py

`reset` starts a game against built-in bots; `step` plays your shot, lets the opponents move,
and returns the next observation, a reward (your captures minus theirs) and whether it's over.
"""
import json
import math
import random
import subprocess


class RingerEnv:
    def __init__(self, cmd=("node", "dist-headless/ringer-headless.mjs", "serve")):
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def _call(self, msg):
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()
        out = json.loads(self.p.stdout.readline())
        if "error" in out:
            raise RuntimeError(out["error"])
        return out

    def reset(self, arena="grass", difficulty="medium", seed=1, opponents=("bot:casual",)):
        return self._call({"op": "reset", "spec": {"arena": arena, "difficulty": difficulty, "seed": seed}, "seat": 0, "opponents": list(opponents)})["obs"]

    def step(self, shot):
        r = self._call({"op": "step", "shot": shot})
        return r["obs"], r["reward"], r["done"], r

    def close(self):
        self.p.stdin.write(json.dumps({"op": "close"}) + "\n")
        self.p.stdin.flush()
        self.p.wait()


if __name__ == "__main__":
    env = RingerEnv()
    obs, total, done = env.reset(seed=random.randrange(1 << 30)), 0, False
    while not done:
        a = obs["seatAngle"]
        frm = obs["shooter"] or {"x": math.cos(a) * obs["world"]["ringRadius"], "z": math.sin(a) * obs["world"]["ringRadius"]}
        shot = {"placeAngle": a, "aimAngle": math.atan2(-frm["z"], -frm["x"]) + random.uniform(-0.3, 0.3), "power": random.uniform(0.4, 0.95), "spin": 0}
        obs, reward, done, info = env.step(shot)
        total += reward
    print("final scores", info["scores"], "return", total)
    env.close()
