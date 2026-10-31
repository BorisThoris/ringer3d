-- Marble Forge in Luau: the web game's marble generator (packages/marble-forge/src/rng.ts,
-- generate.ts, collectible.ts), line for line. A seed is the whole marble and an instance id
-- (uid) is the whole collectible, so the same id gives the same marble here and in the web game.
-- tests/forge.luau checks this file against fixtures written by the TypeScript generator.
--
-- JS does its integer tricks in signed 32 bits; here every value stays an unsigned 32-bit
-- number held in a double. Sums wrap with % 2^32 and products go through imul (16-bit halves,
-- so nothing passes 2^53). bit32 works on the same unsigned range, so the bits match.

local Forge = {}

local U32 = 4294967296

local function imul(a: number, b: number): number
	local bh = math.floor(b / 65536)
	local bl = b % 65536
	return (a * bl + ((a * bh) % 65536) * 65536) % U32
end

local function add(a: number, b: number): number
	return (a + b) % U32
end

-- ---- Rng (mulberry32) ----------------------------------------------------------------------
export type Rng = { state: number }

local Rng = {}
Rng.__index = Rng

function Rng.new(seed: number)
	local s = seed % U32
	if s == 0 then
		s = 0x9e3779b9
	end
	return setmetatable({ state = s }, Rng)
end

function Rng:next(): number
	self.state = add(self.state, 0x6d2b79f5)
	local t = self.state
	t = imul(bit32.bxor(t, bit32.rshift(t, 15)), bit32.bor(t, 1))
	t = bit32.bxor(t, add(t, imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))))
	return bit32.bxor(t, bit32.rshift(t, 14)) / U32
end

function Rng:range(min: number, max: number): number
	return min + (max - min) * self:next()
end

function Rng:int(maxExclusive: number): number
	return math.floor(self:next() * maxExclusive)
end

Forge.Rng = Rng

function Forge.hashString(s: string): number
	local h = 2166136261
	for i = 1, #s do
		h = bit32.bxor(h, string.byte(s, i))
		h = imul(h, 16777619)
	end
	return h
end
local hashString = Forge.hashString

-- ---- Tables (generate.ts) ------------------------------------------------------------------
Forge.EFFECTS = {
	aurora = { title = "Aurora", desc = "Northern lights drift through the glass.", hue = { 0.3, 0.5 } },
	inferno = { title = "Inferno", desc = "A fire that never goes out.", hue = { 0.0, 0.08 } },
	void = { title = "Void", desc = "A black hole wrapped in its own burning disc.", hue = { 0.72, 0.85 } },
	storm = { title = "Storm", desc = "A thundercloud, and lightning inside it.", hue = { 0.52, 0.62 } },
	geode = { title = "Geode", desc = "Crystals grow inward from the shell.", hue = { 0, 1 } },
	starfall = { title = "Starfall", desc = "Stars orbit a tiny nebula.", hue = { 0.55, 0.95 } },
}
Forge.EFFECT_IDS = { "aurora", "inferno", "void", "storm", "geode", "starfall" }
Forge.EFFECT_ODDS = { Common = 0, Rare = 1.5, Epic = 5, Legendary = 15, Mythic = 40 }

Forge.RARITY = {
	{ tier = "Common", odds = 55, patterns = { "solid", "swirl", "catseye", "clearie" }, finishes = { "glass", "frosted" }, glow = { 0, 0.15 }, sparkle = { 0, 0 }, schemes = { "mono", "analogous", "complement" } },
	{ tier = "Rare", odds = 28, patterns = { "swirl", "catseye", "onionskin", "opal", "steelie", "clearie" }, finishes = { "glass", "frosted", "pearl", "metallic" }, glow = { 0.05, 0.3 }, sparkle = { 0, 0.2 }, schemes = { "analogous", "complement", "split" } },
	{ tier = "Epic", odds = 12, patterns = { "swirl", "catseye", "onionskin", "opal", "neon", "galaxy" }, finishes = { "glass", "pearl", "metallic", "glitter" }, glow = { 0.3, 0.7 }, sparkle = { 0.2, 0.5 }, schemes = { "complement", "split", "triad" } },
	{ tier = "Legendary", odds = 4.5, patterns = { "galaxy", "neon", "onyx", "opal", "onionskin" }, finishes = { "glass", "glitter", "holo" }, glow = { 0.6, 1 }, sparkle = { 0.4, 0.8 }, schemes = { "split", "triad", "rainbow" } },
	{ tier = "Mythic", odds = 0.5, patterns = { "galaxy", "neon", "onyx" }, finishes = { "holo", "prism" }, glow = { 1, 1 }, sparkle = { 0.8, 1 }, schemes = { "rainbow", "triad" } },
}
Forge.TIERS = { "Common", "Rare", "Epic", "Legendary", "Mythic" }

local HUE_NAMES = { "red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "purple", "pink" }
local WORDS = {
	hue = {
		red = { "Ruby", "Cherry", "Crimson", "Berry", "Scarlet", "Poppy", "Garnet", "Ember" },
		orange = { "Peach", "Tangerine", "Amber", "Papaya", "Apricot", "Marigold", "Mango", "Copper" },
		yellow = { "Lemon", "Sunny", "Golden", "Honey", "Banana", "Butter", "Saffron", "Daisy" },
		lime = { "Lime", "Mint", "Pistachio", "Kiwi", "Sage", "Sprout", "Avocado", "Melon" },
		green = { "Emerald", "Jade", "Fern", "Forest", "Moss", "Clover", "Leafy", "Cactus" },
		teal = { "Teal", "Lagoon", "Seafoam", "Peacock", "Turquoise", "Marine", "Reef", "Tidal" },
		cyan = { "Cyan", "Icy", "Glacier", "Frosty", "Arctic", "Aqua", "Splash", "Breeze" },
		blue = { "Azure", "Sapphire", "Ocean", "Sky", "Cobalt", "Navy", "Denim", "Bluebell" },
		indigo = { "Indigo", "Twilight", "Starry", "Midnight", "Dusk", "Velvet", "Moonlit", "Deepsea" },
		purple = { "Amethyst", "Lavender", "Orchid", "Plum", "Grape", "Lilac", "Violet", "Mauve" },
		pink = { "Pink", "Fuchsia", "Magenta", "Rosy", "Flamingo", "Bubblegum", "Candy", "Blossom" },
	},
	pattern = {
		catseye = { "Eye", "Glint", "Gleam", "Glimmer", "Wink", "Flash" },
		swirl = { "Whirl", "Eddy", "Swirl", "Twist", "Spiral", "Curl" },
		solid = { "Pebble", "Drop", "Bead", "Gumdrop", "Button", "Pip" },
		galaxy = { "Nebula", "Comet", "Star", "Cosmos", "Orbit", "Quasar" },
		steelie = { "Steelie", "Chrome", "Bearing", "Alloy", "Mirror", "Rivet" },
		onyx = { "Onyx", "Magma", "Ember", "Obsidian", "Lava", "Basalt" },
		opal = { "Opal", "Pearl", "Luster", "Sheen", "Moonstone", "Shimmer" },
		neon = { "Neon", "Laser", "Volt", "Pulse", "Glowstick", "Spark" },
		onionskin = { "Onion", "Ribbon", "Layer", "Petal", "Streamer", "Banner" },
		clearie = { "Clearie", "Bubble", "Crystal", "Lens", "Droplet", "Dew" },
	},
	finish = {
		glass = {},
		frosted = {},
		pearl = {},
		metallic = {},
		glitter = { "Glitter", "Sparkle", "Twinkle", "Starlit" },
		holo = { "Holo", "Shimmer", "Aurora", "Radiant" },
		prism = { "Prism", "Rainbow", "Spectral", "Celestial" },
	},
}

-- JS Math.round is floor(x + 0.5), for negatives too.
local function round(v: number): number
	return math.floor(v + 0.5)
end
local function r3(v: number): number
	return round(v * 1000) / 1000
end
local function pick<T>(rng, xs: { T }): T
	return xs[rng:int(#xs) + 1]
end

--- HSL (h in turns, s and l 0..1) to "#rrggbb".
function Forge.hsl(h: number, s: number, l: number): string
	h = h - math.floor(h)
	local c = (1 - math.abs(2 * l - 1)) * s
	local h6 = h * 6
	local x = c * (1 - math.abs(h6 - 2 * math.floor(h6 / 2) - 1))
	local m = l - c / 2
	local seg = math.floor(h * 6)
	local r, g, b
	if seg == 0 then
		r, g, b = c, x, 0
	elseif seg == 1 then
		r, g, b = x, c, 0
	elseif seg == 2 then
		r, g, b = 0, c, x
	elseif seg == 3 then
		r, g, b = 0, x, c
	elseif seg == 4 then
		r, g, b = x, 0, c
	else
		r, g, b = c, 0, x
	end
	local function hex(v: number): string
		return string.format("%02x", round((v + m) * 255))
	end
	return "#" .. hex(r) .. hex(g) .. hex(b)
end
local hsl = Forge.hsl

local function schemeHues(scheme: string, rng): (number, number)
	if scheme == "mono" then
		return 0, rng:range(-0.03, 0.03)
	elseif scheme == "analogous" then
		local a = rng:range(0.06, 0.1)
		return a, -rng:range(0.06, 0.1)
	elseif scheme == "complement" then
		return 0.5, rng:range(0.04, 0.08)
	elseif scheme == "split" then
		return 0.42, 0.58
	elseif scheme == "triad" then
		return 1 / 3, 2 / 3
	end
	local a = rng:range(0.28, 0.38)
	return a, rng:range(0.6, 0.72)
end

--- The tier a roll of t (0..100) lands in.
function Forge.tierFor(t: number): string
	local acc = 0
	for _, r in ipairs(Forge.RARITY) do
		acc += r.odds
		if t < acc then
			return r.tier
		end
	end
	return "Common"
end

local function rule(tier: string)
	for _, r in ipairs(Forge.RARITY) do
		if r.tier == tier then
			return r
		end
	end
	error("no tier " .. tier)
end

--- Chance (percent) that a Marble Bag holds a phenomenon.
function Forge.phenomenonOdds(): number
	local a = 0
	for _, r in ipairs(Forge.RARITY) do
		local seeThrough = 0
		for _, p in ipairs(r.patterns) do
			if p ~= "solid" and p ~= "steelie" then
				seeThrough += 1
			end
		end
		a += r.odds * Forge.EFFECT_ODDS[r.tier] * seeThrough / #r.patterns / 100
	end
	return a
end

export type Marble = {
	seed: number,
	id: string,
	name: string,
	tier: string,
	pattern: string,
	finish: string,
	scheme: string,
	base: string,
	accent: string,
	accent2: string,
	clarity: number,
	glow: number,
	sparkle: number,
	ui: string,
	effect: string,
	effectColor: string,
	shape: { blades: number, turns: number, width: number, tilt: number, bubbles: number },
}

--- The marble for a seed; `tier` forces the tier.
function Forge.generate(seed: number, tier: string?): Marble
	seed = seed % U32
	local rng = Rng.new(hashString("marble:" .. string.format("%d", seed)))
	local roll = rng:next() * 100
	local t = tier or Forge.tierFor(roll)
	local rl = rule(t)
	local pattern = pick(rng, rl.patterns)
	local finish = pick(rng, rl.finishes)
	local scheme = pick(rng, rl.schemes)

	local hue = rng:next()
	local o1, o2 = schemeHues(scheme, rng)
	local dark = pattern == "galaxy" or pattern == "neon" or pattern == "onyx"
	local opaque = pattern == "solid" or pattern == "steelie"
	local baseS = if pattern == "steelie" then rng:range(0.05, 0.25) elseif dark then rng:range(0.55, 0.85) else rng:range(0.55, 0.95)
	local baseL = if pattern == "steelie" then rng:range(0.62, 0.8) elseif dark then rng:range(0.07, 0.16) elseif opaque then rng:range(0.45, 0.62) else rng:range(0.72, 0.9)
	local base = hsl(hue, baseS, baseL)
	local accentS = rng:range(0.8, 1)
	local accent = hsl(hue + o1, accentS, rng:range(0.48, 0.6))
	local a2s = rng:range(0.7, 1)
	local accent2 = hsl(hue + o2, a2s, if dark then rng:range(0.6, 0.78) else rng:range(0.55, 0.85))
	local clarity = if opaque then 0 elseif dark then rng:range(0.15, 0.45) elseif pattern == "clearie" then rng:range(0.85, 0.95) else rng:range(0.55, 0.9)
	local glow = rng:range(rl.glow[1], rl.glow[2])
	local sparkle = if finish == "glitter" then math.max(0.5, rng:range(rl.sparkle[1], rl.sparkle[2])) else rng:range(rl.sparkle[1], rl.sparkle[2])

	local h1 = hue + o1 - math.floor(hue + o1)
	local hueName = HUE_NAMES[(math.floor(h1 * #HUE_NAMES) % #HUE_NAMES) + 1]
	local words = { pick(rng, WORDS.hue[hueName]), pick(rng, WORDS.pattern[pattern]) }
	local fw = WORDS.finish[finish]
	if #fw > 0 then
		table.insert(words, 1, pick(rng, fw))
	end

	local shape = {
		blades = 3 + rng:int(3),
		turns = r3(rng:range(0.6, 1.4)),
		width = r3(rng:range(0.7, 1.3)),
		tilt = r3(rng:range(-0.4, 0.4)),
		bubbles = 1 + rng:int(6),
	}
	local fxRoll = rng:next() * 100
	local fxPick = pick(rng, Forge.EFFECT_IDS)
	local fxHue = rng:next()
	local fxLight = rng:range(0.55, 0.68)
	local effect = if fxRoll < Forge.EFFECT_ODDS[t] and not opaque then fxPick else "none"
	local range = Forge.EFFECTS[fxPick].hue
	local effectColor = hsl(range[1] + (range[2] - range[1]) * fxHue, 1, fxLight)
	if effect ~= "none" then
		local title = Forge.EFFECTS[effect].title
		local kept = { title }
		for _, w in ipairs(words) do
			if w ~= title then
				table.insert(kept, w)
			end
		end
		words = kept
	end
	return {
		seed = seed,
		id = "g" .. string.format("%d", seed),
		name = table.concat(words, " "),
		tier = t,
		pattern = pattern,
		finish = finish,
		scheme = scheme,
		base = base,
		accent = accent,
		accent2 = accent2,
		clarity = r3(clarity),
		glow = r3(glow),
		sparkle = r3(sparkle),
		ui = accent,
		effect = effect,
		effectColor = effectColor,
		shape = shape,
	}
end

-- ---- Collectibles (collectible.ts) ---------------------------------------------------------
local LETTER = { Common = "C", Rare = "R", Epic = "E", Legendary = "L", Mythic = "M" }
local BY_LETTER = { C = "Common", R = "Rare", E = "Epic", L = "Legendary", M = "Mythic" }

Forge.WEARS = {
	{ name = "Mint", short = "MT", min = 0, max = 0.07, weight = 3 },
	{ name = "Polished", short = "PL", min = 0.07, max = 0.15, weight = 24 },
	{ name = "Played", short = "PY", min = 0.15, max = 0.38, weight = 33 },
	{ name = "Scuffed", short = "SC", min = 0.38, max = 0.45, weight = 24 },
	{ name = "Chipped", short = "CH", min = 0.45, max = 1, weight = 16 },
}
Forge.SHINY_ODDS = 50
Forge.TRADE_UP_COUNT = 5

export type Collectible = {
	id: string,
	uid: string,
	tier: string,
	float: number,
	wear: string,
	pattern: number,
	shiny: boolean,
	effect: string,
	traits: { string },
	marble: Marble,
}

function Forge.collectibleId(tier: string, uid: string): string
	return "c" .. LETTER[tier] .. "-" .. uid
end

function Forge.wearFor(float: number): string
	for _, w in ipairs(Forge.WEARS) do
		if float < w.max then
			return w.name
		end
	end
	return Forge.WEARS[#Forge.WEARS].name
end

local function legacyUid(uid: string): boolean
	return string.match(uid, "^g%d+$") ~= nil
end

--- The marble an instance id stands for. The same uid always gives the same marble.
function Forge.mint(uid: string, tier: string?): Collectible
	local legacy = legacyUid(uid)
	local seed = if legacy then tonumber(string.sub(uid, 2)) :: number else hashString("look:" .. uid)
	local base = Forge.generate(seed, tier)
	local t = base.tier
	local rng = Rng.new(hashString("collectible:" .. uid))

	local total = 0
	for _, w in ipairs(Forge.WEARS) do
		total += w.weight
	end
	local roll = rng:next() * total
	local band = Forge.WEARS[#Forge.WEARS]
	for _, w in ipairs(Forge.WEARS) do
		roll -= w.weight
		if roll < 0 then
			band = w
			break
		end
	end
	local float = round((band.min + rng:next() * (band.max - band.min)) * 1e6) / 1e6
	local pattern = rng:int(1000)
	local shiny = rng:int(Forge.SHINY_ODDS) == 0

	local traits = {}
	if base.effect ~= "none" then
		table.insert(traits, Forge.EFFECTS[base.effect].title)
	end
	if shiny then
		table.insert(traits, "Shiny")
	end
	if float < 0.01 then
		table.insert(traits, "Pristine")
	end
	if float > 0.99 then
		table.insert(traits, "Rock bottom")
	end
	if pattern == 7 or pattern == 77 or pattern == 777 then
		table.insert(traits, "Lucky 7s")
	end
	if pattern == 0 then
		table.insert(traits, "Pattern zero")
	end
	if pattern == 999 then
		table.insert(traits, "Last pattern")
	end

	local id = if legacy then uid else Forge.collectibleId(t, uid)
	local marble = table.clone(base) :: Marble
	marble.id = id
	if shiny then
		marble.name = "Shiny " .. base.name
		marble.sparkle = math.max(marble.sparkle, 0.7)
		if marble.finish == "glass" or marble.finish == "frosted" then
			marble.finish = "holo"
		end
	end
	return { id = id, uid = uid, tier = t, float = float, wear = Forge.wearFor(float), pattern = pattern, shiny = shiny, effect = base.effect, traits = traits, marble = marble }
end

--- A collectible from its marble id ("cR-<uid>" or "g<seed>"), or nil for named marbles.
function Forge.fromId(id: string): Collectible?
	if legacyUid(id) then
		return Forge.mint(id)
	end
	local letter, uid = string.match(id, "^c([CRELM])%-([%w]+)$")
	if letter and uid and #uid <= 40 then
		return Forge.mint(uid, BY_LETTER[letter])
	end
	return nil
end

function Forge.isCollectibleId(id: string): boolean
	return legacyUid(id) or string.match(id, "^c[CRELM]%-[%w]+$") ~= nil
end

--- A fresh uid for a marble minted on Roblox: "R" + 16 hex digits.
function Forge.robloxUid(rng: Random): string
	return string.format("R%08x%08x", rng:NextInteger(0, U32 - 1), rng:NextInteger(0, U32 - 1))
end

function Forge.nextTier(t: string): string?
	local i = table.find(Forge.TIERS, t)
	if i and i < #Forge.TIERS then
		return Forge.TIERS[i + 1]
	end
	return nil
end

-- ---- The Marble Book -----------------------------------------------------------------------
local function unique(list: { { string } }): { string }
	local out, seen = {}, {}
	for _, xs in ipairs(list) do
		for _, x in ipairs(xs) do
			if not seen[x] then
				seen[x] = true
				table.insert(out, x)
			end
		end
	end
	return out
end
local patternLists, finishLists = {}, {}
for _, r in ipairs(Forge.RARITY) do
	table.insert(patternLists, r.patterns)
	table.insert(finishLists, r.finishes)
end
local wearNames = {}
for _, w in ipairs(Forge.WEARS) do
	table.insert(wearNames, w.name)
end
local effectTitles = {}
for _, e in ipairs(Forge.EFFECT_IDS) do
	table.insert(effectTitles, Forge.EFFECTS[e].title)
end

Forge.BOOK = {
	{ id = "patterns", name = "Every pattern", needs = unique(patternLists), reward = 1500, have = function(c) return c.marble.pattern end },
	{ id = "finishes", name = "Every finish", needs = unique(finishLists), reward = 1200, have = function(c) return c.marble.finish end },
	{ id = "tiers", name = "Every rarity", needs = Forge.TIERS, reward = 2500, have = function(c) return c.tier end },
	{ id = "wears", name = "Every wear", needs = wearNames, reward = 800, have = function(c) return c.wear end },
	{ id = "shiny", name = "A Shiny", needs = { "Shiny" }, reward = 1000, have = function(c) return if c.shiny then "Shiny" else nil end },
	{ id = "phenomena", name = "Every phenomenon", needs = effectTitles, reward = 6000, have = function(c) return if c.effect ~= "none" then Forge.EFFECTS[c.effect].title else nil end },
}

--- How far along each set is: { set, got = { names }, done }.
function Forge.bookProgress(owned: { Collectible })
	local out = {}
	for _, set in ipairs(Forge.BOOK) do
		local got = {}
		for _, need in ipairs(set.needs) do
			for _, c in ipairs(owned) do
				if set.have(c) == need then
					table.insert(got, need)
					break
				end
			end
		end
		table.insert(out, { set = set, got = got, done = #got == #set.needs })
	end
	return out
end

--- "#rrggbb" to Color3.
function Forge.color(hex: string): Color3
	return Color3.fromHex(hex)
end

return Forge
