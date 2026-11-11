-- Ringer rules, the same as the web game's (src/core/match.ts), with no world in them:
--  * the shooter knuckles down anywhere on the ring line for the first shot of a turn;
--  * every marble knocked fully out of the ring is kept by the shooter;
--  * capture something and stay inside the ring: shoot again from where the shooter stopped;
--  * miss, or let the shooter leave the ring: the turn passes (marbles knocked out still count);
--  * the game ends when the ring is empty or the leader can no longer be caught.
-- Positions here are relative to the ring's centre, on the ground plane (x, z), in studs.
-- Ringer.Sim plays the shots; this is the scoring, shared with the client.

local Config = require(script.Parent.Config)
local Sim = require(script.Parent.Sim)

local Rules = {}

--- The starting cross: one in the middle, three along each arm.
function Rules.startingCross(): { Vector2 }
	local s = Config.SPACING
	local out = { Vector2.new(0, 0) }
	for _, d in ipairs({ Vector2.new(1, 0), Vector2.new(-1, 0), Vector2.new(0, 1), Vector2.new(0, -1) }) do
		for k = 1, 3 do
			table.insert(out, d * (s * k))
		end
	end
	return out
end

function Rules.isOutside(p: Vector2, radius: number?): boolean
	-- A marble counts as out once its centre is past the line (as on the web).
	return p.Magnitude > Config.RING_R
end

--- Where the shooter sits for a first shot at `angle` (radians): just outside the line (studs).
function Rules.placement(angle: number): Vector2
	local x, z = Sim.placementPoint(angle)
	return Vector2.new(x, z) * Config.MAP_SCALE
end

--- Each seat's default knuckle-down angle.
function Rules.seatAngle(seat: number, seats: number): number
	return math.pi / 2 + ((seat - 1) / seats) * math.pi * 2
end

--- Is the game over? Returns the winning seats if it is.
function Rules.gameOver(scores: { number }, remaining: number, dryShots: number): { number }?
	local best = -1
	for _, s in ipairs(scores) do
		best = math.max(best, s)
	end
	local leaders, second = {}, -1
	for i, s in ipairs(scores) do
		if s == best then
			table.insert(leaders, i)
		else
			second = math.max(second, s)
		end
	end
	local locked = #leaders == 1 and best > second + remaining
	if remaining == 0 or locked or dryShots >= Config.DRY_SHOTS_LIMIT then
		return leaders
	end
	return nil
end

return Rules
