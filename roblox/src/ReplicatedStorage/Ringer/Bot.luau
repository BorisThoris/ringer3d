-- The bot: picks the marble it can knock out most surely, from wherever it may shoot, then
-- misses by as much as its profile says. A geometric planner (the web bot simulates every
-- candidate; here the server's own physics is the only simulator, so the bot reasons):
--  * the line from the shooter to the marble must be clear of other marbles;
--  * the marble, hit head on, travels on along that line: the shorter its way out, the better;
--  * the power is what carries the marble out, given the field's rolling resistance;
--  * careful bots prefer shots after which their shooter stays in the ring (to shoot again).

local Config = require(script.Parent.Config)
local Rules = require(script.Parent.Rules)

local Bot = {}

-- Head-on hit between the shooter and a marble (masses go as radius cubed).
local M1 = Config.SHOOTER_R ^ 3
local M2 = Config.MIB_R ^ 3
local E = 0.88
local GIVE = (1 + E) * M1 / (M1 + M2) -- marble speed / shooter speed at contact
local KEEP = (M1 - E * M2) / (M1 + M2) -- shooter speed after / before

local function gauss(rng: Random): number
	local u = math.max(1e-9, rng:NextNumber())
	return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * rng:NextNumber())
end

-- Distance from point c to the segment a-b.
local function segDist(a: Vector2, b: Vector2, c: Vector2): number
	local ab = b - a
	local t = math.clamp((c - a):Dot(ab) / math.max(ab:Dot(ab), 1e-9), 0, 1)
	return (a + ab * t - c).Magnitude
end

-- How far a marble at `p` moving along unit `d` goes before its centre crosses the ring line.
local function exitDistance(p: Vector2, d: Vector2): number
	local R = Config.RING_R + 0.3
	local b = p:Dot(d)
	local c = p:Dot(p) - R * R
	local disc = b * b - c
	if disc < 0 then
		return 0
	end
	return -b + math.sqrt(disc)
end

export type Plan = { placeAngle: number, aimAngle: number, power: number }

--- Plan a shot. `from` is the shooter's spot for a shoot-again (nil on a first shot);
--- `mibs` are the marbles still in the ring; `decel` the field's rolling resistance.
function Bot.plan(from: Vector2?, mibs: { Vector2 }, decel: number, profile: Config.Bot, rng: Random): Plan
	local spots = {}
	if from then
		table.insert(spots, { pos = from, angle = math.atan2(from.Y, from.X) })
	else
		for k = 0, 47 do
			local a = k / 48 * math.pi * 2
			table.insert(spots, { pos = Rules.placement(a), angle = a })
		end
	end

	local best, bestScore = nil, math.huge
	local options = {}
	for _, spot in ipairs(spots) do
		for i, t in ipairs(mibs) do
			local to = t - spot.pos
			local dist = to.Magnitude
			if dist > 1e-3 then
				local d = to.Unit
				-- Contact point: the shooter stops one radius-sum short of the marble's centre.
				local contact = t - d * (Config.SHOOTER_R + Config.MIB_R)
				local clear = true
				for j, o in ipairs(mibs) do
					if j ~= i and segDist(spot.pos, contact, o) < Config.SHOOTER_R + Config.MIB_R + 0.15 then
						clear = false
						break
					end
				end
				if clear then
					local out = exitDistance(t, d)
					-- Speed the marble needs to roll out (and a little past), then the shooter's.
					local need = math.sqrt(2 * decel * (out + 2.5))
					local atContact = need / GIVE
					local travel = math.max(0, (contact - spot.pos).Magnitude)
					local v0 = math.sqrt(atContact * atContact + 2 * decel * travel)
					local power = v0 / Config.MAX_SPEED
					if power <= 1 then
						local score = out + travel * 0.12
						if profile.careful then
							-- Where the shooter rolls to after the hit: out of the ring loses the next shot.
							local after = atContact * KEEP
							local rest = contact + d * (after * after / (2 * decel))
							if rest.Magnitude > Config.RING_R - 1 then
								score += 6
							end
						end
						local option = { placeAngle = spot.angle, aimAngle = math.atan2(d.Y, d.X), power = math.max(power, 0.12), score = score }
						table.insert(options, option)
						if score < bestScore then
							best, bestScore = option, score
						end
					end
				end
			end
		end
	end

	local pick = best
	if #options > 1 and rng:NextNumber() < profile.blunder then
		pick = options[rng:NextInteger(1, #options)]
	end
	if not pick then
		-- Nothing clean: a firm shot at the middle of the cross.
		local spot = spots[rng:NextInteger(1, #spots)]
		local d = (-spot.pos).Unit
		pick = { placeAngle = spot.angle, aimAngle = math.atan2(d.Y, d.X), power = 0.8 }
	end
	return {
		placeAngle = pick.placeAngle,
		aimAngle = pick.aimAngle + math.rad(gauss(rng) * profile.aimErrorDeg),
		power = math.clamp(pick.power * (1 + gauss(rng) * profile.powerError), 0.08, 1),
		-- Careful bots put backspin on, so the shooter stops near the hit and stays in the ring.
		spin = if profile.careful then -0.5 else 0,
	}
end

return Bot
