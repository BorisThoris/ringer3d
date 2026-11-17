-- Injected into the play-mode test place only (run.ps1): runs in the game's own VM, so it shares
-- the live modules (a plugin's require gets separate copies with no profiles).
local Players = game:GetService("Players")
local Server = script.Parent:WaitForChild("Server")
local function log(...) print("[playmode]", ...) end
local ok, err = pcall(function()
	local Aura = require(Server.Aura)
	local Data = require(Server.Data)
	local player = Players:GetPlayers()[1] or Players.PlayerAdded:Wait()
	local p = Data.await(player, 30)
	log("hook profile", p ~= nil, p and p.aura)
	-- The player may be the owner's real account: put aura back before the profile saves.
	local original = p and p.aura or 0
	local restored = false
	local function restore()
		if restored then return end
		restored = true
		Data.update(player, function(pp) pp.aura = original end)
		log("restored aura to", original)
	end
	game:BindToClose(restore)
	task.wait(14)
	Aura.give(player, { { amount = 250, reason = "TRIPLE KNOCKOUT" } })
	log("gave 250")
	task.wait(6)
	Aura.give(player, { { amount = 300, reason = "FLAWLESS" }, { amount = 150, reason = "Beat a real player" }, { amount = 50, reason = "Win" } })
	log("gave 500", player:GetAttribute("MainCharacter"))
	task.wait(8)
	Aura.give(player, { { amount = -50, reason = "Shooter flew out" } })
	log("took 50")
	task.wait(8)
	log("hook done", Data.get(player) and Data.get(player).aura, player:GetAttribute("MainCharacter"))
	restore()
end)
log("hook end", ok, err)
workspace:SetAttribute("PlayModeDone", true)
