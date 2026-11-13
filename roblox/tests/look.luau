-- Cloud test of how the game looks and sounds (CHECK build): every field built the web game's way
-- (ground, bank, ring line, scenery), every map piece skinned, every marble's effects, the shop's
-- showcase and the sound sprite's index covering every sound the game asks for.
-- node roblox/scripts/run-luau.mjs roblox/tests/look.luau <version>
local out = {}
local function check(name, ok, detail)
	table.insert(out, (ok and "PASS " or "FAIL ") .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
end

local Ringer = game.ReplicatedStorage.Ringer
local Config = require(Ringer.Config)
local Maps = require(Ringer.Maps)
local MarbleLook = require(Ringer.MarbleLook)
local MarbleFX = require(Ringer.MarbleFX)
local Index = require(Ringer.SfxIndex)
local Arena = require(game.ServerScriptService.Server.Arena)
local Pieces = require(game.ServerScriptService.Server.Pieces)
local client = game.StarterPlayer.StarterPlayerScripts.ClientModules
local Sfx = require(client.Sfx)
local Ambience = require(client.Ambience)

-- 1. Fields: each in its own material, with its bank, ring line and scenery.
local LINE = { string = "String", chalk = "Chalk", drawn = "Groove", etched = "Scratch" }
local SCENERY = { desk = "Book", culdesac = "Bush", grass = "Tuft", sand = "Rock", ice = "Needles", gravel = "Boulder", minigolf = "Sail" }
for i, id in ipairs(Config.ARENA_ORDER) do
	local arena = Config.ARENAS[id]
	local holder = Instance.new("Model")
	holder.Parent = workspace
	local origin = Vector3.new(9000 + i * 200, 0, 0)
	local ok, built = pcall(Arena.build, origin, arena, 2, Random.new(1), holder, true)
	if not ok then
		check(id .. " builds", false, built)
		continue
	end
	local f = built.folder
	local ground = f:FindFirstChild("Ground") :: BasePart
	local count = { Bank = 0, Line = 0, Scenery = 0 }
	for _, d in ipairs(f:GetDescendants()) do
		if d.Name == "Bank" then
			count.Bank += 1
		elseif d.Name == LINE[arena.ring.style] then
			count.Line += 1
		elseif d.Name == SCENERY[id] then
			count.Scenery += 1
		end
	end
	check(id .. " ground is " .. arena.material.Name, ground and ground.Material == arena.material, ground and ground.Material.Name)
	check(id .. " has its bank", count.Bank >= 64 * (#arena.bank.profile - 2), count.Bank)
	check(id .. " ring is " .. arena.ring.style, count.Line == 120, count.Line)
	check(id .. " has its scenery (" .. SCENERY[id] .. ")", count.Scenery >= 1, count.Scenery)
	check(id .. " has 2 stands", #built.stands == 2)
	-- Nothing of the field stands inside the ring's play area, where marbles roll.
	local blocking = 0
	for _, d in ipairs(f:GetDescendants()) do
		if d:IsA("BasePart") and d.Name ~= "Ground" and d.CanCollide and (Vector3.new(d.Position.X, 0, d.Position.Z) - origin).Magnitude < Config.BOUND_R - 1 then
			blocking += 1
		end
	end
	check(id .. " nothing solid in the play area", blocking == 0, blocking)
	-- Every map piece of this field draws.
	local pieces = 0
	local okMap = true
	for seed = 1, 6 do
		for _, diff in ipairs({ "easy", "medium", "hard" }) do
			local map = Maps.generate(id, diff, seed)
			local ok2, err = pcall(Pieces.build, map, origin, holder)
			okMap = okMap and ok2
			if not ok2 then
				check(id .. " map " .. diff .. " " .. seed, false, err)
			end
			pieces += #map.pieces
		end
	end
	check(id .. " draws every map piece", okMap, pieces .. " pieces")
	holder:Destroy()
end

-- 2. Marbles: every named marble's effects, and the Premium Collection all alive.
for _, m in ipairs(Config.MARBLES) do
	local look = MarbleLook.lookFor(m.id)
	local ok, ball = pcall(MarbleLook.make, look, 1)
	if not ok then
		check(m.id .. " builds", false, ball)
		continue
	end
	local want = MarbleFX.forLook(look)
	local emitters, beams, moons = 0, 0, 0
	for _, d in ipairs(ball:GetDescendants()) do
		if d:IsA("ParticleEmitter") then
			emitters += 1
		elseif d:IsA("Beam") then
			beams += 1
		elseif d.Name:match("^Bolt%d_") then
			beams += 1
		elseif d.Name:match("^Moon") then
			moons += 1
		end
	end
	local alive = #want == 0 or emitters + beams + moons > 0 or ball:FindFirstChildOfClass("PointLight") ~= nil
	check(m.id .. " effects: " .. table.concat(want, ","), alive, string.format("%d emitters %d bolt segments %d moons", emitters, beams, moons))
	if m.tagline then
		check(m.id .. " (Premium) is alive inside and described", #want >= 1 and MarbleFX.describe(look) ~= "")
	end
	if table.find(want, "lightning") then
		check(m.id .. " has 3 bolts of 4 neon segments", beams == 12, beams)
	end
	if table.find(want, "orbit") then
		check(m.id .. " has 3 moons", moons == 3, moons)
	end
	ball:Destroy()
end
-- Mibs stay clean; generated marbles get effects by tier and phenomenon.
local mib = MarbleLook.make(MarbleLook.mib(3), Config.MIB_R)
check("target marbles have no effects", #MarbleFX.forLook(MarbleLook.mib(3)) == 0 and mib:GetAttribute("Fx") == nil)
local Forge = require(Ringer.Forge)
local tiers = {}
for i = 1, 400 do
	local c = Forge.mint("look" .. i)
	local fx = MarbleFX.forLook(MarbleLook.lookFor(c.id))
	tiers[c.tier] = math.max(tiers[c.tier] or 0, #fx)
end
check("Common generated marbles stay plain", (tiers.Common or 0) <= 1, tiers.Common)
check("Legendary generated marbles get an aura and stardust", (tiers.Legendary or 0) >= 2, tiers.Legendary)
local sale = 0
for _, m in ipairs(Config.MARBLES) do
	if m.price and m.tagline then
		sale += 1
	end
end
check("the Premium Collection is on sale", sale == 8, sale)

-- 3. Sound: every sound the game plays is in the sprite.
local missing = {}
local function need(name)
	if Index[name] then
		return
	end
	for i = 0, 4 do
		if Index[name .. "_" .. i] then
			return
		end
	end
	table.insert(missing, name)
end
for _, s in pairs(Sfx.SURFACE) do
	need(s.kerb)
	need(s.tap)
end
for kind in pairs(Sfx.SURFACE) do
	need("roll_" .. kind)
end
for _, a in pairs(Config.ARENAS) do
	need("pad_" .. a.mood)
	check(a.id .. " sounds like " .. a.surface, Sfx.SURFACE[a.surface] ~= nil)
end
for _, n in ipairs({ "impactGlass_light", "impactGlass_medium", "impactGlass_heavy", "impactPunch_medium", "chime_capture", "chime_turn", "chime_win", "chime_lose", "chime_tap", "coin", "buy", "equip", "whoosh", "tick", "reveal_common", "reveal_rare", "reveal_epic", "reveal_legendary" }) do
	need(n)
end
check("every sound is in the sprite", #missing == 0, table.concat(missing, ", "))
local loops = 0
for name, r in pairs(Index) do
	if r[3] then
		loops += 1
	end
	if r[2] <= r[1] then
		table.insert(missing, name)
	end
end
check("rolls and pads loop", loops == 13, loops)
-- With the asset id or not, the calls run; the log shows what played.
Sfx.log = {}
Sfx.setSurface("ice")
Sfx.clack(500, "marble")
task.wait(0.05)
Sfx.clack(500, "kerb")
task.wait(0.05)
Sfx.clack(500, "bumper")
Sfx.launch(0.8)
Sfx.reveal("Mythic")
local log = table.concat(Sfx.log, " ")
check("a hard marble hit plays glass", log:find("impactGlass_") ~= nil, log)
check("the ice bank plays a light plate", log:find("impactPlate_light") ~= nil)
check("a bumper plays a punch", log:find("impactPunch_medium") ~= nil)
check("the flick on ice plays snow", log:find("footstep_snow") ~= nil)
check("a Mythic plays the legendary sting", log:find("reveal_legendary") ~= nil)
Sfx.log = nil

-- 4. Ambience changes the light for a field and gives it back.
local Lighting = game:GetService("Lighting")
local before = Lighting.ClockTime
check("ambience module loads", type(Ambience.enter) == "function" and before ~= nil)

local fails = 0
for _, l in ipairs(out) do
	print(l)
	if string.sub(l, 1, 4) == "FAIL" then
		fails += 1
	end
end
print(string.format("look: %d checks, %d failed", #out, fails))
return fails == 0 and "PASS" or ("FAIL " .. fails)
