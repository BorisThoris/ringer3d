-- The global leaderboard: total wins in an OrderedDataStore, the top ten shown on a board in
-- the lobby and sent to clients for the menu.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Leaderboard = {}
Leaderboard.top = {} :: { { name: string, wins: number, userId: number } }
Leaderboard.updated = Instance.new("BindableEvent")

local store = nil
pcall(function()
	store = DataStoreService:GetOrderedDataStore("Wins_v1")
end)

local names: { [number]: string } = {}
local function nameOf(userId: number): string
	if names[userId] then
		return names[userId]
	end
	local ok, n = pcall(Players.GetNameFromUserIdAsync, Players, userId)
	names[userId] = ok and n or ("Player " .. userId)
	return names[userId]
end

function Leaderboard.record(player: Player, wins: number)
	if not store then
		return
	end
	task.spawn(pcall, store.SetAsync, store, tostring(player.UserId), wins)
end

function Leaderboard.refresh()
	if not store then
		return
	end
	local ok, pages = pcall(store.GetSortedAsync, store, false, 10)
	if not ok then
		return
	end
	local top = {}
	for _, entry in ipairs(pages:GetCurrentPage()) do
		local id = tonumber(entry.key)
		if id then
			table.insert(top, { userId = id, wins = entry.value, name = nameOf(id) })
		end
	end
	Leaderboard.top = top
	Leaderboard.updated:Fire(top)
end

--- A board in the world: a part with a SurfaceGui listing the top ten.
function Leaderboard.board(cf: CFrame, parent: Instance)
	local part = Instance.new("Part")
	part.Name = "Leaderboard"
	part.Anchored = true
	part.Size = Vector3.new(16, 20, 1)
	part.CFrame = cf
	part.Color = Color3.fromRGB(25, 22, 35)
	part.Material = Enum.Material.SmoothPlastic
	part.Parent = parent
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.PixelsPerStud = 40
	gui.LightInfluence = 0
	gui.Parent = part
	local list = Instance.new("TextLabel")
	list.Size = UDim2.fromScale(1, 1)
	list.BackgroundTransparency = 1
	list.TextColor3 = Color3.fromRGB(255, 240, 210)
	list.Font = Enum.Font.FredokaOne
	list.TextSize = 34
	list.TextYAlignment = Enum.TextYAlignment.Top
	list.TextXAlignment = Enum.TextXAlignment.Left
	list.Text = "  TOP WINS\n\n  (loading)"
	list.Parent = gui
	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 30)
	pad.PaddingLeft = UDim.new(0, 30)
	pad.Parent = list
	Leaderboard.updated.Event:Connect(function(top)
		local lines = { "TOP WINS", "" }
		for i, e in ipairs(top) do
			table.insert(lines, string.format("%d.  %s  —  %d", i, e.name, e.wins))
		end
		if #top == 0 then
			table.insert(lines, "Be the first!")
		end
		list.Text = table.concat(lines, "\n")
	end)
end

function Leaderboard.start()
	task.spawn(function()
		while true do
			Leaderboard.refresh()
			task.wait(90)
		end
	end)
end

return Leaderboard
