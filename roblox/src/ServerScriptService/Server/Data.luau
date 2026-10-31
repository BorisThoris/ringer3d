-- Player profiles in a DataStore: coins, stats, the marbles you own (Limiteds with their serial
-- numbers), the Tower floor you are on, the daily streak, and recent purchase receipts.
-- A profile is locked to one server while you play there, saved every few minutes, on leave
-- and at shutdown. leaderstats show Wins and Marbles in the player list.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Data = {}

local STORE = "Profiles_v1"
local LOCK_STALE = 300 -- seconds: a lock older than this belongs to a server that died
local store = nil
pcall(function()
	store = DataStoreService:GetDataStore(STORE)
end)

export type Profile = {
	coins: number,
	wins: number,
	played: number,
	captured: number,
	owned: { [string]: boolean },
	limiteds: { { id: string, serial: number } },
	-- Generated marbles from Marble Bags and trade-ups: their ids ("cR-R0123..."), when they
	-- arrived, and the captures made with each.
	forged: { { id: string, at: number, tally: number } },
	book: { [string]: boolean }, -- Marble Book sets already paid out
	equipped: string,
	tower: number, -- next floor to play (9 = cleared)
	towerBest: number,
	streak: number,
	lastDaily: number, -- day number (UTC) of the last daily claim
	receipts: { string },
	welcomed: boolean,
}

local function fresh(): Profile
	return {
		coins = 150,
		wins = 0,
		played = 0,
		captured = 0,
		owned = { ember = true },
		limiteds = {},
		forged = {},
		book = {},
		equipped = "ember",
		tower = 1,
		towerBest = 0,
		streak = 0,
		lastDaily = 0,
		receipts = {},
		welcomed = false,
	}
end

local profiles: { [Player]: Profile } = {}
local loaded = Instance.new("BindableEvent")
Data.changed = Instance.new("BindableEvent") -- (player, profile)

local function reconcile(p: any): Profile
	local base = fresh()
	for k, v in pairs(base) do
		if p[k] == nil then
			p[k] = v
		end
	end
	return p
end

local function retry<T>(fn: () -> T, tries: number?): (boolean, T?)
	local last
	for i = 1, tries or 4 do
		local ok, res = pcall(fn)
		if ok then
			return true, res
		end
		last = res
		task.wait(1.5 * i)
	end
	warn("DataStore failed:", last)
	return false, nil
end

local function key(player: Player)
	return "u_" .. player.UserId
end

function Data.get(player: Player): Profile?
	return profiles[player]
end

--- Wait for a player's profile (nil if they leave or it can't be loaded).
function Data.await(player: Player, timeout: number?): Profile?
	local t = os.clock() + (timeout or 20)
	while not profiles[player] and player.Parent and os.clock() < t do
		task.wait(0.1)
	end
	return profiles[player]
end

local function leaderstats(player: Player, p: Profile)
	local ls = player:FindFirstChild("leaderstats") or Instance.new("Folder")
	ls.Name = "leaderstats"
	local wins = ls:FindFirstChild("Wins") or Instance.new("IntValue")
	wins.Name = "Wins"
	wins.Value = p.wins
	wins.Parent = ls
	local marbles = ls:FindFirstChild("Marbles") or Instance.new("IntValue")
	marbles.Name = "Marbles"
	marbles.Value = p.captured
	marbles.Parent = ls
	ls.Parent = player
end

function Data.load(player: Player)
	local p: Profile? = nil
	if store then
		-- Take the lock: if another server holds a fresh one, wait for it to let go.
		for attempt = 1, 4 do
			local blocked = false
			local ok, res = retry(function()
				return store:UpdateAsync(key(player), function(old)
					old = old or fresh()
					local lock = old.lock
					if lock and lock.job ~= game.JobId and os.time() - lock.at < LOCK_STALE and attempt < 4 then
						blocked = true
						return nil
					end
					old.lock = { job = game.JobId, at = os.time() }
					return old
				end)
			end)
			if ok and not blocked then
				p = res
				break
			end
			if not ok then
				break
			end
			task.wait(5)
		end
	end
	if not player.Parent then
		return
	end
	if not p then
		-- No DataStore (Studio without API access) or it failed: play on a fresh profile that
		-- is never saved, rather than overwrite a real one.
		p = fresh()
		player:SetAttribute("UnsavedProfile", true)
	end
	local profile = reconcile(p)
	profile.lock = nil
	profiles[player] = profile
	leaderstats(player, profile)
	Data.changed:Fire(player, profile)
	loaded:Fire(player)
end

--- Write the profile (keeping the lock unless `release`).
function Data.save(player: Player, release: boolean?)
	local p = profiles[player]
	if not p or not store or player:GetAttribute("UnsavedProfile") then
		return true
	end
	local ok = retry(function()
		return store:UpdateAsync(key(player), function(old)
			if old and old.lock and old.lock.job ~= game.JobId and os.time() - old.lock.at < LOCK_STALE then
				return nil -- someone else owns it now; never overwrite their copy
			end
			local out = table.clone(p)
			out.lock = (not release) and { job = game.JobId, at = os.time() } or nil
			return out
		end)
	end)
	return ok
end

--- Change a profile and tell the client.
function Data.update(player: Player, fn: (Profile) -> ())
	local p = profiles[player]
	if not p then
		return
	end
	fn(p)
	leaderstats(player, p)
	Data.changed:Fire(player, p)
end

function Data.start()
	Players.PlayerAdded:Connect(function(player)
		Data.load(player)
	end)
	for _, player in ipairs(Players:GetPlayers()) do
		task.spawn(Data.load, player)
	end
	Players.PlayerRemoving:Connect(function(player)
		Data.save(player, true)
		profiles[player] = nil
	end)
	game:BindToClose(function()
		local n = 0
		for player in pairs(profiles) do
			n += 1
			task.spawn(function()
				Data.save(player, true)
				n -= 1
			end)
		end
		local t = os.clock() + 25
		while n > 0 and os.clock() < t do
			task.wait(0.1)
		end
	end)
	task.spawn(function()
		while true do
			task.wait(180)
			for player in pairs(profiles) do
				task.spawn(Data.save, player)
			end
		end
	end)
end

return Data
