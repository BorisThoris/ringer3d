-- Cloud smoke test of a CHECK build: everything compiles, the server booted, the logic holds.
local out = {}
local function check(name, ok, detail)
	table.insert(out, (ok and "PASS " or "FAIL ") .. name .. (detail and (": " .. tostring(detail)) or ""))
end

-- 1. Every script compiles. Each copy is wrapped in a function that is never called (build.mjs),
-- so loading one runs nothing: any error at all is a compile error. (Roblox reports it only as
-- "Requested module experienced an error while loading", so the message can't be matched.)
for _, m in ipairs(game.ServerStorage.SyntaxCheck:GetChildren()) do
	local ok, res = pcall(require, m)
	check("compiles " .. m.Name, ok and type(res) == "function", (not ok) and tostring(res):sub(1, 200) or nil)
end
local function mod(path)
	local ok, res = pcall(require, path)
	check("loads " .. path:GetFullName(), ok, not ok and res or nil)
	return ok and res or nil
end
local Ringer = game.ReplicatedStorage.Ringer
local Config = mod(Ringer.Config)
local Rules = mod(Ringer.Rules)
local Bot = mod(Ringer.Bot)
mod(Ringer.MarbleLook)
local Sim = mod(Ringer.Sim)
local Surfaces = mod(Ringer.Surfaces)
mod(Ringer.Playback)
for _, m in ipairs(game.ServerScriptService.Server:GetChildren()) do
	mod(m)
end
local client = game.StarterPlayer.StarterPlayerScripts.ClientModules
mod(client.Kit)

mod(client.Aim)
mod(client.Replay)

-- 2. The server script boots (cloud test servers don't run the place's scripts, so run the
-- compiled copy's body here): remotes and the lobby exist, with no errors.
local boot = require(game.ServerStorage.SyntaxCheck["ServerScriptService.Main.server"])
local booted, bootErr = pcall(boot)
check("server script runs", booted, bootErr)
task.wait(2)
check("remotes created", Ringer:FindFirstChild("Remotes") ~= nil)
check("lobby built", workspace:FindFirstChild("Lobby") ~= nil)
local mascotBody = workspace:FindFirstChild("Lobby") and workspace.Lobby:FindFirstChild("Mascot") and workspace.Lobby.Mascot:FindFirstChild("Body")
check("the mascot has a solid body you can see", mascotBody ~= nil and mascotBody.Transparency == 0 and mascotBody.Size.X >= 12, mascotBody and mascotBody.Transparency)
local Mascot = require(game.StarterPlayer.StarterPlayerScripts.ClientModules.Mascot)
local okM, errM = pcall(function()
	Mascot.start({ Character = nil, DisplayName = "Tester" } :: any)
	for name in pairs(Mascot.EXPRESSIONS) do
		Mascot.express(name, 5)
		for _ = 1, 4 do
			Mascot.step(1 / 30)
		end
		assert(Mascot.expression == name, "expression " .. name)
	end
end)
local lips = 0
for _, d in ipairs(workspace.Lobby.Mascot:GetChildren()) do
	if d.Name == "Lip" then
		lips += 1
	end
end
check("the mascot smiles, grins, gasps, winks and yawns", okM and lips == 11, if okM then lips else errM)
local Social = require(game.ServerScriptService.Server.Social)
local Rewards = require(game.StarterPlayer.StarterPlayerScripts.ClientModules.Rewards)
local levelsAgree = true
for _, c in ipairs({ { 0, 0 }, { 5, 0 }, { 3, 2 }, { 40, 25 }, { 200, 120 } }) do
	if Social.level(c[1], c[2]) ~= Rewards.level(c[1], c[2]) then
		levelsAgree = false
	end
end
check("nameplate levels match the client's level bar", levelsAgree)
check("titles climb with level", Social.title(1) == "Rookie" and Social.title(12) == "Sharpshooter" and Social.title(60) == "Ringer King")
local bestName, bestRarity = Social.best({ owned = { ember = true, blackhole = true }, forged = {} })
check("the nameplate shows the rarest marble", bestRarity == "Mythic" or bestRarity == "Legendary", tostring(bestName) .. " " .. tostring(bestRarity))
Social.announce("test news")
check("announcements are logged and sent", Social.log[#Social.log] == "test news")
local questsOk = #Social.QUESTS >= 6
for _, q in ipairs(Social.QUESTS) do
	if not (q.goal > 0 and q.reward > 0 and q.text ~= "") then
		questsOk = false
	end
end
check("a pool of daily quests, each with a goal and a reward", questsOk, #Social.QUESTS)
check("the all-quests bonus only once every quest is claimed",
	Social.ALL_QUESTS_BONUS > 0
		and not Social.allClaimed({})
		and not Social.allClaimed({ { claimed = true }, { claimed = false }, { claimed = true } })
		and Social.allClaimed({ { claimed = true }, { claimed = true }, { claimed = true } }))
local giftFake = { UserId = 2 } :: any
local gifts = Social.gifts(giftFake)
local okEarly, whyEarly = Social.claimGift(giftFake, 1)
check("six playtime gifts, none opens early", #gifts == 6 and gifts[1].left > 0 and not okEarly and whyEarly == "Not yet!", whyEarly)

-- The weekend event: Saturday and Sunday (UTC) only. Noon on Fri 13, Sat 14, Sun 15, Mon 16 Nov 2026.
do
	local fri = Config.event(1794571200)
	local sat, satMult = Config.event(1794657600)
	local sun = Config.event(1794744000)
	local mon, monMult = Config.event(1794830400)
	check("double coins on Saturday and Sunday only", fri == nil and sat ~= nil and satMult == 2 and sun ~= nil and mon == nil and monMult == 1)
end

-- Flex: auras by level tier, codes once each, the friend boost capped.
do
	local Flex = require(game.ServerScriptService.Server.Flex)
	check("no aura below level 5, then one per tier", Flex.auraFor(1) == nil and Flex.auraFor(4) == nil and Flex.auraFor(5) == "Spark" and Flex.auraFor(19) == "Glow" and Flex.auraFor(20) == "Stars" and Flex.auraFor(60) == "Prism")
	local prof = { codes = {} }
	local ok1, c1 = Flex.redeem(prof, "  ringer ")
	local ok2, why2 = Flex.redeem(prof, "RINGER")
	local ok3, why3 = Flex.redeem(prof, "NOPE")
	Flex.CODES.OLDONE = { coins = 10, expired = true }
	local ok4, why4 = Flex.redeem(prof, "oldone")
	Flex.CODES.OLDONE = nil
	local ok5 = Flex.redeem(prof, string.rep("x", 100))
	check("a code pays once, any case, trimmed", ok1 and c1 == Flex.CODES.RINGER.coins and not ok2 and why2:find("already") ~= nil, tostring(c1) .. " / " .. tostring(why2))
	check("unknown, expired and junk codes are refused", not ok3 and why3 == "That's not a code." and not ok4 and why4:find("expired") ~= nil and not ok5)
	check("friends boost coins 10% each, up to 30%", Flex.friendBoost(0) == 1 and math.abs(Flex.friendBoost(2) - 1.2) < 1e-9 and math.abs(Flex.friendBoost(9) - 1.3) < 1e-9)
	-- Dress a stand-in character in every aura and the crown.
	local dummy = Instance.new("Model")
	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Parent = dummy
	local head = Instance.new("Part")
	head.Name = "Head"
	head.Parent = dummy
	local dressed = true
	for _, a in ipairs(Flex.AURAS) do
		Flex.dress(dummy, a.name, false)
		local at = root:FindFirstChild("Aura")
		dressed = dressed and at ~= nil and at:FindFirstChildOfClass("ParticleEmitter") ~= nil and #root:GetChildren() == 1
	end
	Flex.dress(dummy, "Prism", true)
	local crowned = head:FindFirstChild("Crown") ~= nil
	Flex.dress(dummy, nil, false)
	-- The daily spin: once per 20 hours, and the wheel lands at the published odds.
	local sp = { lastSpin = 0 }
	local first = Flex.spin(sp, 1000000, Random.new(1))
	local again, left = Flex.spin(sp, 1000000 + 3600, Random.new(1))
	local later = Flex.spin(sp, 1000000 + Flex.SPIN_EVERY, Random.new(1))
	check("one spin per 20 hours, with the time left", first and not again and left == Flex.SPIN_EVERY - 3600 and later ~= false, tostring(left))
	local counts, total, N = {}, 0, 20000
	for _, w in ipairs(Flex.WHEEL) do
		total += w[1]
	end
	local rng = Random.new(7)
	for _ = 1, N do
		local pp = { lastSpin = 0 }
		local i = Flex.spin(pp, 10 ^ 9, rng)
		counts[i] = (counts[i] or 0) + 1
	end
	local fair = true
	for i, w in ipairs(Flex.WHEEL) do
		if math.abs((counts[i] or 0) / N - w[1] / total) > 0.015 then
			fair = false
		end
	end
	check("the wheel lands at its published odds", fair)
	-- The aura shop: shop auras need buying, level auras need the level, "none" is always allowed.
	local ap = { coins = 3000, auras = {} }
	local okBuy, price = Flex.buyCheck(ap, "Frost")
	local okPoor = Flex.buyCheck(ap, "Celestial")
	local okFake = Flex.buyCheck(ap, "Nope")
	check("shop auras are bought with enough coins, only real ones", okBuy and price == 2500 and not okPoor and not okFake)
	ap.auras.Frost = true
	ap.auraPick = "Frost"
	local wearsBought = Flex.choose(ap, 1) == "Frost"
	ap.auraPick = "Prism"
	local fallsBack = Flex.choose(ap, 12) == "Glow" -- can't wear Prism at 12: the level's own
	ap.auraPick = "none"
	check("you wear what you own or unlocked, else your level's aura, or none", wearsBought and fallsBack and Flex.choose(ap, 60) == nil and Flex.canWear(ap, 50, "Prism") and not Flex.canWear(ap, 49, "Prism") and not Flex.canWear(ap, 99, "Inferno"))
	for name in pairs(Flex.STYLES) do
		Flex.dress(dummy, name, false)
		dressed = dressed and root.Aura:FindFirstChildOfClass("ParticleEmitter") ~= nil
	end
	Flex.dress(dummy, nil, false)
	check("every aura dresses a character, one at a time; the crown comes and goes", dressed and crowned and head:FindFirstChild("Crown") == nil and root.Aura:FindFirstChildOfClass("ParticleEmitter") == nil)
end

-- 3. Rules.
local cross = Rules.startingCross()
check("cross has 13", #cross == 13, #cross)
check("placement outside line", Rules.placement(1).Magnitude > Config.RING_R)
local w = Rules.gameOver({ 7, 0 }, 6, 0)
check("7 of 13 locks the game", w ~= nil and w[1] == 1)
check("6-0 with 7 left is not over", Rules.gameOver({ 6, 0 }, 7, 0) == nil)
check("empty ring ends", Rules.gameOver({ 6, 7 }, 0, 0) ~= nil)

-- 4. The bot (the web game's, imagining shots on Ringer.Sim): a legend's opening shot is aimed
-- along a clear line at a real marble, and its think fits in a turn.
local start = Sim.startingLayout()
local t0 = os.clock()
local plan = Bot.plan({ layout = start, firstShot = true, seatAngle = Rules.seatAngle(1, 2), surface = Surfaces.desk, pieces = {} }, Config.BOTS.legend, Bot.rng(1, 0, 0), require(game.ServerScriptService.Server.Table).slicer())
local thinkSecs = os.clock() - t0
local fx, fz = Sim.placementPoint(plan.placeAngle)
local dx, dz = math.cos(plan.aimAngle), math.sin(plan.aimAngle)
local hits = false
for _, m in ipairs(start.targets) do
	local tx, tz = m.x - fx, m.z - fz
	local along = tx * dx + tz * dz
	if along > 0 and math.sqrt((tx - dx * along) ^ 2 + (tz - dz * along) ^ 2) < Sim.WORLD.shooterRadius + Sim.WORLD.targetRadius then
		hits = true
	end
end
check("legend bot aims at a marble", hits, string.format("power %.2f", plan.power))
check("bot power in range", plan.power > 0 and plan.power <= 1)
check("legend thinks in under 6 s", thinkSecs < 6, string.format("%.2fs", thinkSecs))

-- The Tower is the web game's buildTower for Ember: fields, bots, maps, guide caps, series.
local WANT_TOWER = {
	{ "pip", "grass", "rookie", "easy", 43467, "full", 1 },
	{ "tide", "sand", "novice", "easy", 34241, "full", 1 },
	{ "jade", "grass", "casual", "medium", 86862, "full", 1 },
	{ "volt", "desk", "regular", "medium", 58732, "short", 1 },
	{ "ironside", "gravel", "skilled", "hard", 95235, "short", 1 },
	{ "rime", "ice", "expert", "hard", 82998, "short", 2 },
	{ "nova", "sand", "master", "hard", 99046, "off", 1 },
	{ "obsidian", "ice", "legend", "hard", 90949, "off", 3 },
}
for i, w in ipairs(WANT_TOWER) do
	local st = Config.TOWER[i]
	local got = { st.marble, st.arena, st.bot, st.difficulty, st.mapSeed, st.guide, st.wins }
	local same = true
	for k = 1, 7 do
		same = same and got[k] == w[k]
	end
	check("tower floor " .. i .. " is the web game's", same, table.concat(got :: any, ","))
end

-- 5. A table builds, holds 13 marbles inside the ring, and tears down.
local Table = require(game.ServerScriptService.Server.Table)
local t = Table.new({ seats = { { kind = "bot", bot = "casual", name = "A", marble = "ember" }, { kind = "bot", bot = "casual", name = "B", marble = "tide" } }, arena = "ice", origin = Vector3.new(3000, 0, 0), mode = "test", seed = 1 })
local inside = 0
for _, m in ipairs(t.layout.targets) do
	if not Sim.isOutsideRing(m.x, m.z) then
		inside += 1
	end
end
check("table has 13 marbles in the ring", inside == 13, inside)
check("table has 13 marble parts", #t.marbleFolder:GetChildren() == 13, #t.marbleFolder:GetChildren())
check("state serialises", t:state().remaining == 13)
check("table has a generated map", t.map ~= nil and #t.map.pieces > 0, t.map and #t.map.pieces)
t:destroy()

-- Every field builds its generated map; props are named parts the replay can move.
for _, arena in ipairs(Config.ARENA_ORDER) do
	local ok, tt = pcall(Table.new, { seats = { { kind = "bot", bot = "casual", name = "A", marble = "ember" }, { kind = "bot", bot = "casual", name = "B", marble = "tide" } }, arena = arena, origin = Vector3.new(3200, 0, 0), mode = "test", seed = 3, difficulty = "hard", mapSeed = 99 })
	check("builds " .. arena .. " hard map", ok and tt.model:FindFirstChild("Map") ~= nil, not ok and tt or nil)
	if ok then
		local props, named = 0, 0
		for i, p in ipairs(tt.map.pieces) do
			if Sim.propTraits(p) then
				props += 1
				if tt.mapFolder:FindFirstChild("Prop" .. i) then
					named += 1
				end
			end
		end
		check(arena .. " props are named parts", props == named, string.format("%d/%d", named, props))
		tt:destroy()
	end
end

-- A whole bot game plays out on the sim to a result (instant: no replays to wait for).
local events = {}
local g = Table.new({
	seats = { { kind = "bot", bot = "skilled", name = "A", marble = "ember" }, { kind = "bot", bot = "casual", name = "B", marble = "tide" } },
	arena = "minigolf", origin = Vector3.new(3400, 0, 0), mode = "test", seed = 11, difficulty = "hard", mapSeed = 5, instant = true,
	send = function(_, kind)
		events[kind] = (events[kind] or 0) + 1
	end,
})
local tg = os.clock()
local res = g:run()
local total = res.scores[1] + res.scores[2]
check("bot game ends with a winner", #res.winners >= 1, table.concat(res.scores, "-"))
check("bot game captures marbles", total > 0, string.format("%d in %d shots, %.1fs", total, res.shots, os.clock() - tg))
check("shots were broadcast", (events.shot or 0) == res.shots, events.shot)
g:destroy()

-- Climbing as another fighter skips them, as the web game's buildTower does.
local WANT_OTHERS = {
	pip = { { "tide", "sand", "rookie", "easy", 56622, "full", 1 }, { "jade", "grass", "novice", "easy", 9243, "full", 1 }, { "volt", "desk", "casual", "medium", 36351, "full", 1 }, { "ironside", "gravel", "regular", "medium", 83330, "short", 1 }, { "rime", "ice", "skilled", "hard", 60617, "short", 2 }, { "nova", "sand", "expert", "hard", 21427, "short", 1 }, { "ember", "culdesac", "master", "hard", 41255, "off", 1 }, { "obsidian", "ice", "legend", "hard", 90949, "off", 3 } },
	nova = { { "pip", "grass", "rookie", "easy", 43467, "full", 1 }, { "tide", "sand", "novice", "easy", 34241, "full", 1 }, { "jade", "grass", "casual", "medium", 86862, "full", 1 }, { "volt", "desk", "regular", "medium", 58732, "short", 1 }, { "ironside", "gravel", "skilled", "hard", 95235, "short", 1 }, { "rime", "ice", "expert", "hard", 82998, "short", 2 }, { "ember", "culdesac", "master", "hard", 41255, "off", 1 }, { "obsidian", "ice", "legend", "hard", 90949, "off", 3 } },
}
for fighter, want in pairs(WANT_OTHERS) do
	local tower = Config.buildTower(fighter)
	local same = #tower == #want
	for i, w in ipairs(want) do
		local st = tower[i]
		local got = st and { st.marble, st.arena, st.bot, st.difficulty, st.mapSeed, st.guide, st.wins } or {}
		for k = 1, 7 do
			same = same and got[k] == w[k]
		end
	end
	check("tower as " .. fighter .. " is the web game's", same)
end

-- A player who goes is replaced by a skilled bot, as in the web game. With nobody left the
-- game ends; in a duel it goes on for the one who stayed.
local function fake(name)
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = workspace
	return f
end
local solo = fake("Solo")
local tl = Table.new({ seats = { { kind = "player", player = solo :: any, name = "Solo", marble = "ember" }, { kind = "bot", bot = "rookie", name = "B", marble = "tide" } }, arena = "desk", origin = Vector3.new(3600, 0, 0), mode = "test", seed = 5, instant = true })
local soloDone = nil
task.spawn(function()
	soloDone = tl:run()
end)
task.wait(0.5)
solo.Parent = nil
local w0 = os.clock()
while not soloDone and os.clock() - w0 < 60 do
	task.wait(0.1)
end
check("a solo game whose player leaves ends", soloDone ~= nil and soloDone.abandoned ~= nil)
tl:destroy()

local stay, go = fake("Stay"), fake("Go")
local lost = 0
local td = Table.new({
	seats = { { kind = "player", player = stay :: any, name = "Stay", marble = "ember" }, { kind = "player", player = go :: any, name = "Go", marble = "tide" } },
	arena = "culdesac", origin = Vector3.new(3800, 0, 0), mode = "test", seed = 9, instant = true,
	send = function(_, kind)
		if kind == "seatLost" then
			lost += 1
		end
	end,
})
local duelDone = nil
task.spawn(function()
	duelDone = td:run()
end)
local wd = os.clock()
go.Parent = nil -- "Go" leaves at once: a bot plays their turns
while not duelDone and os.clock() - wd < 120 do
	-- "Stay" shoots at the middle whenever it's their turn.
	if td.phase == "aim" and td.current == 1 and not td.pending then
		local a = Rules.seatAngle(1, 2)
		local from = td.layout.shooter
		local aim = if from and not td.firstShot then math.atan2(-from.z, -from.x) else a + math.pi
		td:submit(stay :: any, a, aim, 0.8, 0)
	end
	task.wait(0.05)
end
check("a duel goes on with a bot in the leaver's seat", duelDone ~= nil and duelDone.abandoned == nil and lost == 1 and td.seats[2].kind == "bot" and td.seats[2].bot == "skilled", duelDone and table.concat(duelDone.scores, "-"))
td:destroy()

-- 6. Collectibles: Marble Bags mint generated marbles at the odds the bag shows.
local Forge = mod(Ringer.Forge)
local total = 0
for _, tier in ipairs(Config.BAG_ODDS) do
	total += tier.weight
end
check("bag odds total 100", math.abs(total - 100) < 1e-9, total)
local counts, fx, shiny = {}, 0, 0
local N = 20000
local r = Random.new(7)
for _ = 1, N do
	local c = Forge.mint(Forge.robloxUid(r))
	counts[c.tier] = (counts[c.tier] or 0) + 1
	if c.effect ~= "none" then
		fx += 1
	end
	if c.shiny then
		shiny += 1
	end
end
for _, tier in ipairs(Config.BAG_ODDS) do
	local got = (counts[tier.rarity] or 0) / N * 100
	-- Within five standard errors of the published odds.
	local p = tier.weight / 100
	local tol = 5 * math.sqrt(p * (1 - p) / N) * 100 + 0.05
	check(string.format("bag %s near %g%%", tier.rarity, tier.weight), math.abs(got - tier.weight) <= tol, string.format("%.2f%%", got))
end
check("phenomena near the shown odds", math.abs(fx / N * 100 - Forge.phenomenonOdds()) < 0.5, string.format("%.2f%% vs %.2f%%", fx / N * 100, Forge.phenomenonOdds()))
check("shiny near 2%", math.abs(shiny / N * 100 - 2) < 0.6, string.format("%.2f%%", shiny / N * 100))

-- Generated marbles build into balls with their phenomena, and named ones still do.
local MarbleLook = require(Ringer.MarbleLook)
local built = 0
for _, e in ipairs(Forge.EFFECT_IDS) do
	for i = 1, 3000 do
		local id = Forge.collectibleId("Mythic", "Rsmoke" .. i)
		local c = Forge.fromId(id)
		if c and c.effect == e then
			local okb, ball = pcall(MarbleLook.make, MarbleLook.lookFor(id), 1)
			check("builds a " .. e .. " marble", okb and ball:IsA("BasePart"), not okb and ball or nil)
			if okb then
				built += 1
				ball:Destroy()
			end
			break
		end
	end
end
check("every phenomenon builds", built == #Forge.EFFECT_IDS, built)
check("named marbles still resolve", MarbleLook.lookFor("volt").name == "Volt")
check("unknown ids fall back to Ember", MarbleLook.lookFor("nope").id == "ember")

-- Melt values follow the web formula; trade-ups go up one tier; the Book reads a collection.
local Collectibles = require(game.ServerScriptService.Server.Collectibles)
local c = Forge.mint("Rdeadbeef0000beef", "Rare")
local want = math.floor(Config.MELT.Rare * (c.wear == "Mint" and 2 or c.wear == "Polished" and 1.25 or 1) * (c.shiny and 5 or 1) * (c.effect ~= "none" and 4 or 1) + 0.5)
check("melt value", Collectibles.meltValue(c) == want, Collectibles.meltValue(c))
check("trade up Rare -> Epic", Forge.nextTier("Rare") == "Epic")
check("no trade up past Mythic", Forge.nextTier("Mythic") == nil)
local some = {}
for i = 1, 200 do
	table.insert(some, Forge.mint("Rbook" .. i))
end
local rows = Forge.bookProgress(some)
check("book has 6 sets", #rows == 6, #rows)
check("200 marbles cover every rarity but maybe Mythic", #rows[3].got >= 4, #rows[3].got)

local fails = 0
for _, l in ipairs(out) do
	print(l)
	if l:sub(1, 4) == "FAIL" then
		fails += 1
	end
end
print(string.format("%d checks, %d failed", #out, fails))
return fails
