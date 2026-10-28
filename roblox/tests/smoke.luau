-- Cloud smoke test of a CHECK build: everything compiles, the server booted, the logic holds.
local out = {}
local function check(name, ok, detail)
	table.insert(out, (ok and "PASS " or "FAIL ") .. name .. (detail and (": " .. tostring(detail)) or ""))
end

-- 1. Every script compiles. (Requiring a copy runs its top level too; on a server some client
-- code fails at runtime for want of a LocalPlayer, which is fine: only parse errors count.)
for _, m in ipairs(game.ServerStorage.SyntaxCheck:GetChildren()) do
	local ok, err = pcall(require, m)
	local e = tostring(err)
	local syntax = not ok and (e:find("Expected") or e:find("Incomplete") or e:find("[Ss]yntax") or e:find("malformed") or e:find("unexpected symbol")) ~= nil
	check("compiles " .. m.Name, not syntax, (not ok) and e:sub(1, 200) or nil)
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
for _, m in ipairs(game.ServerScriptService.Server:GetChildren()) do
	mod(m)
end
local client = game.StarterPlayer.StarterPlayerScripts.ClientModules
mod(client.Kit)

mod(client.Aim)

-- 2. The server script boots (cloud test servers don't run the place's scripts, so run the
-- compiled copy's body here): remotes and the lobby exist, with no errors.
local boot = require(game.ServerStorage.SyntaxCheck["ServerScriptService.Main.server"])
local booted, bootErr = pcall(boot)
check("server script runs", booted, bootErr)
task.wait(2)
check("remotes created", Ringer:FindFirstChild("Remotes") ~= nil)
check("lobby built", workspace:FindFirstChild("Lobby") ~= nil)

-- 3. Rules.
local cross = Rules.startingCross()
check("cross has 13", #cross == 13, #cross)
check("placement outside line", Rules.placement(1).Magnitude > Config.RING_R)
local w = Rules.gameOver({ 7, 0 }, 6, 0)
check("7 of 13 locks the game", w ~= nil and w[1] == 1)
check("6-0 with 7 left is not over", Rules.gameOver({ 6, 0 }, 7, 0) == nil)
check("empty ring ends", Rules.gameOver({ 6, 7 }, 0, 0) ~= nil)

-- 4. The bot: a perfect bot's opening shot aims along a clear line at a real marble.
local plan = Bot.plan(nil, cross, Config.ARENAS.desk.rollDecel, Config.BOTS.legend, Random.new(1))
local from = Rules.placement(plan.placeAngle)
local d = Vector2.new(math.cos(plan.aimAngle), math.sin(plan.aimAngle))
local hits = false
for _, m in ipairs(cross) do
	local to = m - from
	local along = to:Dot(d)
	if along > 0 and (to - d * along).Magnitude < Config.SHOOTER_R + Config.MIB_R then
		hits = true
	end
end
check("legend bot aims at a marble", hits, string.format("power %.2f", plan.power))
check("bot power in range", plan.power > 0 and plan.power <= 1)

-- 5. A table builds, holds 13 marbles inside the ring, and tears down.
local Table = require(game.ServerScriptService.Server.Table)
local t = Table.new({ seats = { { kind = "bot", bot = "casual", name = "A", marble = "ember" }, { kind = "bot", bot = "casual", name = "B", marble = "tide" } }, arena = "ice", origin = Vector3.new(3000, 0, 0), mode = "test", seed = 1 })
local inside = 0
for _, b in ipairs(t.mibs) do
	if not Rules.isOutside(t:flat(b.Position)) then
		inside += 1
	end
end
check("table has 13 marbles in the ring", inside == 13, inside)
check("state serialises", t:state().remaining == 13)
t:destroy()

-- 6. Collectibles: bag odds add up and every pool id exists.
local total, ok = 0, true
for _, tier in ipairs(Config.BAG_ODDS) do
	total += tier.weight
	for _, id in ipairs(tier.pool) do
		ok = ok and Config.MARBLE[id] ~= nil
	end
end
check("bag odds total 100", total == 100, total)
check("bag pools are real marbles", ok)

local fails = 0
for _, l in ipairs(out) do
	print(l)
	if l:sub(1, 4) == "FAIL" then
		fails += 1
	end
end
print(string.format("%d checks, %d failed", #out, fails))
return fails
