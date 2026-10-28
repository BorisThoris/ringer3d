"""A Ringer 3D agent in Python: aim at the marble nearest the ring line.

    npm run headless:build
    node dist-headless/ringer-headless.mjs play stdio:"python examples/agents/nearest.py" bot:casual --games 5

The game sends one JSON line per turn ({"type":"observe","obs":...}); answer with one JSON shot.
"""
import json
import math
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("type") != "observe":
        continue
    o = msg["obs"]
    R = o["world"]["ringRadius"]
    if o["firstShotOfTurn"]:
        # Knuckle down on the ring line opposite the target closest to the edge.
        t = max(o["targets"], key=lambda m: math.hypot(m["x"], m["z"]))
        place = math.atan2(t["z"], t["x"]) + math.pi
        frm = (math.cos(place) * R, math.sin(place) * R)
    else:
        place = o["seatAngle"]
        frm = (o["shooter"]["x"], o["shooter"]["z"])
        t = min(o["targets"], key=lambda m: math.hypot(m["x"] - frm[0], m["z"] - frm[1]))
    aim = math.atan2(t["z"] - frm[1], t["x"] - frm[0])
    print(json.dumps({"placeAngle": place, "aimAngle": aim, "power": 0.85, "spin": 0.3}), flush=True)
