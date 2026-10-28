-- Does the cloud server simulate physics? Drop and push a ball, watch it.
local RunService = game:GetService("RunService")
local floor = Instance.new("Part")
floor.Anchored = true
floor.Size = Vector3.new(200, 2, 200)
floor.Position = Vector3.new(0, -1, 0)
floor.Parent = workspace
local ball = Instance.new("Part")
ball.Shape = Enum.PartType.Ball
ball.Size = Vector3.new(2, 2, 2)
ball.Position = Vector3.new(0, 5, 0)
ball.Parent = workspace
local t0 = os.clock()
for i = 1, 30 do
	RunService.Heartbeat:Wait()
end
print(string.format("after 30 heartbeats (%.2fs): y=%.2f vy=%.2f", os.clock() - t0, ball.Position.Y, ball.AssemblyLinearVelocity.Y))
task.wait(1)
ball.AssemblyLinearVelocity = Vector3.new(40, 0, 0)
print("set v, read back", ball.AssemblyLinearVelocity)
task.wait(0.5)
print(string.format("0.5s after push: x=%.2f vx=%.2f", ball.Position.X, ball.AssemblyLinearVelocity.X))
print("RunService:IsRunning", RunService:IsRunning(), "Running?", workspace.DistributedGameTime)
return ball.Position.X
