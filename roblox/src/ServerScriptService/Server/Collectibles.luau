-- Owning marbles: buying named ones, opening Marble Bags (generated marbles, as in the web
-- game), melting and trading them up, the Marble Book, and Limited marbles with serial numbers.
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
local Forge = require(ReplicatedStorage.Ringer.Forge)
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

--- Open a Marble Bag: a brand-new generated marble, its tier rolled by the generator with the
--- odds shown on the bag (the web game's own). Refused where paid random items are restricted.
function Collectibles.openBag(player: Player, rng: Random)
	if Collectibles.bagsRestricted(player) then
		return nil, "Marble Bags aren't available where you are."
	end
	local p = Data.get(player)
	if not p then
		return nil, "Your profile is still loading."
	end
	if #p.forged >= Config.MAX_COLLECTION then
		return nil, "Your collection is full: melt a few marbles first."
	end
	local c = Forge.mint(Forge.robloxUid(rng))
	Data.update(player, function(pp)
		table.insert(pp.forged, { id = c.id, at = os.time(), tally = 0 })
	end)
	return { id = c.id, rarity = c.tier, forged = true }
end

--- The generated marbles a player holds.
function Collectibles.forged(player: Player): { Forge.Collectible }
	local out = {}
	local p = Data.get(player)
	for _, o in ipairs(p and p.forged or {}) do
		local c = Forge.fromId(o.id)
		if c then
			table.insert(out, c)
		end
	end
	return out
end

function Collectibles.holds(player: Player, id: string): boolean
	local p = Data.get(player)
	if not p then
		return false
	end
	if p.owned[id] then
		return true
	end
	for _, o in ipairs(p.forged) do
		if o.id == id then
			return true
		end
	end
	return false
end

--- What melting a generated marble pays (the web game's meltValue).
function Collectibles.meltValue(c: Forge.Collectible): number
	local wear = if c.wear == "Mint" then 2 elseif c.wear == "Polished" then 1.25 else 1
	local fx = if c.effect ~= "none" then 4 else 1
	return math.floor(Config.MELT[c.tier] * wear * (if c.shiny then 5 else 1) * fx + 0.5)
end

local function removeForged(p, ids: { [string]: boolean })
	local kept = {}
	for _, o in ipairs(p.forged) do
		if not ids[o.id] then
			table.insert(kept, o)
		end
	end
	p.forged = kept
end

--- Melt a generated marble back into coins.
function Collectibles.melt(player: Player, id: string)
	local p = Data.get(player)
	local c = Forge.fromId(id)
	if not p or not c or not Collectibles.holds(player, id) then
		return false, "You don't own that marble."
	end
	if p.equipped == id then
		return false, "Equip another marble first."
	end
	local coins = Collectibles.meltValue(c)
	Data.update(player, function(pp)
		removeForged(pp, { [id] = true })
	end)
	Economy.give(player, coins, "melt:" .. id, true)
	return true, coins
end

--- Five generated marbles of one rarity become one brand-new marble of the next.
function Collectibles.tradeUp(player: Player, ids: { string }, rng: Random)
	local p = Data.get(player)
	if not p or typeof(ids) ~= "table" then
		return false, "Pick five of your marbles."
	end
	local set, tier = {}, nil
	for _, id in ipairs(ids) do
		if typeof(id) ~= "string" or set[id] then
			return false, "Pick five different marbles."
		end
		local c = Forge.fromId(id)
		if not c or not Collectibles.holds(player, id) then
			return false, "You don't own one of those."
		end
		if id == p.equipped then
			return false, "Your equipped marble can't be traded up."
		end
		if tier and c.tier ~= tier then
			return false, "They all need to be the same rarity."
		end
		tier = c.tier
		set[id] = true
	end
	if #ids ~= Forge.TRADE_UP_COUNT or not tier then
		return false, "Pick five of your marbles."
	end
	local up = Forge.nextTier(tier)
	if not up then
		return false, "Mythic is the top: nothing to trade up to."
	end
	local c = Forge.mint(Forge.robloxUid(rng), up)
	Data.update(player, function(pp)
		removeForged(pp, set)
		table.insert(pp.forged, { id = c.id, at = os.time(), tally = 0 })
	end)
	return true, { id = c.id, rarity = c.tier, forged = true }
end

--- Claim a finished Marble Book set: its coins, and for some sets a numbered Limited.
function Collectibles.claimBook(player: Player, setId: string)
	local p = Data.get(player)
	if not p or typeof(setId) ~= "string" then
		return false, "No such set."
	end
	if p.book[setId] then
		return false, "Already claimed."
	end
	for _, row in ipairs(Forge.bookProgress(Collectibles.forged(player))) do
		if row.set.id == setId then
			if not row.done then
				return false, "Not finished yet."
			end
			Data.update(player, function(pp)
				pp.book[setId] = true
			end)
			Economy.give(player, row.set.reward, "book:" .. setId, true)
			local limited = Config.BOOK_LIMITED[setId]
			local got = limited and Collectibles.grant(player, limited) or nil
			return true, { coins = row.set.reward, limited = got }
		end
	end
	return false, "No such set."
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
