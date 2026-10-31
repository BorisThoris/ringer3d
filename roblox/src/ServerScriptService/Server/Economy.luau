-- Coins, badges and analytics in one place, so every grant is counted the same way.
--  * coins: VIP doubles them, Premium adds a quarter (Roblox pays Premium engagement payouts,
--    so Premium players are worth rewarding);
--  * badges: awarded once each, if the badge exists (its id is set in Config);
--  * analytics: every coin in and out is an economy event; Tower floors are progression
--    events; the first minutes are an onboarding funnel.

local AnalyticsService = game:GetService("AnalyticsService")
local BadgeService = game:GetService("BadgeService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Ringer.Config)
local Data = require(script.Parent.Data)

local Economy = {}

-- Who owns which pass, filled in by Market.
Economy.passes = {} :: { [Player]: { [string]: boolean } }

function Economy.hasPass(player: Player, pass: string): boolean
	local p = Economy.passes[player]
	return p ~= nil and p[pass] == true
end

function Economy.multiplier(player: Player): number
	local m = 1
	if Economy.hasPass(player, "vip") then
		m *= Config.VIP_MULTIPLIER
	end
	if player.MembershipType == Enum.MembershipType.Premium then
		m *= Config.PREMIUM_MULTIPLIER
	end
	return m
end

local function economyEvent(player: Player, flow: Enum.AnalyticsEconomyFlowType, amount: number, balance: number, kind: string, sku: string)
	pcall(function()
		AnalyticsService:LogEconomyEvent(player, flow, "Coins", amount, balance, kind, sku)
	end)
end

--- Give coins earned in play (multiplied), or bought (`raw`, never multiplied).
function Economy.give(player: Player, amount: number, sku: string, raw: boolean?): number
	local n = raw and amount or math.floor(amount * Economy.multiplier(player) + 0.5)
	local balance = 0
	Data.update(player, function(p)
		p.coins += n
		balance = p.coins
	end)
	economyEvent(player, Enum.AnalyticsEconomyFlowType.Source, n, balance, string.sub(sku, 1, 8) == "product:" and Enum.AnalyticsEconomyTransactionType.IAP.Name or Enum.AnalyticsEconomyTransactionType.Gameplay.Name, sku)
	return n
end

--- Spend coins; false if there aren't enough.
function Economy.spend(player: Player, amount: number, sku: string): boolean
	local p = Data.get(player)
	if not p or p.coins < amount then
		return false
	end
	local balance = 0
	Data.update(player, function(pp)
		pp.coins -= amount
		balance = pp.coins
	end)
	economyEvent(player, Enum.AnalyticsEconomyFlowType.Sink, amount, balance, Enum.AnalyticsEconomyTransactionType.Shop.Name, sku)
	return true
end

function Economy.badge(player: Player, name: string)
	local id = Config.BADGES[name]
	if not id or id == 0 then
		return
	end
	task.spawn(function()
		local ok, has = pcall(BadgeService.UserHasBadgeAsync, BadgeService, player.UserId, id)
		if ok and not has then
			pcall(BadgeService.AwardBadge, BadgeService, player.UserId, id)
		end
	end)
end

function Economy.progression(player: Player, floor: number, status: Enum.AnalyticsProgressionType)
	pcall(function()
		AnalyticsService:LogProgressionEvent(player, "Tower", status, floor)
	end)
end

function Economy.funnel(player: Player, step: number, name: string)
	pcall(function()
		AnalyticsService:LogOnboardingFunnelStepEvent(player, step, name)
	end)
end

return Economy
