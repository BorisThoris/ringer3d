-- How long the bots think on the Tower's real floors, and whether thinking stalls the server:
-- each think alone, then three at once, with the worst gap between Heartbeats while they run.
-- node roblox/scripts/run-luau.mjs roblox/tests/think.luau <version>
local RunService = game:GetService("RunService")
local Ringer = game.ReplicatedStorage.Ringer
local Config = require(Ringer.Config)
local Bot = require(Ringer.Bot)
local Sim = require(Ringer.Sim)
local Surfaces = require(Ringer.Surfaces)
local Maps = require(Ringer.Maps)
local Rules = require(Ringer.Rules)
local Table = require(game.ServerScriptService.Server.Table)

local out = {}
local fails = 0
local function check(name, ok, detail)
	local l = (ok and "PASS " or "FAIL ") .. name .. (detail and (": " .. tostring(detail)) or "")
	table.insert(out, l)
	if not ok then
		fails += 1
	end
end

local FLOORS = { 5, 6, 7, 8 } -- skilled on gravel, expert on ice, master on sand, legend on ice
local function ctxFor(floor)
	local st = Config.TOWER[floor]
	local map = Maps.generate(st.arena, st.difficulty, st.mapSeed)
	return { layout = Sim.startingLayout(), firstShot = true, seatAngle = Rules.seatAngle(2, 2), surface = Surfaces[st.arena], pieces = map.pieces }, Config.BOTS[st.bot], st
end

local worstGap, last = 0, os.clock()
local hb = RunService.Heartbeat:Connect(function()
	local now = os.clock()
	worstGap = math.max(worstGap, now - last)
	last = now
end)

for _, f in ipairs(FLOORS) do
	local ctx, profile, st = ctxFor(f)
	worstGap, last = 0, os.clock()
	local t0 = os.clock()
	Bot.plan(ctx, profile, Bot.rng(1, 0, 1), Table.slicer())
	local secs = os.clock() - t0
	check(string.format("floor %d %s on %s thinks in time", f, st.bot, st.arena), secs < 8, string.format("%.2fs, worst frame %.0f ms", secs, worstGap * 1000))
	check(string.format("floor %d think never stalls a frame", f), worstGap < 0.1, string.format("%.0f ms", worstGap * 1000))
end

-- Three tables thinking at once.
worstGap, last = 0, os.clock()
local done, times = 0, {}
local t0 = os.clock()
for i, f in ipairs({ 6, 7, 8 }) do
	task.spawn(function()
		local ctx, profile = ctxFor(f)
		local s = os.clock()
		Bot.plan(ctx, profile, Bot.rng(2, 0, 1), Table.slicer())
		times[i] = os.clock() - s
		done += 1
	end)
end
while done < 3 and os.clock() - t0 < 120 do
	task.wait(0.05)
end
check("three bots at once finish", done == 3, string.format("%.2fs %.2fs %.2fs", times[1] or -1, times[2] or -1, times[3] or -1))
check("three at once never stall a frame", worstGap < 0.12, string.format("%.0f ms", worstGap * 1000))
hb:Disconnect()

for _, l in ipairs(out) do
	print(l)
end
print(string.format("%d checks, %d failed", #out, fails))
return fails
