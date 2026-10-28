--!strict
-- Everything tunable in one place: the ring's size, each field's ground, the bots, the marble
-- catalogue, the economy, and the ids of passes, products and badges made on the Creator Hub.

local Config = {}

-- ---- The ring (studs). The web game's units times 4. ---------------------------------------
Config.RING_R = 22 -- the chalk ring
Config.MIB_R = 0.7 -- target marbles
Config.SHOOTER_R = 0.95 -- the taw
Config.SPACING = 2.2 -- between marbles in the starting cross
Config.BOUND_R = 50 -- the kerb: nothing gets past it
Config.EDGE_H = 60 -- the wall above the kerb you can't see, far over the highest hop
Config.MAX_SPEED = 105 -- shot speed at full power, studs/s
Config.REST_SPEED = 0.5 -- a marble slower than this is at rest
Config.REST_TIME = 0.35 -- everything at rest this long ends the shot
Config.SHOT_CAP = 14 -- seconds: a shot never runs longer than this
Config.TURN_TIME = 30 -- seconds a player has to shoot
Config.TARGETS = 13
Config.DRY_SHOTS_LIMIT = 40 -- shots in a row with no capture: the ring is called

-- Each table's centre sits on a grid far apart, so matches never touch.
Config.TABLE_SPACING = 160
Config.TABLE_Y = 0

-- ---- Fields --------------------------------------------------------------------------------
export type Arena = {
	id: string,
	name: string,
	material: Enum.Material,
	color: Color3,
	rollDecel: number, -- studs/s^2 of rolling resistance
	friction: number,
	elasticity: number,
	kerb: Color3,
	line: Color3,
	backstop: { name: string, size: Vector3, color: Color3, material: Enum.Material },
}

Config.ARENAS = {
	desk = {
		id = "desk", name = "The Desk", material = Enum.Material.WoodPlanks, color = Color3.fromRGB(122, 82, 52),
		rollDecel = 28, friction = 0.5, elasticity = 0.92, kerb = Color3.fromRGB(70, 44, 28), line = Color3.fromRGB(240, 234, 220),
		backstop = { name = "Book", size = Vector3.new(5.2, 2, 1.5), color = Color3.fromRGB(40, 110, 70), material = Enum.Material.SmoothPlastic },
	},
	culdesac = {
		id = "culdesac", name = "The Cul-de-sac", material = Enum.Material.Concrete, color = Color3.fromRGB(150, 146, 138),
		rollDecel = 36, friction = 0.6, elasticity = 0.86, kerb = Color3.fromRGB(110, 108, 104), line = Color3.fromRGB(255, 255, 255),
		backstop = { name = "Kerbstone", size = Vector3.new(5, 1.3, 1.2), color = Color3.fromRGB(170, 168, 160), material = Enum.Material.Slate },
	},
	grass = {
		id = "grass", name = "The Back Lawn", material = Enum.Material.Grass, color = Color3.fromRGB(80, 160, 60),
		rollDecel = 56, friction = 0.85, elasticity = 0.78, kerb = Color3.fromRGB(50, 110, 40), line = Color3.fromRGB(235, 235, 225),
		backstop = { name = "Log", size = Vector3.new(6.4, 1.2, 1.2), color = Color3.fromRGB(105, 70, 40), material = Enum.Material.Wood },
	},
	sand = {
		id = "sand", name = "The Beach", material = Enum.Material.Sand, color = Color3.fromRGB(222, 190, 130),
		rollDecel = 52, friction = 0.7, elasticity = 0.72, kerb = Color3.fromRGB(190, 160, 110), line = Color3.fromRGB(120, 90, 60),
		backstop = { name = "Driftwood", size = Vector3.new(7, 1, 1), color = Color3.fromRGB(190, 180, 160), material = Enum.Material.Wood },
	},
	ice = {
		id = "ice", name = "The Frozen Lake", material = Enum.Material.Ice, color = Color3.fromRGB(70, 120, 160),
		rollDecel = 22, friction = 0.12, elasticity = 0.88, kerb = Color3.fromRGB(220, 235, 245), line = Color3.fromRGB(235, 245, 255),
		backstop = { name = "Ice block", size = Vector3.new(4.6, 1.6, 1.4), color = Color3.fromRGB(190, 225, 245), material = Enum.Material.Glacier },
	},
	gravel = {
		id = "gravel", name = "The Gravel Pit", material = Enum.Material.Pebble, color = Color3.fromRGB(140, 130, 118),
		rollDecel = 48, friction = 0.8, elasticity = 0.8, kerb = Color3.fromRGB(100, 94, 86), line = Color3.fromRGB(245, 240, 230),
		backstop = { name = "Slab", size = Vector3.new(4.8, 1, 1.2), color = Color3.fromRGB(120, 116, 110), material = Enum.Material.Slate },
	},
} :: { [string]: Arena }
Config.ARENA_ORDER = { "desk", "culdesac", "grass", "sand", "ice", "gravel" }

-- ---- Bots: the web game's ladder ---------------------------------------------------------
export type Bot = { id: string, label: string, aimErrorDeg: number, powerError: number, blunder: number, careful: boolean }
Config.BOTS = {
	rookie = { id = "rookie", label = "Rookie", aimErrorDeg = 10, powerError = 0.26, blunder = 0.55, careful = false },
	novice = { id = "novice", label = "Novice", aimErrorDeg = 6.5, powerError = 0.17, blunder = 0.38, careful = false },
	casual = { id = "casual", label = "Casual", aimErrorDeg = 4.2, powerError = 0.11, blunder = 0.2, careful = false },
	regular = { id = "regular", label = "Regular", aimErrorDeg = 3.4, powerError = 0.095, blunder = 0.15, careful = true },
	skilled = { id = "skilled", label = "Skilled", aimErrorDeg = 2.8, powerError = 0.08, blunder = 0.1, careful = true },
	expert = { id = "expert", label = "Expert", aimErrorDeg = 1.8, powerError = 0.05, blunder = 0.04, careful = true },
	master = { id = "master", label = "Master", aimErrorDeg = 1.75, powerError = 0.049, blunder = 0.04, careful = true },
	legend = { id = "legend", label = "Legend", aimErrorDeg = 0.55, powerError = 0.016, blunder = 0, careful = true },
} :: { [string]: Bot }

-- The Tower: eight floors, one step up the ladder each, the Black Taw on top.
Config.TOWER = {
	{ name = "Pip", marble = "pip", arena = "grass", bot = "rookie", reward = 60 },
	{ name = "Tide", marble = "tide", arena = "sand", bot = "novice", reward = 80 },
	{ name = "Jade", marble = "jade", arena = "grass", bot = "casual", reward = 100 },
	{ name = "Volt", marble = "volt", arena = "desk", bot = "regular", reward = 130 },
	{ name = "Ironside", marble = "ironside", arena = "gravel", bot = "skilled", reward = 160 },
	{ name = "Rime", marble = "rime", arena = "ice", bot = "expert", reward = 200 },
	{ name = "Nova", marble = "nova", arena = "sand", bot = "master", reward = 260 },
	{ name = "Obsidian", marble = "obsidian", arena = "ice", bot = "legend", reward = 500, boss = true },
}

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

local rgb = Color3.fromRGB
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
	-- Halloween 2026: a numbered pumpkin marble, only in Marble Bags while the event lasts.
	m("pumpkin", "Jack-o'-Marble", "Limited", rgb(255, 120, 20), rgb(255, 230, 90), Enum.Material.Glass, 0.2, 1, { supply = 1000, event = "halloween" }),
	m("ruby", "Ruby Heart", "Legendary", rgb(150, 0, 30), rgb(255, 60, 90), Enum.Material.Glass, 0.2, 0.7, {}),
	m("moss", "Moss Agate", "Rare", rgb(80, 120, 70), rgb(200, 230, 150), Enum.Material.Glass, 0.3, 0.1, {}),
	m("sunset", "Sunset", "Epic", rgb(255, 150, 70), rgb(255, 60, 120), Enum.Material.Glass, 0.25, 0.6, {}),
} :: { Marble }

Config.MARBLE = {} :: { [string]: Marble }
for _, mm in ipairs(Config.MARBLES) do
	Config.MARBLE[mm.id] = mm
end

-- The colours of the thirteen marbles in the ring.
Config.MIB_COLORS = {
	{ rgb(31, 111, 224), rgb(255, 225, 77) },
	{ rgb(232, 64, 26), rgb(255, 255, 255) },
	{ rgb(6, 88, 46), rgb(194, 255, 122) },
	{ rgb(123, 63, 240), rgb(255, 210, 63) },
	{ rgb(240, 180, 0), rgb(196, 31, 47) },
	{ rgb(0, 159, 179), rgb(255, 61, 127) },
	{ rgb(224, 33, 95), rgb(255, 225, 77) },
	{ rgb(240, 106, 0), rgb(31, 95, 191) },
}

Config.RARITY_COLOR = {
	Common = rgb(200, 205, 215),
	Rare = rgb(80, 160, 255),
	Epic = rgb(190, 90, 255),
	Legendary = rgb(255, 170, 30),
	Limited = rgb(80, 255, 170),
	Exclusive = rgb(255, 215, 80),
}

-- ---- Marble Bag: what a bag can hold, and the odds, shown to the player before they buy --
Config.BAG_PRICE = 300
Config.BAG_ODDS = {
	{ rarity = "Common", weight = 60, pool = { "tide", "pip", "jade" } },
	{ rarity = "Rare", weight = 27, pool = { "rime", "ironside", "moss" } },
	{ rarity = "Epic", weight = 9, pool = { "volt", "sunset" } },
	{ rarity = "Legendary", weight = 3, pool = { "ruby" } },
	{ rarity = "Limited", weight = 1, pool = { "aurora", "comet", "pumpkin" } },
}
-- A duplicate is worth this share of its rarity's value back in coins.
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
