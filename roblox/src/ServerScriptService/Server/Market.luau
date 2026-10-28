-- Robux: game passes (owned for good), developer products (bought again and again), Premium.
--  * ProcessReceipt is idempotent: a purchase id is recorded in the profile and saved before
--    Roblox is told it was granted, so a retry after a crash never pays out twice;
--  * passes are checked on join and granted the moment they are bought;
--  * Premium members get the Prism marble and a quarter more coins while subscribed.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Ringer.Config)
local Data = require(script.Parent.Data)
local Economy = require(script.Parent.Economy)
local Collectibles = require(script.Parent.Collectibles)

local Market = {}
Market.notify = function(_player: Player, _text: string, _kind: string?) end
Market.bagOpened = function(_player: Player, _got: any) end

local RECEIPTS_KEPT = 50

local function grantPassPerks(player: Player)
	if Economy.hasPass(player, "vip") then
		Data.update(player, function(p)
			p.owned.gold = true
		end)
		player:SetAttribute("VIP", true)
	end
	if Economy.hasPass(player, "trails") then
		player:SetAttribute("Trails", true)
	end
end

local function checkPremium(player: Player)
	if player.MembershipType == Enum.MembershipType.Premium then
		Data.update(player, function(p)
			p.owned.prism = true
		end)
	end
end

local function loadPasses(player: Player)
	local owned = {}
	for name, id in pairs(Config.PASSES) do
		if id ~= 0 then
			local ok, has = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, player.UserId, id)
			owned[name] = ok and has or false
		end
	end
	Economy.passes[player] = owned
	grantPassPerks(player)
end

local rng = Random.new()

local function processReceipt(info)
	local player = Players:GetPlayerByUserId(info.PlayerId)
	if not player then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local p = Data.await(player, 15)
	if not p or player:GetAttribute("UnsavedProfile") then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	if table.find(p.receipts, info.PurchaseId) then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end

	local product = nil
	for name, id in pairs(Config.PRODUCTS) do
		if id == info.ProductId then
			product = name
		end
	end
	if not product then
		warn("Unknown product", info.ProductId)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	if Config.PRODUCT_COINS[product] then
		Economy.give(player, Config.PRODUCT_COINS[product], "product:" .. product, true)
		Market.notify(player, string.format("+%d coins. Thanks for the support!", Config.PRODUCT_COINS[product]), "good")
	elseif product == "bag" then
		local got, why = Collectibles.openBag(player, rng)
		if not got then
			-- Restricted here (the client should never have offered it): refuse, Roblox refunds.
			Market.notify(player, why or "Couldn't open the bag.", "bad")
			return Enum.ProductPurchaseDecision.NotProcessedYet
		end
		Market.bagOpened(player, got)
	end

	Data.update(player, function(pp)
		table.insert(pp.receipts, info.PurchaseId)
		while #pp.receipts > RECEIPTS_KEPT do
			table.remove(pp.receipts, 1)
		end
	end)
	if not Data.save(player) then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

function Market.start()
	MarketplaceService.ProcessReceipt = processReceipt
	Players.PlayerAdded:Connect(function(player)
		Data.await(player)
		loadPasses(player)
		checkPremium(player)
	end)
	for _, player in ipairs(Players:GetPlayers()) do
		task.spawn(function()
			Data.await(player)
			loadPasses(player)
			checkPremium(player)
		end)
	end
	Players.PlayerRemoving:Connect(function(player)
		Economy.passes[player] = nil
	end)
	Players.PlayerMembershipChanged:Connect(checkPremium)
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, bought)
		if not bought then
			return
		end
		for name, id in pairs(Config.PASSES) do
			if id == passId then
				Economy.passes[player] = Economy.passes[player] or {}
				Economy.passes[player][name] = true
				grantPassPerks(player)
				Market.notify(player, name == "vip" and "VIP unlocked: double coins and the Golden Taw!" or "Trails unlocked!", "good")
			end
		end
	end)
end

return Market
