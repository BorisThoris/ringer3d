-- Generated maps: the web game's src/game/maps.ts, line for line, in the web game's units (the
-- ring is 5.5 across its radius; Roblox tables are 4x that, Config.MAP_SCALE). A map is a
-- field, a difficulty and a seed; from those the generator lays out what you would really find
-- there: books, pencils and coins on a desk, cracks and puddles on a street, molehills and mud
-- on a lawn... Bumpers, speed pads and cups live only on the Mini-Golf course.
--
-- Every piece is repeated with rotational symmetry around the cross, so no seat gets an easier
-- line. The random draws happen in exactly the TypeScript order, so the same spec gives the same
-- map (tests/maps.luau checks it against the web generator's output).

local Forge = require(script.Parent.Forge)
local Rng = Forge.Rng

local Maps = {}

local R = 5.5 -- WORLD.ringRadius
local B = 13 -- WORLD.boundaryRadius
local CROSS_CLEAR = 2.7
local LINE_CLEAR = 0.6
local PASSAGE = 0.5
local PI = math.pi

Maps.DIFFICULTIES = { "easy", "medium", "hard" }

local BUDGET = {
	easy = { fold = { 2 }, objects = { 0, 2 }, hazard = 0.45, bumpers = { 0, 2 }, cups = { 2, 2 }, pads = { 0, 0 }, backstops = { 2, 2 } },
	medium = { fold = { 2, 4 }, objects = { 2, 4 }, hazard = 0.75, bumpers = { 4, 6 }, cups = { 2, 4 }, pads = { 0, 2 }, backstops = { 2, 4 } },
	hard = { fold = { 4 }, objects = { 4, 8 }, hazard = 1, bumpers = { 4, 8 }, cups = { 4, 4 }, pads = { 4, 4 }, backstops = { 4, 4 } },
}

local BACKSTOP = {
	desk = { "book", { 1.1, 1.5 }, 0.38, 0.5 },
	culdesac = { "kerbstone", { 1.1, 1.5 }, 0.3, 0.32 },
	grass = { "log", { 1.3, 1.8 }, 0.3, 0.3 },
	sand = { "driftwood", { 1.4, 2 }, 0.24, 0.24 },
	ice = { "iceblock", { 1, 1.4 }, 0.32, 0.38 },
	gravel = { "slab", { 1, 1.4 }, 0.28, 0.25 },
	minigolf = { "rail", { 1.2, 1.8 }, 0.16, 0.36 },
}

local function round(v: number): number
	return math.floor(v + 0.5)
end
local function q(v: number): number
	return round(v * 1000) / 1000
end
local function hypot(x: number, z: number): number
	return math.sqrt(x * x + z * z)
end

local function footprint(p): number
	if p.kind == "wall" then
		return p.len / 2
	elseif p.kind == "post" or p.kind == "bumper" or p.kind == "hole" then
		return p.r
	elseif p.kind == "bump" then
		return p.r * 0.8
	end
	return 0
end
local function solid(p): boolean
	return p.kind == "wall" or p.kind == "post" or p.kind == "bumper" or p.kind == "hole"
end
local function centre(p): (number, number)
	if p.kind == "ridge" then
		return (p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2
	end
	return p.x, p.z
end

local function rotate(p, a: number)
	local c, s = math.cos(a), math.sin(a)
	local function rx(x, z)
		return q(x * c - z * s)
	end
	local function rz(x, z)
		return q(x * s + z * c)
	end
	local o = table.clone(p)
	if p.kind == "ridge" then
		o.x1, o.z1, o.x2, o.z2 = rx(p.x1, p.z1), rz(p.x1, p.z1), rx(p.x2, p.z2), rz(p.x2, p.z2)
	else
		o.x, o.z = rx(p.x, p.z), rz(p.x, p.z)
		if p.kind == "wall" or p.kind == "zone" then
			o.a = q(p.a + a)
		end
	end
	return o
end

-- ---- The builder ------------------------------------------------------------------------
local Builder = {}
Builder.__index = Builder

local function newBuilder(rng, fold: number)
	return setmetatable({ pieces = {}, rng = rng, fold = fold }, Builder)
end

function Builder:at(r: number, a: number)
	return { x = q(math.cos(a) * r), z = q(math.sin(a) * r) }
end
function Builder:inRing()
	local r = self.rng:range(CROSS_CLEAR + 0.35, R - 0.95)
	local a = self.rng:range(0, PI * 2)
	return self:at(r, a)
end
function Builder:anywhere(rMin: number?, rMax: number?)
	local r = self.rng:range(rMin or 2.2, rMax or (B - 1.4))
	local a = self.rng:range(0, PI * 2)
	return self:at(r, a)
end
function Builder:per(total: number): number
	return math.floor(total / self.fold + self.rng:next())
end

function Builder:fits(p, staged): boolean
	local x, z = centre(p)
	local d = hypot(x, z)
	local f = footprint(p)
	if d + f > B - 0.9 then
		return false
	end
	local function each(fn)
		for _, o in ipairs(self.pieces) do
			if fn(o) == false then
				return false
			end
		end
		for _, o in ipairs(staged) do
			if fn(o) == false then
				return false
			end
		end
		return true
	end
	if solid(p) then
		if d - f < CROSS_CLEAR then
			return false
		end
		if math.abs(d - R) < f + LINE_CLEAR then
			return false
		end
		return each(function(o)
			if not solid(o) then
				return
			end
			local cx, cz = centre(o)
			if hypot(cx - x, cz - z) < f + footprint(o) + PASSAGE then
				return false
			end
		end)
	elseif p.kind == "zone" then
		if d - p.r < 1.9 then
			return false
		end
		return each(function(o)
			if not solid(o) and not (o.kind == "zone" and o.effect == "boost") then
				return
			end
			local cx, cz = centre(o)
			local r = if o.kind == "zone" then o.r else footprint(o)
			if hypot(cx - x, cz - z) < p.r + r + 0.1 then
				return false
			end
		end)
	elseif p.kind == "bump" then
		if d - f < CROSS_CLEAR - 0.4 then
			return false
		end
		if math.abs(d - R) < f + 0.3 then
			return false
		end
		return each(function(o)
			if not solid(o) then
				return
			end
			local cx, cz = centre(o)
			if hypot(cx - x, cz - z) < f + footprint(o) + 0.1 then
				return false
			end
		end)
	elseif p.kind == "ridge" then
		for _, pt in ipairs({ { p.x1, p.z1 }, { p.x2, p.z2 }, { x, z } }) do
			local dd = hypot(pt[1], pt[2])
			if math.abs(dd - R) < 0.35 or dd < CROSS_CLEAR - 0.6 then
				return false
			end
		end
	end
	return true
end

function Builder:place(make, tries: number?): boolean
	for _ = 1, tries or 14 do
		local p = make()
		local staged = {}
		local ok = true
		for k = 0, self.fold - 1 do
			local c = rotate(p, (k / self.fold) * PI * 2)
			if not self:fits(c, staged) then
				ok = false
				break
			end
			table.insert(staged, c)
		end
		if ok then
			for _, c in ipairs(staged) do
				table.insert(self.pieces, c)
			end
			return true
		end
	end
	return false
end

-- ---- Piece makers ------------------------------------------------------------------------
function Builder:lump(skin: string, r: number, sink: number, at)
	at = at or self:anywhere()
	return self:place(function()
		return { kind = "bump", x = at.x, z = at.z, r = q(r), sink = sink, skin = skin }
	end, 4)
end
function Builder:patchOf(skin: string, effect: string, k: number, rr, at)
	return self:place(function()
		local p = if at then at() else self:anywhere(2.4, R + 1.5)
		return { kind = "zone", x = p.x, z = p.z, r = q(self.rng:range(rr[1], rr[2])), effect = effect, a = 0, k = k, skin = skin }
	end)
end
function Builder:lying(skin: string, len: number, r: number, at)
	at = at or self:anywhere(2.6, R - 0.6)
	return self:place(function()
		local a = self.rng:range(0, PI)
		local hx = (math.cos(a) * len) / 2
		local hz = (math.sin(a) * len) / 2
		return { kind = "ridge", x1 = q(at.x - hx), z1 = q(at.z - hz), x2 = q(at.x + hx), z2 = q(at.z + hz), r = r, skin = skin }
	end)
end
function Builder:crack(skin: string, segs: number, step: number, width: number)
	local p = self:anywhere(2.4, B - 2)
	local x, z = p.x, p.z
	local dir = self.rng:range(0, PI * 2)
	for _ = 1, segs do
		dir += self.rng:range(-0.55, 0.55)
		local nx = q(x + math.cos(dir) * step)
		local nz = q(z + math.sin(dir) * step)
		if hypot(nx, nz) > B - 1.2 then
			break
		end
		local x0, z0 = x, z
		self:place(function()
			return { kind = "ridge", x1 = x0, z1 = z0, x2 = nx, z2 = nz, r = width, skin = skin }
		end, 1)
		x, z = nx, nz
	end
end
function Builder:post(skin: string, rr, h: number)
	return self:place(function()
		local p = self:inRing()
		return { kind = "post", x = p.x, z = p.z, r = q(self.rng:range(rr[1], rr[2])), h = h, skin = skin }
	end)
end
function Builder:backstop(skin: string, len, thick: number, h: number)
	return self:place(function()
		local r = self.rng:range(R + 1.4, R + 3)
		local a = self.rng:range(0, PI * 2)
		local p = self:at(r, a)
		local l = q(self.rng:range(len[1], len[2]))
		return { kind = "wall", x = p.x, z = p.z, len = l, thick = thick, h = h, a = q(math.atan2(p.z, p.x) + PI / 2), skin = skin }
	end)
end
function Builder:block(skin: string, len, thick: number, h: number)
	return self:place(function()
		local p = self:inRing()
		local a = math.atan2(p.z, p.x)
		local along = self.rng:next() < 0.7
		local l = q(self.rng:range(len[1], len[2]))
		return { kind = "wall", x = p.x, z = p.z, len = l, thick = thick, h = h, a = q(if along then a + PI / 2 else a), skin = skin }
	end)
end

-- ---- Each field's plan ------------------------------------------------------------------
local function n(b, total: number): number
	return b:per(round(total))
end
local function pick(b, xs)
	return xs[b.rng:int(#xs) + 1]
end

local FIELD = {
	desk = {
		ground = function(b, h)
			for _ = 1, n(b, 2 + h * 2) do
				b:patchOf("paper", "slick", 0.6, { 0.8, 1.15 })
			end
			for _ = 1, n(b, 2 + h * 4) do
				local skin = pick(b, { "coin", "coin", "coin-silver" })
				b:lump(skin, 0.6, 0.96)
			end
			for _ = 1, n(b, h * 4) do
				b:lying("paperclip", 0.42, 0.028)
			end
			for _ = 1, n(b, 1 + h * 3) do
				b:lying("pencil", 1.8, 0.07)
			end
			if h >= 0.75 then
				for _ = 1, n(b, 2) do
					b:patchOf("coffee", "sticky", 1.7, { 0.45, 0.65 })
				end
			end
		end,
		object = function(b)
			local r = b.rng:next()
			if r < 0.4 then
				b:block("book", { 0.9, 1.3 }, 0.38, 0.5)
			elseif r < 0.6 then
				b:block("eraser", { 0.45, 0.55 }, 0.25, 0.18)
			elseif r < 0.75 then
				b:block("ruler", { 2.2, 2.6 }, 0.12, 0.05)
			elseif r < 0.9 then
				b:post("mug", { 0.34, 0.38 }, 0.85)
			else
				b:post("pot", { 0.24, 0.28 }, 0.6)
			end
		end,
	},
	culdesac = {
		ground = function(b, h)
			for _ = 1, n(b, 1 + h * 3) do
				b:crack("crack", 2 + b.rng:int(3), 1.1, 0.045)
			end
			for _ = 1, n(b, h * 4) do
				b:patchOf("puddle", "slick", 0.35, { 0.6, 1.05 })
			end
			for _ = 1, n(b, 2 + h * 5) do
				b:lump("stone", b.rng:range(0.1, 0.16), 0.55)
			end
			for _ = 1, n(b, h * 3) do
				b:lump("cap", 0.35, 0.93)
			end
		end,
		object = function(b)
			local r = b.rng:next()
			if r < 0.45 then
				b:block("brick", { 0.5, 0.55 }, 0.26, 0.2)
			elseif r < 0.75 then
				b:block("kerbstone", { 0.9, 1.2 }, 0.3, 0.32)
			else
				b:post("cone", { 0.22, 0.26 }, 0.8)
			end
		end,
	},
	grass = {
		ground = function(b, h)
			for _ = 1, n(b, 1 + h * 3) do
				local r = b.rng:range(0.32, 0.45)
				b:lump("molehill", r, 0.78, b:anywhere(2.6, B - 2))
			end
			for _ = 1, n(b, 1 + h * 2.5) do
				b:patchOf("mud", "sticky", 2.2, { 0.55, 0.9 })
			end
			for _ = 1, n(b, 1 + h * 4) do
				b:lying("twig", b.rng:range(0.6, 1.2), 0.045)
			end
		end,
		object = function(b)
			local r = b.rng:next()
			if r < 0.5 then
				b:post("rock", { 0.26, 0.42 }, 0.4)
			elseif r < 0.75 then
				b:block("log", { 1, 1.5 }, 0.3, 0.3)
			else
				b:post("flowerpot", { 0.28, 0.32 }, 0.5)
			end
		end,
	},
	sand = {
		ground = function(b, h)
			for _ = 1, n(b, 1 + h * 2.5) do
				b:patchOf("wetsand", "sticky", 1.8, { 0.7, 1.1 })
			end
			for _ = 1, n(b, 2 + h * 6) do
				b:lump("shell", b.rng:range(0.1, 0.15), 0.55)
			end
			for _ = 1, n(b, h * 4) do
				b:lump("pebble", b.rng:range(0.08, 0.12), 0.6)
			end
		end,
		object = function(b)
			local r = b.rng:next()
			if r < 0.4 then
				b:block("driftwood", { 1.1, 1.7 }, 0.24, 0.24)
			elseif r < 0.75 then
				b:post("rock", { 0.28, 0.45 }, 0.42)
			else
				b:post("sandcastle", { 0.4, 0.46 }, 0.55)
			end
		end,
	},
	ice = {
		ground = function(b, h)
			for _ = 1, n(b, 1 + h * 3) do
				b:crack("icecrack", 3 + b.rng:int(3), 0.8, 0.035)
			end
			for _ = 1, n(b, h * 3) do
				b:patchOf("blackice", "slick", 0.25, { 0.7, 1.2 })
			end
			for _ = 1, n(b, 1 + h * 2) do
				b:patchOf("snow", "sticky", 2.6, { 0.7, 1.2 }, function()
					return b:anywhere(R + 0.8, B - 2)
				end)
			end
			for _ = 1, n(b, h * 4) do
				b:lump("pebble", b.rng:range(0.07, 0.11), 0.62)
			end
		end,
		object = function(b)
			if b.rng:next() < 0.6 then
				b:block("iceblock", { 0.7, 1.2 }, 0.32, 0.38)
			else
				b:post("rock", { 0.24, 0.36 }, 0.36)
			end
		end,
	},
	gravel = {
		ground = function(b, h)
			for _ = 1, math.max(1, n(b, h * 2.4)) do
				local cr = b.rng:range(3, 4.4)
				local ca = b.rng:range(0, PI * 2)
				local c = b:at(cr, ca)
				for _ = 1, round(6 + h * 4) do
					local a = b.rng:range(0, PI * 2)
					local d = math.sqrt(b.rng:next()) * 0.7
					local r = b.rng:range(0.07, 0.11)
					b:lump("pebble", r, 0.64, { x = q(c.x + math.cos(a) * d), z = q(c.z + math.sin(a) * d) })
				end
			end
			for _ = 1, n(b, 12 + h * 16) do
				b:lump("pebble", b.rng:range(0.05, 0.08), 0.62)
			end
		end,
		object = function(b)
			if b.rng:next() < 0.6 then
				b:post("rock", { 0.28, 0.45 }, 0.45)
			else
				b:block("slab", { 0.7, 1.1 }, 0.28, 0.25)
			end
		end,
	},
	minigolf = {
		ground = function() end,
		object = function(b)
			if b.rng:next() < 0.6 then
				b:block("rail", { 0.9, 1.5 }, 0.16, 0.36)
			else
				b:post("railpost", { 0.14, 0.18 }, 0.5)
			end
		end,
	},
}

local function course(b, budget, count)
	for _ = 1, b:per(count(budget.cups)) do
		b:place(function()
			local p = b:inRing()
			return { kind = "hole", x = p.x, z = p.z, r = 0.3, skin = "cup" }
		end)
	end
	for _ = 1, b:per(count(budget.bumpers)) do
		local outside = b.rng:next() < 0.5
		b:place(function()
			local p = if outside then b:anywhere(R + 1.2, B - 2.2) else b:inRing()
			return { kind = "bumper", x = p.x, z = p.z, r = q(b.rng:range(0.24, 0.34)), skin = "bumper" }
		end)
	end
	for _ = 1, b:per(count(budget.pads)) do
		local p = b:inRing()
		local a = math.atan2(p.z, p.x)
		b:place(function()
			return { kind = "zone", x = p.x, z = p.z, r = 0.45, effect = "boost", a = q(a + PI / 2), skin = "pad" }
		end)
	end
end

local NAMES = {
	desk = { { "Homework", "Lamp-lit", "Messy", "Midnight", "Inkwell" }, { "Desk", "Blotter", "Study", "Drawer", "Ledger" } },
	culdesac = { { "Kerbside", "Cracked", "Drain", "Sunday", "Dead-end" }, { "Slab", "Close", "Street", "Corner", "Drive" } },
	grass = { { "Molehill", "Muddy", "Back", "Mown", "Daisy" }, { "Lawn", "Patch", "Green", "Garden", "Yard" } },
	sand = { { "Driftwood", "Low-tide", "Shell", "Sunbaked", "Dune" }, { "Beach", "Cove", "Shore", "Bay", "Spit" } },
	ice = { { "Black", "Cracked", "Thin", "Glass", "Snowbound" }, { "Ice", "Lake", "Pond", "Floe", "Rink" } },
	gravel = { { "Pebble", "Loose", "Quarry", "Crunch", "Shingle" }, { "Path", "Yard", "Drive", "Pit", "Run" } },
	minigolf = { { "Windmill", "Pirate", "Neon", "Boardwalk", "Lucky" }, { "Links", "Hole", "Course", "Green", "Putt" } },
}

export type Map = { arena: string, difficulty: string, seed: number, name: string, pieces: { any } }

--- The map for a field, difficulty and seed. Same spec, same map, here and in the web game.
function Maps.generate(arena: string, difficulty: string, seed: number): Map
	local rng = Rng.new(Forge.hashString(arena .. ":" .. difficulty .. ":" .. string.format("%d", seed)))
	local budget = BUDGET[difficulty] or BUDGET.medium
	local fold = budget.fold[rng:int(#budget.fold) + 1]
	local b = newBuilder(rng, fold)
	local function count(range)
		return range[1] + rng:int(range[2] - range[1] + 1)
	end
	FIELD[arena].ground(b, budget.hazard)
	local objects = b:per(count(budget.objects))
	for _ = 1, objects do
		FIELD[arena].object(b)
	end
	if arena == "minigolf" then
		course(b, budget, count)
	end
	local bs = BACKSTOP[arena]
	for _ = 1, b:per(count(budget.backstops)) do
		b:backstop(bs[1], bs[2], bs[3], bs[4])
	end
	local names = NAMES[arena]
	local first = names[1][rng:int(#names[1]) + 1]
	local second = names[2][rng:int(#names[2]) + 1]
	return { arena = arena, difficulty = difficulty, seed = seed, name = first .. " " .. second, pieces = b.pieces }
end

return Maps
