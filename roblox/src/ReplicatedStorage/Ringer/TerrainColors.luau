-- The game's terrain palette: bright toy-box colours (kids first), and a cool blue-grey rock that
-- matches the race's low-poly peaks. Applied by the server at start; the scene previews apply it
-- too, so they show the colours players see.
local TerrainColors = {}

TerrainColors.COLORS = {
	[Enum.Material.Grass] = Color3.fromRGB(96, 205, 70),
	[Enum.Material.Sand] = Color3.fromRGB(240, 214, 150),
	[Enum.Material.Snow] = Color3.fromRGB(245, 250, 255),
	[Enum.Material.Ground] = Color3.fromRGB(150, 132, 110),
	[Enum.Material.Rock] = Color3.fromRGB(128, 140, 168),
}

function TerrainColors.apply(terrain: Terrain)
	for material, color in pairs(TerrainColors.COLORS) do
		terrain:SetMaterialColor(material, color)
	end
end

return TerrainColors
