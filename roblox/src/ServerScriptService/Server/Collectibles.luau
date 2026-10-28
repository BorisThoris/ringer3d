-- Owning marbles: buying them, opening Marble Bags, and Limited marbles with serial numbers.
--
-- Limiteds are Roblox's own kind of "only so many exist": each edition has a fixed supply, and
-- every copy is stamped with its serial (#1, #2, ...) from a global counter in a DataStore, so no
-- two players ever hold the same number. (NFTs and blockchain items are against Roblox's rules;
-- this is how the platform's own top games do scarce collectibles.)
--
-- Bags hold random marbles. Paid random items are restricted in some countries: the server asks
-- PolicyService for each player and refuses bags where they are restricted (the client hides
-- them). The odds are always shown before buying.

local DataStoreService = game:GetService("DataStoreService")
local PolicyService = game:GetService("PolicyService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Ringer.Config)
local Data = require(script.Parent.Data)
local Economy = require(script.Parent.Economy)

local Collectibles = {}

local serials = nil
pcall(function()
	serials = DataStoreService:GetDataStore("Serials_v1")
end)

--- Take the next serial for a Limited edition, or nil if it has sold out (or can't be reached).
function Collectibles.mint(id: string): number?
	local look = Config.MARBLE[id]
	if not look or not look.supply or not serials then
		return nil
	end
	local serial = nil
	local ok = pcall(function()
		serials:UpdateAsync(id, function(n)
			n = n or 0
			if n >= look.supply then
				serial = nil
				return nil
			end
			serial = n + 1
			return serial
		end)
	end)
	return ok and serial or nil
end

--- How many of each Limited have been minted (for the shop's "312 / 500 left" label).
function Collectibles.minted(): { [string]: number }
	local out = {}
	for _, look in ipairs(Config.MARBLES) do
		if look.supply and serials then
			local ok, n = pcall(serials.GetAsync, serials, look.id)
			out[look.id] = ok and n or 0
		end
	end
	return out
end

local restricted: { [Player]: boolean } = {}

--- Are paid random items (bags) restricted for this player? Unknown counts as restricted.
function Collectibles.bagsRestricted(player: Player): boolean
	if restricted[player] == nil then
		local ok, info = pcall(PolicyService.GetPolicyInfoForPlayerAsync, PolicyService, player)
		restricted[player] = not ok or info.ArePaidRandomItemsRestricted
	end
	return restricted[player]
end

function Collectibles.forget(player: Player)
	restricted[player] = nil
end

--- Give a marble. Returns what was given: { id, serial? , duplicate coins? }.
function Collectibles.grant(player: Player, id: string)
	local look = Config.MARBLE[id]
	if not look then
		return nil
	end
	if look.supply then
		local serial = Collectibles.mint(id)
		if not serial then
			return nil -- sold out: the caller rerolls
		end
		Data.update(player, function(p)
			table.insert(p.limiteds, { id = id, serial = serial })
			p.owned[id] = true
		end)
		Economy.badge(player, "limited")
		return { id = id, serial = serial }
	end
	local p = Data.get(player)
	if p and p.owned[id] then
		local coins = Config.DUPLICATE_COINS[look.rarity] or 0
		if coins > 0 then
			Economy.give(player, coins, "duplicate:" .. id, true)
		end
		return { id = id, duplicate = coins }
	end
	Data.update(player, function(pp)
		pp.owned[id] = true
	end)
	return { id = id }
end

--- Roll a bag. `paid` bags (with coins) check the policy; a bag bought for Robux is checked
--- by the client before it prompts and again here.
function Collectibles.openBag(player: Player, rng: Random)
	if Collectibles.bagsRestricted(player) then
		return nil, "Marble Bags aren't available where you are."
	end
	for _ = 1, 4 do
		local total = 0
		for _, tier in ipairs(Config.BAG_ODDS) do
			total += tier.weight
		end
		local roll = rng:NextNumber() * total
		local tier = Config.BAG_ODDS[#Config.BAG_ODDS]
		for _, t in ipairs(Config.BAG_ODDS) do
			roll -= t.weight
			if roll <= 0 then
				tier = t
				break
			end
		end
		local id = tier.pool[rng:NextInteger(1, #tier.pool)]
		local got = Collectibles.grant(player, id)
		if got then
			got.rarity = tier.rarity
			return got
		end
		-- A sold-out Limited: roll again.
	end
	return Collectibles.grant(player, "rime")
end

function Collectibles.buy(player: Player, id: string)
	local look = Config.MARBLE[id]
	local p = Data.get(player)
	if not look or not look.price or not p then
		return false, "Not for sale."
	end
	if p.owned[id] then
		return false, "You already own " .. look.name .. "."
	end
	if not Economy.spend(player, look.price, "marble:" .. id) then
		return false, "Not enough coins."
	end
	Collectibles.grant(player, id)
	return true
end

return Collectibles
