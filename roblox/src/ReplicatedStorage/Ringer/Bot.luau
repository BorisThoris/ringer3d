-- The bot, the web game's (src/ai/bot.ts) line for line. Bots play fair: they see only what a
-- player sees (where the marbles are), they produce the same shot a player produces (place,
-- aim, power, spin), and their hand shakes. Difficulty only changes how carefully they think
-- and how steady their hand is.
--
-- Ghost-ball candidates for every mib, scored by a quick prior; the best `candidates` of them
-- are played out on Ringer.Sim exactly as the game would play them, and the outcome is scored
-- (captures, shooting again, the leave, gifts left on the line). Careful bots re-imagine their
-- favourites with a slipped thumb. Every number here is in web units (Ringer.Sim's).

local Sim = require(script.Parent.Sim)
local Forge = require(script.Parent.Forge)

local Bot = {}

local W = Sim.WORLD
local TAU = math.pi * 2
local PLACE_R = W.ringRadius + W.shooterRadius + 0.02

export type Context = {
	layout: any, -- Ringer.Sim layout
	firstShot: boolean,
	seatAngle: number,
	surface: any,
	pieces: { any },
}

local function clamp(v: number, a: number, b: number): number
	return math.min(b, math.max(a, v))
end

local function wrap(a: number): number
	while a > math.pi do
		a -= TAU
	end
	while a < -math.pi do
		a += TAU
	end
	return a
end

local function segPointDist(x0, z0, x1, z1, px, pz)
	local dx, dz = x1 - x0, z1 - z0
	local len2 = dx * dx + dz * dz
	if len2 == 0 then
		len2 = 1e-9
	end
	local t = clamp(((px - x0) * dx + (pz - z0) * dz) / len2, 0, 1)
	return math.sqrt((x0 + dx * t - px) ^ 2 + (z0 + dz * t - pz) ^ 2)
end

local function segSegDist(ax, az, bx, bz, cx, cz, dx, dz)
	local function cross(ux, uz, vx, vz)
		return ux * vz - uz * vx
	end
	local d1 = cross(bx - ax, bz - az, cx - ax, cz - az)
	local d2 = cross(bx - ax, bz - az, dx - ax, dz - az)
	local d3 = cross(dx - cx, dz - cz, ax - cx, az - cz)
	local d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz)
	if d1 * d2 < 0 and d3 * d4 < 0 then
		return 0
	end
	return math.min(segPointDist(ax, az, bx, bz, cx, cz), segPointDist(ax, az, bx, bz, dx, dz), segPointDist(cx, cz, dx, dz, ax, az), segPointDist(cx, cz, dx, dz, bx, bz))
end

--- Does a solid map piece (post, bumper, wall) stand within `clear` of the segment?
local function obstacleOnPath(x0, z0, x1, z1, pieces, clear: number): boolean
	if not pieces then
		return false
	end
	for _, p in ipairs(pieces) do
		if p.kind == "post" or p.kind == "bumper" then
			if segPointDist(x0, z0, x1, z1, p.x, p.z) < p.r + clear then
				return true
			end
		elseif p.kind == "wall" then
			local hx = math.cos(p.a) * p.len / 2
			local hz = math.sin(p.a) * p.len / 2
			if segSegDist(x0, z0, x1, z1, p.x - hx, p.z - hz, p.x + hx, p.z + hz) < p.thick / 2 + clear then
				return true
			end
		end
	end
	return false
end

local function pathBlocked(x0, z0, x1, z1, ms, skip: number): boolean
	local dx, dz = x1 - x0, z1 - z0
	local len2 = dx * dx + dz * dz
	local clear = W.targetRadius + W.shooterRadius
	for _, m in ipairs(ms) do
		if m.id == skip then
			continue
		end
		local t = clamp(((m.x - x0) * dx + (m.z - z0) * dz) / len2, 0, 1)
		local px = x0 + dx * t - m.x
		local pz = z0 + dz * t - m.z
		if px * px + pz * pz < clear * clear then
			return true
		end
	end
	return false
end

--- Distance s >= 0 along (dx, dz) from (x, z) to the circle of radius r, or nil.
local function rayCircle(x, z, dx, dz, r): number?
	local b = x * dx + z * dz
	local c = x * x + z * z - r * r
	local disc = b * b - c
	if disc < 0 then
		return nil
	end
	local s = -b + math.sqrt(disc)
	return if s >= 0 then s else nil
end

--- Human hand tremor, applied to the bot's intended shot before it is sent.
local function jitter(s, p, rng)
	local aimErr = p.aimErrorDeg * math.pi / 180
	return {
		placeAngle = s.placeAngle + rng:gaussian() * aimErr * 0.25,
		aimAngle = s.aimAngle + rng:gaussian() * aimErr,
		power = clamp(s.power * (1 + rng:gaussian() * p.powerError), 0.05, 1),
		spin = clamp(s.spin + rng:gaussian() * 0.08, -1, 1),
	}
end

local function generateCandidates(ctx: Context, p, rng)
	local out = {}
	local rT, rS = W.targetRadius, W.shooterRadius
	local others = ctx.layout.targets
	local powers = { 0.42, 0.55, 0.7, 0.85, 1.0 }
	local spins = if p.usesSpin then { 0, -0.7 } else { 0 }
	local fixedOrigin = if not ctx.firstShot and ctx.layout.shooter then ctx.layout.shooter else nil

	for _, t in ipairs(others) do
		local dist = math.sqrt(t.x * t.x + t.z * t.z)
		local baseExit = if dist > 0.05 then math.atan2(t.z, t.x) else rng:range(0, TAU)
		for _, off in ipairs({ 0, -0.4, 0.4 }) do
			local ea = baseExit + off
			local ex, ez = math.cos(ea), math.sin(ea)
			local gx = t.x - ex * (rT + rS)
			local gz = t.z - ez * (rT + rS)

			local origins = {}
			if fixedOrigin then
				table.insert(origins, { x = fixedOrigin.x, z = fixedOrigin.z, place = ctx.seatAngle })
			else
				-- Knuckle down directly behind the ghost ball, plus a couple of cut-shot spots.
				local s = rayCircle(gx, gz, -ex, -ez, PLACE_R)
				if s then
					local ox, oz = gx - ex * s, gz - ez * s
					local pa = math.atan2(oz, ox)
					-- Wider spots too, for when posts and walls stand in the straight line.
					for _, d in ipairs({ 0, -0.18, 0.18, -0.45, 0.45 }) do
						local px, pz = Sim.placementPoint(pa + d)
						table.insert(origins, { x = px, z = pz, place = pa + d })
					end
				end
			end

			for _, o in ipairs(origins) do
				local ax, az = gx - o.x, gz - o.z
				local travel = math.sqrt(ax * ax + az * az)
				if travel < 1e-3 then
					continue
				end
				local aim = math.atan2(az, ax)
				local cut = math.abs(wrap(aim - ea))
				if cut > 1.15 then
					continue -- too thin to move it meaningfully
				end
				local blocked = pathBlocked(o.x, o.z, gx, gz, others, t.id) or obstacleOnPath(o.x, o.z, gx, gz, ctx.pieces, rS)
				-- A wall or bumper between the mib and the ring line will stop it leaving.
				local exitBlocked = obstacleOnPath(t.x, t.z, t.x + ex * (W.ringRadius + 0.5), t.z + ez * (W.ringRadius + 0.5), ctx.pieces, rT)
				-- Distance the target must travel to leave the ring along the exit line.
				local toEdge = W.ringRadius - (t.x * ex + t.z * ez) + rT
				for _, pw in ipairs(powers) do
					for _, sp in ipairs(spins) do
						local needed = 0.25 + 0.05 * travel + 0.06 * toEdge / math.max(0.2, math.cos(cut))
						local powerFit = -math.abs(pw - math.min(1, needed + 0.25))
						local prior = 3 - cut * 2 - (if blocked then 4 else 0) - (if exitBlocked then 2 else 0) + powerFit * 3 - travel * 0.05 + rng:next() * 0.3
						table.insert(out, { shot = { placeAngle = o.place, aimAngle = aim, power = pw, spin = sp }, prior = prior })
					end
				end
			end
		end
	end
	if #out == 0 then
		-- Nothing sensible: blast toward the middle.
		local fx, fz
		if fixedOrigin then
			fx, fz = fixedOrigin.x, fixedOrigin.z
		else
			fx, fz = Sim.placementPoint(ctx.seatAngle)
		end
		table.insert(out, { shot = { placeAngle = ctx.seatAngle, aimAngle = math.atan2(-fz, -fx), power = 0.8, spin = 0 }, prior = 0 })
	end
	return out
end

--- Play an intended shot exactly as the game would and score the outcome.
local function imagine(ctx: Context, shot, p, yield: (() -> ())?): number
	local sim = Sim.new(ctx.layout, ctx.surface, shot, ctx.firstShot, ctx.pieces)
	sim:runToEnd(yield)
	local after = sim:resultLayout()

	local captures, left = 0, {}
	for _, t in ipairs(after.targets) do
		if Sim.isOutsideRing(t.x, t.z) then
			captures += 1
		else
			table.insert(left, t)
		end
	end
	local s = after.shooter
	local shooterIn = s ~= nil and not Sim.isOutsideRing(s.x, s.z)

	local v = captures * 10
	if captures > 0 and shooterIn then
		v += 6
		-- Leave: a target close by makes the next shot easy.
		local nearest = math.huge
		for _, t in ipairs(left) do
			nearest = math.min(nearest, math.sqrt((t.x - s.x) ^ 2 + (t.z - s.z) ^ 2))
		end
		if #left > 0 then
			v += p.positional * math.max(0, 3 - nearest)
		end
	end
	if captures == 0 or not shooterIn then
		-- Turn passes: don't hand the opponent easy marbles sitting on the line.
		local gifts = 0
		for _, t in ipairs(left) do
			if math.sqrt(t.x * t.x + t.z * t.z) > W.ringRadius - 0.6 then
				gifts += 1
			end
		end
		v -= p.positional * gifts * 1.5
	end
	if not shooterIn then
		v -= 1
	end
	return v
end

--- The rng a bot's shot uses: from the match seed, the shot number and the seat (0-based,
--- as the web game counts), so a replay or another peer gets the same bot.
function Bot.rng(seed: number, shotsTaken: number, seat0: number)
	return Forge.Rng.new(Forge.hashString(string.format("%d:%d:%d", seed, shotsTaken, seat0)))
end

--- Choose a shot. Calls `yield` after every simulated step of every imagined shot (a server
--- passes Table.slicer, which gives the frame back every few milliseconds), so a long think
--- never stalls the game.
function Bot.plan(ctx: Context, profile, rng, yield: (() -> ())?)
	local cands = generateCandidates(ctx, profile, rng)
	table.sort(cands, function(a, b)
		return a.prior > b.prior
	end)
	local pool = {}
	for i = 1, math.min(#cands, math.max(4, profile.candidates)) do
		pool[i] = cands[i]
	end

	for _, c in ipairs(pool) do
		c.value = imagine(ctx, c.shot, profile, yield)
	end

	-- Careful players also ask "what if my thumb slips a little?" on their favourite shots.
	local byValue = function(a, b)
		return a.value > b.value
	end
	table.sort(pool, byValue)
	local careful = math.floor(profile.positional * 5 + 0.5)
	if careful > 0 then
		for i = 1, math.min(careful, #pool) do
			local c = pool[i]
			local sum = c.value
			for _ = 1, 2 do
				sum += imagine(ctx, jitter(c.shot, profile, rng), profile, yield)
			end
			c.value = sum / 3
		end
		table.sort(pool, byValue)
	end

	local pick = pool[1]
	if rng:next() < profile.blunder then
		local n = math.max(1, math.floor(#pool * 0.4))
		pick = pool[rng:int(n) + 1]
	end
	return jitter(pick.shot, profile, rng)
end

return Bot
