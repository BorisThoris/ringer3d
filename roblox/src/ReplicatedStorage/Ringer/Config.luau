--!strict
-- Everything tunable in one place: the ring's size, each field's ground, the bots, the marble
-- catalogue, the economy, and the ids of passes, products and badges made on the Creator Hub.

local Config = {}
local Forge = require(script.Parent.Forge)
local Sim = require(script.Parent.Sim)

-- ---- The ring (studs): the web game's world (Ringer.Sim, in its units) times MAP_SCALE. -----
-- Every shot is played on Ringer.Sim in web units; these are only for drawing and the camera.
local W = Sim.WORLD
Config.MAP_SCALE = 4 -- studs per web-game unit
Config.RING_R = W.ringRadius * 4 -- the chalk ring
Config.MIB_R = W.targetRadius * 4 -- target marbles
Config.SHOOTER_R = W.shooterRadius * 4 -- the taw
Config.SPACING = W.targetSpacing * 4 -- between marbles in the starting cross
Config.BOUND_R = W.boundaryRadius * 4 -- the kerb: nothing gets past it
Config.EDGE_H = 60 -- the wall above the kerb you can't see, far over the highest hop
Config.MAX_SPEED = W.maxShotSpeed * 4 -- shot speed at full power, studs/s
Config.TARGETS = Sim.TARGET_COUNT
Config.DRY_SHOTS_LIMIT = 40 -- shots in a row with no capture: the ring is called
Config.MIN_POWER = 0.03 -- a release weaker than this is not a shot
-- How much aim guide each mode shows: the web game's lengths, in web units.
Config.GUIDE = { full = 9, short = 2.2, off = 0 }

-- Each table's centre sits on a grid far apart, so matches never touch.
Config.TABLE_SPACING = 160
Config.TABLE_Y = 0

-- ---- Fields --------------------------------------------------------------------------------
export type Arena = {
	id: string,
	name: string,
	material: Enum.Material,
	color: Color3, -- the field outside the ring
	inner: Color3, -- the disc inside the ring, a shade lighter
	rollDecel: number, -- studs/s^2 of rolling resistance
	friction: number,
	elasticity: number,
	kerb: { Color3 }, -- the bumper's candy stripes
	line: Color3,
	backstop: { name: string, size: Vector3, colors: { Color3 }, material: Enum.Material },
	trees: Color3, -- the round toy trees round the field
}

-- The look follows the top-earning Roblox games (Steal a Brainrot, Pet Simulator 99, Adopt Me!,
-- Grow a Garden): flat, saturated toy colours in smooth plastic, no realistic textures. Feel
-- (friction, bounce, rolling resistance) is set by the numbers, never by the material.
local rgb = Color3.fromRGB
local TOY = { rgb(255, 75, 75), rgb(255, 205, 40), rgb(60, 150, 255), rgb(150, 90, 240) }
Config.ARENAS = {
	desk = {
		id = "desk", name = "The Desk", material = Enum.Material.SmoothPlastic, color = rgb(235, 160, 85), inner = rgb(255, 185, 105),
		rollDecel = 28, friction = 0.5, elasticity = 0.92, kerb = { rgb(255, 80, 70), rgb(255, 255, 255) }, line = rgb(255, 255, 255),
		backstop = { name = "Book", size = Vector3.new(5.2, 2, 1.5), colors = TOY, material = Enum.Material.SmoothPlastic },
		trees = rgb(120, 220, 90),
	},
	culdesac = {
		id = "culdesac", name = "The Cul-de-sac", material = Enum.Material.SmoothPlastic, color = rgb(110, 125, 175), inner = rgb(135, 155, 210),
		rollDecel = 36, friction = 0.6, elasticity = 0.86, kerb = { rgb(255, 210, 40), rgb(255, 255, 255) }, line = rgb(255, 255, 255),
		backstop = { name = "Kerbstone", size = Vector3.new(5, 1.3, 1.2), colors = TOY, material = Enum.Material.SmoothPlastic },
		trees = rgb(90, 210, 120),
	},
	grass = {
		id = "grass", name = "The Back Lawn", material = Enum.Material.SmoothPlastic, color = rgb(70, 190, 70), inner = rgb(105, 215, 85),
		rollDecel = 56, friction = 0.85, elasticity = 0.78, kerb = { rgb(255, 255, 255), rgb(255, 90, 90) }, line = rgb(255, 255, 255),
		backstop = { name = "Log", size = Vector3.new(6.4, 1.2, 1.2), colors = TOY, material = Enum.Material.SmoothPlastic },
		trees = rgb(255, 150, 200),
	},
	sand = {
		id = "sand", name = "The Beach", material = Enum.Material.SmoothPlastic, color = rgb(255, 205, 105), inner = rgb(255, 220, 130),
		rollDecel = 52, friction = 0.7, elasticity = 0.72, kerb = { rgb(255, 110, 120), rgb(255, 255, 255) }, line = rgb(255, 255, 255),
		backstop = { name = "Driftwood", size = Vector3.new(7, 1, 1), colors = TOY, material = Enum.Material.SmoothPlastic },
		trees = rgb(60, 200, 110),
	},
	ice = {
		id = "ice", name = "The Frozen Lake", material = Enum.Material.SmoothPlastic, color = rgb(95, 185, 255), inner = rgb(140, 210, 255),
		rollDecel = 22, friction = 0.12, elasticity = 0.88, kerb = { rgb(255, 255, 255), rgb(120, 170, 255) }, line = rgb(255, 255, 255),
		backstop = { name = "Ice block", size = Vector3.new(4.6, 1.6, 1.4), colors = { rgb(200, 240, 255), rgb(150, 210, 255) }, material = Enum.Material.Glass },
		trees = rgb(235, 250, 255),
	},
	gravel = {
		id = "gravel", name = "The Gravel Pit", material = Enum.Material.SmoothPlastic, color = rgb(80, 185, 170), inner = rgb(110, 210, 195),
		rollDecel = 48, friction = 0.8, elasticity = 0.8, kerb = { rgb(255, 140, 40), rgb(255, 255, 255) }, line = rgb(255, 255, 255),
		backstop = { name = "Slab", size = Vector3.new(4.8, 1, 1.2), colors = TOY, material = Enum.Material.SmoothPlastic },
		trees = rgb(255, 190, 70),
	},
	minigolf = {
		id = "minigolf", name = "The Mini-Golf Course", material = Enum.Material.SmoothPlastic, color = rgb(60, 185, 95), inner = rgb(85, 205, 115),
		rollDecel = 40, friction = 0.7, elasticity = 0.85, kerb = { rgb(255, 80, 80), rgb(255, 255, 255) }, line = rgb(255, 255, 255),
		backstop = { name = "Rail", size = Vector3.new(6, 1.4, 0.7), colors = { rgb(255, 255, 255) }, material = Enum.Material.SmoothPlastic },
		trees = rgb(255, 120, 200),
	},
} :: { [string]: Arena }
Config.ARENA_ORDER = { "desk", "culdesac", "grass", "sand", "ice", "gravel", "minigolf" }

-- ---- Bots: the web game's ladder (src/ai/profiles.ts) ------------------------------------
export type Bot = {
	id: string,
	label: string,
	aimErrorDeg: number, -- std-dev of aim error
	powerError: number, -- std-dev of power error, as a fraction
	candidates: number, -- shots imagined before choosing
	usesSpin: boolean, -- considers backspin "stick" shots
	positional: number, -- weight on leaving the taw well placed
	blunder: number, -- chance of a brain fade
	thinkMs: { number }, -- cosmetic thinking time
}
Config.BOTS = {
	rookie = { id = "rookie", label = "Rookie", aimErrorDeg = 10, powerError = 0.26, candidates = 6, usesSpin = false, positional = 0, blunder = 0.55, thinkMs = { 700, 1500 } },
	novice = { id = "novice", label = "Novice", aimErrorDeg = 6.5, powerError = 0.17, candidates = 11, usesSpin = false, positional = 0.08, blunder = 0.38, thinkMs = { 700, 1500 } },
	casual = { id = "casual", label = "Casual", aimErrorDeg = 4.2, powerError = 0.11, candidates = 18, usesSpin = false, positional = 0.2, blunder = 0.2, thinkMs = { 700, 1400 } },
	regular = { id = "regular", label = "Regular", aimErrorDeg = 3.4, powerError = 0.095, candidates = 24, usesSpin = true, positional = 0.35, blunder = 0.15, thinkMs = { 750, 1500 } },
	skilled = { id = "skilled", label = "Skilled", aimErrorDeg = 2.8, powerError = 0.08, candidates = 30, usesSpin = true, positional = 0.5, blunder = 0.1, thinkMs = { 800, 1600 } },
	expert = { id = "expert", label = "Expert", aimErrorDeg = 1.8, powerError = 0.05, candidates = 56, usesSpin = true, positional = 0.85, blunder = 0.04, thinkMs = { 900, 1700 } },
	master = { id = "master", label = "Master", aimErrorDeg = 1.75, powerError = 0.049, candidates = 64, usesSpin = true, positional = 0.95, blunder = 0.04, thinkMs = { 1000, 1900 } },
	legend = { id = "legend", label = "Legend", aimErrorDeg = 0.55, powerError = 0.016, candidates = 160, usesSpin = true, positional = 1.4, blunder = 0, thinkMs = { 1100, 2000 } },
} :: { [string]: Bot }

-- The fighters and the Tower (src/game/story.ts). You climb as a fighter: Ember, Tide, Pip and
-- Jade from the start, the others once you beat them in the Tower. The Tower is seven challengers
-- on their home fields (your own fighter skipped, the next one taking the place), one step up the
-- bot ladder each, then the Black Taw. Maps get harder as you climb and are the same course every
-- retry; the aim guide shortens, then goes; ice floors are a best of three and the Black Taw a
-- best of five. Rewards are the Roblox economy's.
Config.FIGHTERS = {
	{ id = "ember", name = "Ember", homeArena = "culdesac", starter = true },
	{ id = "tide", name = "Tide", homeArena = "sand", starter = true },
	{ id = "pip", name = "Pip", homeArena = "grass", starter = true },
	{ id = "jade", name = "Jade", homeArena = "grass", starter = true },
	{ id = "volt", name = "Volt", homeArena = "desk", starter = false },
	{ id = "rime", name = "Rime", homeArena = "ice", starter = false },
	{ id = "ironside", name = "Ironside", homeArena = "gravel", starter = false },
	{ id = "nova", name = "Nova", homeArena = "sand", starter = false },
	{ id = "obsidian", name = "Obsidian", homeArena = "ice", starter = false },
}
Config.FIGHTER = {}
for _, f in ipairs(Config.FIGHTERS) do
	Config.FIGHTER[f.id] = f
end
Config.STARTERS = { "ember", "tide", "pip", "jade" }

local LADDER_ORDER = { "pip", "tide", "jade", "volt", "ironside", "rime", "nova", "ember" }
local LADDER_BOTS = { "rookie", "novice", "casual", "regular", "skilled", "expert", "master" }
local STAGE_DIFFICULTY = { "easy", "easy", "medium", "medium", "hard", "hard", "hard", "hard" }
local STAGE_GUIDE = { "full", "full", "full", "short", "short", "short", "off", "off" }
local REWARDS = { 60, 80, 100, 130, 160, 200, 260, 500 }

--- The Tower a fighter climbs (the web game's buildTower).
function Config.buildTower(fighter: string)
	local stages = {}
	for _, id in ipairs(LADDER_ORDER) do
		if id ~= fighter and #stages < 7 then
			local i = #stages + 1
			local f = Config.FIGHTER[id]
			table.insert(stages, {
				name = f.name,
				marble = id,
				arena = f.homeArena,
				bot = LADDER_BOTS[i],
				reward = REWARDS[i],
				difficulty = STAGE_DIFFICULTY[i],
				mapSeed = Forge.hashString(string.format("tower:%s:%d", id, i - 1)) % 100000,
				guide = STAGE_GUIDE[i],
				wins = if f.homeArena == "ice" then 2 else 1,
			})
		end
	end
	table.insert(stages, {
		name = "Obsidian",
		marble = "obsidian",
		arena = "ice",
		bot = "legend",
		reward = REWARDS[8],
		boss = true,
		difficulty = "hard",
		mapSeed = Forge.hashString("tower:obsidian") % 100000,
		guide = STAGE_GUIDE[8],
		wins = 3,
	})
	return stages
end
Config.TOWER = Config.buildTower("ember")

-- ---- Marbles -------------------------------------------------------------------------------
-- How a marble looks: a glassy shell around a glowing core (a cat's eye), or a solid ball.
export type Marble = {
	id: string,
	name: string,
	rarity: string, -- Common, Rare, Epic, Legendary, Limited, Exclusive
	shell: Color3,
	core: Color3,
	material: Enum.Material,
	transparency: number,
	glow: number, -- 0 none .. 1 bright core light
	price: number?, -- coins, if sold in the shop
	supply: number?, -- Limited: how many will ever exist (serial numbered)
	source: string?, -- how else it is earned: "tower", "vip", "premium", "pass"
}

local function m(id, name, rarity, shell, core, material, transparency, glow, extra)
	local t = { id = id, name = name, rarity = rarity, shell = shell, core = core, material = material, transparency = transparency, glow = glow }
	for k, v in pairs(extra or {}) do
		t[k] = v
	end
	return t
end

Config.MARBLES = {
	m("ember", "Ember", "Common", rgb(255, 227, 207), rgb(255, 77, 31), Enum.Material.Glass, 0.35, 0.25),
	m("tide", "Tide", "Common", rgb(207, 239, 255), rgb(26, 124, 255), Enum.Material.Glass, 0.35, 0.1, { price = 150 }),
	m("pip", "Pip", "Common", rgb(201, 138, 75), rgb(122, 74, 34), Enum.Material.SmoothPlastic, 0, 0, { price = 150 }),
	m("jade", "Jade", "Common", rgb(184, 245, 210), rgb(15, 157, 88), Enum.Material.Glass, 0.3, 0.05, { price = 200 }),
	m("rime", "Rime", "Rare", rgb(242, 248, 255), rgb(159, 216, 255), Enum.Material.Glass, 0.3, 0.15, { price = 600 }),
	m("ironside", "Ironside", "Rare", rgb(201, 206, 214), rgb(138, 146, 158), Enum.Material.DiamondPlate, 0, 0, { price = 600 }),
	m("volt", "Volt", "Epic", rgb(27, 21, 48), rgb(0, 240, 255), Enum.Material.Glass, 0.25, 1, { price = 1500 }),
	m("nova", "Nova", "Epic", rgb(18, 10, 46), rgb(139, 92, 255), Enum.Material.Glass, 0.2, 0.8, { source = "tower" }),
	m("obsidian", "Obsidian", "Legendary", rgb(11, 11, 15), rgb(255, 61, 0), Enum.Material.Glass, 0.15, 1, { source = "tower" }),
	m("gold", "Golden Taw", "Exclusive", rgb(255, 200, 60), rgb(255, 240, 160), Enum.Material.Foil, 0, 0.4, { source = "vip" }),
	m("prism", "Prism", "Exclusive", rgb(240, 240, 255), rgb(255, 90, 220), Enum.Material.Glass, 0.15, 0.9, { source = "premium" }),
	m("aurora", "Aurora", "Limited", rgb(20, 40, 60), rgb(80, 255, 170), Enum.Material.Glass, 0.2, 1, { supply = 500 }),
	m("comet", "Comet", "Limited", rgb(250, 250, 255), rgb(90, 160, 255), Enum.Material.Glass, 0.25, 0.9, { supply = 1500 }),
	m("ruby", "Ruby Heart", "Legendary", rgb(150, 0, 30), rgb(255, 60, 90), Enum.Material.Glass, 0.2, 0.7, {}),
	m("moss", "Moss Agate", "Rare", rgb(80, 120, 70), rgb(200, 230, 150), Enum.Material.Glass, 0.3, 0.1, {}),
	m("sunset", "Sunset", "Epic", rgb(255, 150, 70), rgb(255, 60, 120), Enum.Material.Glass, 0.25, 0.6, {}),
} :: { Marble }

Config.MARBLE = {} :: { [string]: Marble }
for _, mm in ipairs(Config.MARBLES) do
	Config.MARBLE[mm.id] = mm
end

-- How each named marble is drawn (src/game/marbles.ts MARBLES): its interior pattern, glass and
-- colours, for MarbleArt. The web game's nine come straight from it; the Roblox-only marbles
-- (Golden Taw, Prism, the Limiteds) get the pattern that suits them.
local function art(pattern, base, accent, accent2, clarity, glow, ui)
	return { pattern = pattern, base = Color3.fromHex(base), accent = Color3.fromHex(accent), accent2 = Color3.fromHex(accent2), clarity = clarity, glow = glow, ui = Color3.fromHex(ui) }
end
Config.ART = {
	ember = art("catseye", "#ffe3cf", "#ff4d1f", "#ffb000", 0.9, 0.25, "#ff5a2a"),
	tide = art("swirl", "#cfefff", "#1a7cff", "#e9fbff", 0.85, 0.1, "#1a7cff"),
	pip = art("solid", "#c98a4b", "#7a4a22", "#e8b27a", 0, 0, "#f08a2c"),
	jade = art("swirl", "#b8f5d2", "#0f9d58", "#e0ffe9", 0.7, 0.05, "#14c06c"),
	volt = art("neon", "#1b1530", "#00f0ff", "#ff2bd6", 0.55, 1, "#00d8ff"),
	rime = art("opal", "#f2f8ff", "#9fd8ff", "#f7c6ff", 0.6, 0.15, "#7cc4ff"),
	ironside = art("steelie", "#c9ced6", "#8a929e", "#ffffff", 0, 0, "#8c9bb4"),
	nova = art("galaxy", "#120a2e", "#8b5cff", "#ffd36b", 0.4, 0.8, "#8b5cff"),
	obsidian = art("onyx", "#0b0b0f", "#ff3d00", "#ffae00", 0.15, 1, "#ff3d00"),
	gold = art("steelie", "#ffc83c", "#fff0a0", "#ffffff", 0, 0.4, "#ffc83c"),
	prism = art("opal", "#f0f0ff", "#ff5adc", "#7af0ff", 0.75, 0.9, "#ff5adc"),
	aurora = art("neon", "#14283c", "#50ffaa", "#7a6bff", 0.55, 1, "#50ffaa"),
	comet = art("clearie", "#fafaff", "#5aa0ff", "#ffffff", 0.9, 0.9, "#5aa0ff"),
	ruby = art("swirl", "#96001e", "#ff3c5a", "#ffd0d8", 0.45, 0.7, "#ff3c5a"),
	moss = art("onionskin", "#506e46", "#c8e696", "#f0f5dc", 0.5, 0.1, "#8cc864"),
	sunset = art("onionskin", "#ff9646", "#ff3c78", "#ffe08a", 0.6, 0.6, "#ff7a50"),
}

-- The 13 targets (src/game/marbles.ts MIB_LOOKS): target id t wears MIB_LOOKS[(t * 5) % 8].
local function mib(id, pattern, base, accent, accent2, clarity, glow)
	local a = art(pattern, base, accent, accent2, clarity, glow, accent)
	a.id = id
	a.name = "Mib"
	return a
end
Config.MIB_LOOKS = {
	mib("mib-a", "catseye", "#1f6fe0", "#ffe14d", "#ffffff", 0.34, 0.25),
	mib("mib-b", "catseye", "#e8401a", "#ffffff", "#ffd23f", 0.32, 0.25),
	mib("mib-c", "catseye", "#06582e", "#ffffff", "#c2ff7a", 0.3, 0.2),
	mib("mib-d", "swirl", "#7b3ff0", "#ffd23f", "#ff7ad9", 0.34, 0.25),
	mib("mib-e", "swirl", "#f0b400", "#c41f2f", "#ffffff", 0.3, 0.25),
	mib("mib-f", "catseye", "#009fb3", "#ff3d7f", "#ffffff", 0.34, 0.25),
	mib("mib-g", "swirl", "#e0215f", "#ffffff", "#ffe14d", 0.34, 0.25),
	mib("mib-h", "onionskin", "#f06a00", "#1f5fbf", "#ffffff", 0.3, 0.2),
}

Config.RARITY_COLOR = {
	Common = rgb(200, 205, 215),
	Rare = rgb(80, 160, 255),
	Epic = rgb(190, 90, 255),
	Legendary = rgb(255, 170, 30),
	Mythic = rgb(255, 70, 190),
	Limited = rgb(80, 255, 170),
	Exclusive = rgb(255, 215, 80),
}

-- ---- Marble Bags: each one mints a brand-new generated marble (Ringer.Forge), exactly as in
-- the web game. The odds shown before buying are the generator's own tier odds.
Config.BAG_PRICE = 300
Config.BAG_ODDS = {}
for _, r in ipairs(Forge.RARITY) do
	table.insert(Config.BAG_ODDS, { rarity = r.tier, weight = r.odds })
end
Config.MAX_COLLECTION = 500
-- Melting a generated marble pays this by tier, times 2 for Mint (1.25 Polished), 5 for a
-- Shiny and 4 for a phenomenon: the web game's meltValue.
Config.MELT = { Common = 40, Rare = 120, Epic = 300, Legendary = 800, Mythic = 2500 }
-- Finishing these Marble Book sets also mints a serial-numbered Limited.
Config.BOOK_LIMITED = { phenomena = "aurora", tiers = "comet" }
-- A named marble you already own is worth this back in coins.
Config.DUPLICATE_COINS = { Common = 40, Rare = 120, Epic = 300, Legendary = 800, Limited = 0, Exclusive = 0 }

-- ---- Economy ----------------------------------------------------------------------------
Config.COINS = {
	capture = 4,
	win = 40,
	loss = 10,
	pvpWinBonus = 30,
	daily = { 50, 60, 75, 90, 110, 130, 200 }, -- streak days 1..7, then 200 a day
}
Config.VIP_MULTIPLIER = 2
Config.PREMIUM_MULTIPLIER = 1.25

-- ---- Ids made on the Creator Hub (0 = not made yet: the feature hides itself) ------------
-- The build generates the Ids module from roblox/store/ids.json.
local ids = { passes = {}, products = {}, badges = {} }
local idsModule = script.Parent:FindFirstChild("Ids")
if idsModule then
	ids = require(idsModule) :: any
end
local function idOf(group, name)
	return ids[group][name] or 0
end
Config.PASSES = {
	vip = idOf("passes", "vip"), -- 2x coins, the Golden Taw, a VIP chat tag
	trails = idOf("passes", "trails"), -- a glowing trail on every shot
}
Config.PRODUCTS = {
	coins500 = idOf("products", "coins500"),
	coins1500 = idOf("products", "coins1500"),
	coins5000 = idOf("products", "coins5000"),
	bag = idOf("products", "bag"), -- open one Marble Bag now
}
Config.PRODUCT_COINS = { coins500 = 500, coins1500 = 1500, coins5000 = 5000 }
Config.BADGES = {
	welcome = idOf("badges", "welcome"),
	firstWin = idOf("badges", "firstWin"),
	towerTop = idOf("badges", "towerTop"),
	limited = idOf("badges", "limited"),
	sweep = idOf("badges", "sweep"), -- capture all 13 in one game
}

return Config
