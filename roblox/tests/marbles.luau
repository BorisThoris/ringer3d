-- Cloud test of how marbles are drawn (MarbleArt, MarbleLook): the web game's random streams, the
-- target looks, and an interior for every pattern. Reference numbers come from the TypeScript
-- (marble.ts rng, flaws.ts surfaceFlaws), printed by node/tsx on 2026-11-12.
-- node roblox/scripts/run-luau.mjs roblox/tests/marbles.luau <version>
local out = {}
local function check(name, ok, detail)
	table.insert(out, (ok and "PASS " or "FAIL ") .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
end

local Ringer = game.ReplicatedStorage.Ringer
local MarbleArt = require(Ringer.MarbleArt)
local MarbleLook = require(Ringer.MarbleLook)
local Config = require(Ringer.Config)
local Forge = require(Ringer.Forge)

-- marble.ts rng(): xorshift32.
for _, f in ipairs({
	{ 1.87, { 0.552389990, 0.707938267, 0.721066129 } },
	{ 3.7 + 5 * 0.37, { 0.762881359, 0.912192258, 0.807887584 } },
	{ 12345, { 0.800407602, 0.674246921, 0.598971953 } },
}) do
	local r = MarbleArt.xrng(f[1])
	local got = { r(), r(), r() }
	local ok = true
	for i = 1, 3 do
		ok = ok and math.abs(got[i] - f[2][i]) < 1e-8
	end
	check("xorshift matches marble.ts for seed " .. f[1], ok, string.format("%.9f %.9f %.9f", got[1], got[2], got[3]))
end

-- flaws.ts: seed bubbles inside the glass.
for _, f in ipairs({ { "ember", 11 }, { "mib-a", 0 }, { "mib-d", 6 }, { "tide", 8 }, { "nova", 0 }, { "abc", 9 } }) do
	local fl = MarbleArt.flaws(f[1])
	check("seed bubbles of " .. f[1], fl.seeds == f[2] and fl.stone == false, fl.seeds)
end

-- Targets wear MIB_LOOKS[(id * 5) % 8], as GameView.bindMatch.
local order = {}
for id = 1, 13 do
	table.insert(order, string.sub(MarbleLook.mib(id).id, 5))
end
check("targets wear the web's looks in the web's order", table.concat(order) == "fchebgdafcheb", table.concat(order))

-- Every pattern builds an interior (glass ones) or none (clay, steel).
local function count(ball)
	local n = 0
	local interior = ball:FindFirstChild("Interior")
	if interior then
		n = #interior:GetChildren()
	end
	return n
end
local want = { catseye = { 3, 60 }, swirl = { 40, 120 }, onionskin = { 80, 150 }, galaxy = { 200, 270 }, neon = { 30, 90 }, onyx = { 40, 120 }, opal = { 1, 40 }, clearie = { 8, 50 } }
for _, id in ipairs({ "ember", "tide", "jade", "volt", "rime", "nova", "obsidian", "moss", "comet" }) do
	local look = MarbleLook.lookFor(id)
	local ball = MarbleLook.make(look, 1.2, nil, 7)
	local n = count(ball)
	local range = want[look.pattern]
	check(id .. " (" .. look.pattern .. ") has its interior", range and n >= range[1] and n <= range[2] and ball.Material == Enum.Material.SmoothPlastic and ball.Transparency > 0.1, n)
	-- Every piece sits inside the glass and is welded to the ball.
	local inside, welded = true, true
	for _, p in ipairs(ball.Interior:GetChildren()) do
		if (p.Position - ball.Position).Magnitude > 1.2 then
			inside = false
		end
		if not p:FindFirstChildOfClass("Weld") then
			welded = false
		end
	end
	check(id .. " interior inside the glass and welded", inside and welded)
	ball:Destroy()
end
for _, id in ipairs({ "pip", "ironside" }) do
	local ball = MarbleLook.make(MarbleLook.lookFor(id), 1.2)
	check(id .. " is opaque with no interior", ball.Transparency == 0 and count(ball) == 0, ball.Material)
	ball:Destroy()
end
for id = 1, 8 do
	local ball = MarbleLook.make(MarbleLook.mib(id), Config.MIB_R, nil, id * 1.37 + 0.5)
	check("target " .. id .. " has its " .. MarbleLook.mib(id).pattern, count(ball) > 2, count(ball))
	ball:Destroy()
end
-- Generated collectibles: the same seed gives the same interior, piece for piece.
local ok, n = true, 0
for i = 1, 20 do
	local id = Forge.collectibleId(if i % 2 == 0 then "Epic" else "Rare", "art" .. i)
	local look = MarbleLook.lookFor(id)
	local a = MarbleLook.make(look, 1)
	local b = MarbleLook.make(look, 1)
	local ca, cb = count(a), count(b)
	n += ca
	if ca ~= cb then
		ok = false
	end
	a:Destroy()
	b:Destroy()
end
check("generated marbles build the same interior every time", ok, n .. " pieces over 20")

-- The aim guide's colour is the shooter's own.
check("ember's guide colour is the web's ui colour", MarbleLook.uiColor(MarbleLook.lookFor("ember")) == Color3.fromHex("#ff5a2a"))

local fails = 0
for _, l in ipairs(out) do
	print(l)
	if string.sub(l, 1, 4) == "FAIL" then
		fails += 1
	end
end
print(string.format("marbles: %d checks, %d failed", #out, fails))
return fails == 0 and "PASS" or ("FAIL " .. fails)
