--!strict
-- Aura: the status score. Big plays farm it (+250 aura for a triple knockout), flops cost it
-- (-50 when your shooter flies out for nothing). It shows as a rank on the nameplate and in the
-- player list, and the server's top holder is its Main Character, lit up for everyone (Flex).
-- The rules (forShot, forGame, forRace, rank, apply) are plain functions the tests check.

local Data = require(script.Parent.Data)

local Aura = {}

export type Gain = { amount: number, reason: string }

Aura.RANKS = {
	{ at = 0, name = "NPC" },
	{ at = 500, name = "Side Character" },
	{ at = 2000, name = "Main Character" },
	{ at = 8000, name = "Aura Farmer" },
	{ at = 25000, name = "Infinite Aura" },
}
-- The least aura that can make you the server's Main Character.
Aura.MAIN_MIN = 500

--- The rank for an aura total.
function Aura.rank(points: number): string
	local name = Aura.RANKS[1].name
	for _, r in ipairs(Aura.RANKS) do
		if points >= r.at then
			name = r.name
		end
	end
	return name
end

--- One shot's aura: knockouts farm it, a shooter lost for nothing costs it.
function Aura.forShot(took: number, shooterOut: boolean): Gain?
	if took >= 4 then
		return { amount = 400 + (took - 4) * 100, reason = if took >= 5 then "UNREAL KNOCKOUT" else "QUAD KNOCKOUT" }
	elseif took == 3 then
		return { amount = 250, reason = "TRIPLE KNOCKOUT" }
	elseif took == 2 then
		return { amount = 100, reason = "DOUBLE KNOCKOUT" }
	elseif took == 0 and shooterOut then
		return { amount = -50, reason = "Shooter flew out" }
	end
	return nil
end

--- A finished game's aura for one seat: `mine`/`theirs` captures, the most it ever trailed by,
--- and whether the other seat was a real player.
function Aura.forGame(won: boolean, mine: number, theirs: number, behindBy: number, vsPlayer: boolean): { Gain }
	local out = {}
	if won then
		if theirs == 0 then
			table.insert(out, { amount = 300, reason = "FLAWLESS" })
		end
		if behindBy >= 3 then
			table.insert(out, { amount = 300, reason = "COMEBACK" })
		end
		if vsPlayer then
			table.insert(out, { amount = 150, reason = "Beat a real player" })
		end
		table.insert(out, { amount = 50, reason = "Win" })
	elseif mine == 0 then
		table.insert(out, { amount = -100, reason = "Got cooked" })
	end
	return out
end

--- A race finish's aura.
function Aura.forRace(medal: string?, newBest: boolean, beatRival: boolean): { Gain }
	local out = {}
	if medal == "Gold" then
		table.insert(out, { amount = 150, reason = "GOLD RUN" })
	end
	if beatRival then
		table.insert(out, { amount = 200, reason = "BEAT YOUR RIVAL" })
	end
	if newBest then
		table.insert(out, { amount = 75, reason = "New best" })
	end
	return out
end

--- A total after gains: never below zero.
function Aura.apply(total: number, gains: { Gain }): number
	for _, g in ipairs(gains) do
		total = math.max(0, total + g.amount)
	end
	return total
end

-- Wired by Main: the remote that shows the popup, and a hook run after any change (nameplate,
-- Main Character). Tests leave both nil.
Aura.remote = nil :: RemoteEvent?
Aura.changed = nil :: ((Player) -> ())?
Aura.log = {} :: { any } -- recent gains (tests read it)

--- Give a player gains: saved, shown to them, and passed to `changed`. Returns the new total.
function Aura.give(player: Player, gains: { Gain }, delay: number?): number?
	if #gains == 0 then
		return nil
	end
	local p = Data.get(player)
	if not p then
		return nil
	end
	local before = p.aura or 0
	local after = Aura.apply(before, gains)
	Data.update(player, function(pp)
		pp.aura = after
	end)
	table.insert(Aura.log, { player = player, gains = gains, total = after })
	if #Aura.log > 50 then
		table.remove(Aura.log, 1)
	end
	if typeof(player) ~= "Instance" then
		return after
	end
	player:SetAttribute("AuraPoints", after)
	local function show()
		if Aura.remote and player.Parent then
			Aura.remote:FireClient(player, gains, after, Aura.rank(after), Aura.rank(before) ~= Aura.rank(after) and after > before)
		end
	end
	if delay and delay > 0 then
		task.delay(delay, show)
	else
		show()
	end
	if Aura.changed then
		Aura.changed(player)
	end
	return after
end

--- The server's Main Character among `players`: the most aura, at least MAIN_MIN (nil if none).
function Aura.mainOf(entries: { { id: number, aura: number } }): number?
	local best, bestId = Aura.MAIN_MIN - 1, nil
	for _, e in ipairs(entries) do
		if e.aura > best then
			best, bestId = e.aura, e.id
		end
	end
	return bestId
end

return Aura
