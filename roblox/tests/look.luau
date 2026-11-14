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
local BACKDROP = { desk = "BigBook", culdesac = "House", grass = "Crown", sand = "Frond", ice = "Needles", gravel = "BigBoulder", minigolf = "Crown" }
local EXTRA = { desk = "Pencil", culdesac = "LampPost", grass = "Petals", sand = "Canopy", ice = "Snowball", gravel = "Cone", minigolf = "FlagPole" }
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
	local count = { Bank = 0, Line = 0, Scenery = 0, Extra = 0 }
	for _, d in ipairs(f:GetDescendants()) do
		if d.Name == "Bank" then
			count.Bank += 1
		elseif d.Name == LINE[arena.ring.style] then
			count.Line += 1
		elseif d.Name == SCENERY[id] then
			count.Scenery += 1
		elseif d.Name == EXTRA[id] then
			count.Extra += 1
		end
	end
	check(id .. " ground is " .. arena.material.Name, ground and ground.Material == arena.material, ground and ground.Material.Name)
	check(id .. " has its bank", count.Bank >= 64 * (#arena.bank.profile - 2), count.Bank)
	check(id .. " ring is " .. arena.ring.style, count.Line == 120, count.Line)
	check(id .. " has its scenery (" .. SCENERY[id] .. ")", count.Scenery >= 1, count.Scenery)
	check(id .. " has 2 stands", #built.stands == 2)
	check(id .. " has its toys (" .. EXTRA[id] .. ")", count.Extra >= 1, count.Extra)
	local back = f:FindFirstChild("Backdrop", true)
	local backN = 0
	if back then
		for _, d in ipairs(back:GetDescendants()) do
			if d.Name == BACKDROP[id] then
				backN += 1
			end
		end
	end
	check(id .. " is ringed by its backdrop (" .. BACKDROP[id] .. ")", backN >= 10, backN)
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

-- The uploaded audio loads: the sprite at its full length, and the music.
local Ids = require(Ringer.Ids)
local MIN = { sfx = 180, lobby = 55, match = 60 }
for key, minLen in pairs(MIN) do
	local id = Ids.audio and Ids.audio[key]
	if id and id ~= 0 then
		local snd = Instance.new("Sound")
		snd.SoundId = "rbxassetid://" .. id
		snd.Parent = workspace
		local t0 = os.clock()
		while not snd.IsLoaded and os.clock() - t0 < 60 do
			task.wait(0.5)
		end
		check(key .. " audio loads from Roblox", snd.IsLoaded and snd.TimeLength > minLen, string.format("loaded %s, %.1f s", tostring(snd.IsLoaded), snd.TimeLength))
		snd:Destroy()
	end
end

-- Feel: the hit, capture and signature effects, the turn banner, the intro and emotes all run.
local Juice = require(client.Juice)
local Show = require(client.Show)
local okJ, errJ = pcall(function()
	local p = Vector3.new(7000, 1, 0)
	Juice.sparks(p, 600)
	Juice.shockwave(p, 900, Color3.new(1, 1, 1))
	Juice.capture(p, Color3.new(1, 0.5, 0), 1)
	Juice.capture(p, Color3.new(1, 0.5, 0), 3)
	Juice.signature(p, "flames,lightning,galaxy,snow", Color3.new(0, 1, 1))
	Juice.launch(0.8)
	Juice.pow(p, 900)
	Juice.flash(p, 2, nil)
	Juice.coins(p, 4)
end)
check("hit, capture and signature effects run", okJ and Juice.trauma > 0 and Juice.fovKick > 0, errJ)
local frame = Instance.new("Frame")
Show.attach(frame)
local st = { id = 999, origin = Vector3.new(7000, 0, 0), arena = "grass", seats = { { name = "You", marble = "dragon", userId = 1 }, { name = "Tide Bot", marble = "tide" } }, current = 2, phase = "aim", firstShot = true, shots = 0 }
local okS, errS = pcall(function()
	Show.intro(st, 1)
	Show.turn(st, 1)
	Show.emote(st, 2, "🔥")
end)
check("intro, turn banner and emote run", okS, errS)
check("the turn banner names the shooter", frame:FindFirstChild("TurnBanner") ~= nil and (frame.TurnBanner:FindFirstChildOfClass("TextLabel") :: TextLabel).Text == "TIDE'S TURN", frame:FindFirstChild("TurnBanner") and (frame.TurnBanner:FindFirstChildOfClass("TextLabel") :: TextLabel).Text)
check("the pill says who is shooting", (frame:FindFirstChild("TurnPill") :: TextLabel).Text:find("Tide") ~= nil)
Show.clear()

local Rewards = require(client.Rewards)
check("levels: 0 games is level 1, 50 XP is level 2", Rewards.level(0, 0) == 1 and Rewards.level(5, 0) == 2 and Rewards.level(3, 2) == 2, Rewards.level(5, 0))
local lv, into, span = Rewards.level(20, 10)
check("level 4 at 350 XP", lv == 4 and into == 50 and span == 200, string.format("%d %d %d", lv, into, span))
for _, n in ipairs({ "pop", "boing", "coin_fly", "levelup", "fanfare" }) do
	check(n .. " is in the sprite", Index[n] ~= nil)
end

-- The 2022 materials, and outdoor fields set into terrain that goes again with the table.
-- (Use2022Materials is set in the place file by build.mjs; scripts may not read it.)
do
	local o = Vector3.new(12000, 0, 0)
	local h = Instance.new("Model")
	h.Parent = workspace
	Arena.build(o, Config.ARENAS.grass, 2, Random.new(1), h, true)
	local mats = workspace.Terrain:ReadVoxels(Region3.new(o + Vector3.new(70, -4, 70), o + Vector3.new(78, 0, 78)):ExpandToGrid(4), 4)
	check("the lawn stands in real grass", mats[1][1][1] == Enum.Material.Grass, mats[1][1][1])
	h:Destroy()
	Arena.clear(o)
	local after = workspace.Terrain:ReadVoxels(Region3.new(o + Vector3.new(70, -4, 70), o + Vector3.new(78, 0, 78)):ExpandToGrid(4), 4)
	check("the terrain goes with the table", after[1][1][1] == Enum.Material.Air, after[1][1][1])
end
-- The feed, a big emote on screen, and the hit-stop.
local okF, errF = pcall(function()
	local fr = Instance.new("Frame")
	Show.attach(fr)
	Show.feed("You captured a marble! +1", Color3.new(1, 1, 0))
	Show.screenEmote("🔥", "Tide", Color3.new(0, 0.5, 1))
	assert(fr:FindFirstChild("Feed") and #fr.Feed:GetChildren() >= 3, "feed rows")
	require(client.Replay).hitStop(0.05)
end)
check("the feed and big emotes show on screen", okF, errF)
local Pets = require(client.Pets)
check("the floating orb is big enough to read", Pets.RADIUS >= 1.3 and type(Pets.setPlaying) == "function")

-- The lobby park: hills, rainbow, fountains, bouncy mushrooms, coins to pick up.
-- (Cloud tasks don't run the place's scripts: build it here, as Main does.)
local lobbyHolder = Instance.new("Model")
lobbyHolder.Parent = workspace
local okW, world = pcall(require(game.ServerScriptService.Server.LobbyWorld).build, lobbyHolder)
if not okW then
	check("the lobby park builds", false, world)
	world = nil
end
local caps, fountains = 0, 0
if world then
	for _, d in ipairs(world:GetDescendants()) do
		if d:IsA("BasePart") and d:GetAttribute("Bounce") then
			caps += 1
		elseif d.Name == "Fountain" then
			fountains += 1
		end
	end
end
check("the lobby park is built", world ~= nil and world:FindFirstChild("Rainbow") ~= nil and world:FindFirstChild("Clouds") ~= nil)
check("4 bouncy mushrooms and 2 fountains", caps == 4 and fountains == 2, caps .. " " .. fountains)
local edgeWalls = 0
if world and world:FindFirstChild("Edge") then
	for _, w in ipairs(world.Edge:GetChildren()) do
		if w.Name == "EdgeWall" and w.CanCollide and w.Transparency == 1 then
			edgeWalls += 1
		end
	end
end
check("an invisible wall rings the park, with a lid", edgeWalls == 72 and world.Edge:FindFirstChild("EdgeLid") ~= nil, edgeWalls)
check("pastel mist drifts at the park's edge", world ~= nil and #world:GetChildren() > 0 and (function()
	local n = 0
	for _, d in ipairs(world:GetChildren()) do
		if d.Name == "Mist" then
			n += 1
		end
	end
	return n == 16
end)())
local hillVox = workspace.Terrain:ReadVoxels(Region3.new(Vector3.new(160, 4, -4), Vector3.new(300, 8, 4)):ExpandToGrid(4), 4)
local hillCells = 0
for x = 1, hillVox.Size.X do
	if hillVox[x][1][1] ~= Enum.Material.Air then
		hillCells += 1
	end
end
check("hills on the horizon", hillCells >= 3, hillCells)
check("lobby coins sit clear of the fountains", (function()
	for _, s in ipairs(Config.LOBBY_COIN_SPOTS) do
		for _, a in ipairs({ math.rad(18), math.rad(198) }) do
			if (s - Vector3.new(math.cos(a) * 34, 2.4, math.sin(a) * 34)).Magnitude < 7 then
				return false
			end
		end
	end
	return #Config.LOBBY_COIN_SPOTS == 30
end)())
local runModel = world and world:FindFirstChild("MarbleRun")
local tracks = 0
if runModel then
	for _, d in ipairs(runModel:GetChildren()) do
		if d.Name == "Track" then
			tracks += 1
		end
	end
end
check("the marble run spirals three times round its tube", runModel ~= nil and tracks == 66 and runModel:GetAttribute("turns") == 3, tracks)
local gateArenas = {}
if world and world:FindFirstChild("Gates") then
	for _, g in ipairs(world.Gates:GetChildren()) do
		local prompt = g:FindFirstChildWhichIsA("ProximityPrompt", true)
		if prompt and Config.ARENAS[prompt:GetAttribute("Arena")] then
			gateArenas[prompt:GetAttribute("Arena")] = true
		end
	end
end
local gateCount = 0
for _, id in ipairs(Config.ARENA_ORDER) do
	if gateArenas[id] then
		gateCount += 1
	end
end
check("a world gate for every field, each with a play prompt", gateCount == #Config.ARENA_ORDER, gateCount)
check("lobby fun module loads", type(require(client.LobbyFun).start) == "function")

-- Books have no faces in the same place (they flickered and broke shadows on the desk).
local okB, errB = pcall(function()
	local bm = Instance.new("Model")
	bm.Parent = workspace
	local b = Arena.build(Vector3.new(14000, 0, 0), Config.ARENAS.desk, 2, Random.new(1), bm, true)
	local bad = 0
	for _, d in ipairs(b.folder:GetDescendants()) do
		if d.Name == "Pages" and d:IsA("BasePart") then
			local L = d.Parent
			-- Every page block must sit inside its book's boards: smaller in all three sizes than
			-- a board next to it would allow. Find the nearest cover.
			local best, bd = nil, math.huge
			for _, c in ipairs(L:GetChildren()) do
				if (c.Name == "Book" or c.Name == "BigBook") and c:IsA("BasePart") then
					local dd = (c.Position - d.Position).Magnitude
					if dd < bd then
						best, bd = c, dd
					end
				end
			end
			if best then
				local pz = d.Size.Z
				if pz > best.Size.Z - 0.1 then
					bad += 1
				end
			end
		end
	end
	assert(bad == 0, bad .. " page blocks reach their covers' faces")
end)
check("desk books have no flickering faces", okB, errB)

-- The fields answer the marbles: kick-up while rolling, tracks in sand, bank bursts, smashed props.
local Ground = require(client.Ground)
local okG, errG = pcall(function()
	local gm = Instance.new("Model")
	gm.Parent = workspace
	Arena.build(Vector3.new(12000, 0, 0), Config.ARENAS.sand, 2, Random.new(1), gm, true)
	Ground.enter("sand", gm)
	local bodies = { { id = 1, r = 0.21, px = 0, py = 0.21, pz = 0, vx = 20, vz = 0 }, { id = 2, r = 0.16, px = 1, py = 0.9, pz = 0, vx = 0, vz = 0 } }
	for i = 1, 12 do
		bodies[1].px += 0.4
		if i == 6 then
			bodies[2].py = 0.16
		end
		Ground.roll(bodies, Vector3.new(12000, 0, 0), 1 / 30)
	end
	Ground.lineFlash(Vector3.new(12000 + Config.RING_R, 0, 0), Color3.new(1, 0, 0))
	local lit = 0
	for _, seg in ipairs(gm:GetDescendants()) do
		if seg.Name == "Groove" and seg:IsA("BasePart") and seg.Color.R > 0.85 and seg.Color.G < 0.6 then
			lit += 1
		end
	end
	assert(lit >= 2, "ring line lit " .. lit)
	Ground.slam(Vector3.new(12000, 1, 50), 600)
	Ground.shatter(Vector3.new(12000, 1, 0), Color3.new(1, 0, 0))
	task.wait(0.2)
	Ground.leave()
end)
check("the sand kicks up, keeps tracks, and props shatter", okG and Ground.emitted > 20 and Ground.tracks >= 3, if okG then (Ground.emitted .. " particles " .. Ground.tracks .. " tracks") else errG)
-- Every field has its own sky: set pieces built, animated, and taken away again.
local Skies = require(client.Skies)
for _, id in ipairs(Config.ARENA_ORDER) do
	local okK, errK = pcall(function()
		Skies.enter(id, Vector3.new(16000, 0, 0))
		task.wait(0.1)
	end)
	local n = Skies.pieces
	local ok2 = pcall(Skies.leave)
	check(id .. " has something alive going round it", Skies.CRITTERS[id] ~= nil)
	check(id .. " has its own sky (" .. tostring(Skies.SKY[id].clock) .. "h, " .. n .. " pieces)", okK and ok2 and n >= 3 and workspace:FindFirstChild("FieldSkyPieces") == nil, if okK then n else errK)
end
local okE, errE = pcall(function()
	local p = Vector3.new(7000, 1, 0)
	Juice.rebound(p, 800)
	Juice.reenter(p)
	Juice.word(p, "TEST", Color3.new(1, 1, 1))
	Juice.gui = Instance.new("ScreenGui")
	Juice.stamp("OUT! TURN OVER")
end)
check("rebound, back-in and stamp effects run", okE, errE)
check("the mascot module loads", type(require(client.Mascot).start) == "function")

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
