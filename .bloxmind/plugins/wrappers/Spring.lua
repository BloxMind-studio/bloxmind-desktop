-- Spring.lua
-- Lightweight physical Spring/Overshoot System for Procedural Animation
-- Generic damped spring with configurable Damper (bounciness) and Speed.
-- Supports Number, Vector3, and CFrame (position + Euler) via same API.
-- AI generation stays pure: AI outputs raw targets, Spring renders them physically.

local Spring = {}
Spring.__index = Spring

local function clamp(v, lo, hi)
	if v < lo then return lo elseif v > hi then return hi else return v end
end

local function isVector3(v) return typeof(v) == "Vector3" end
local function isCFrame(v) return typeof(v) == "CFrame" end
local function isNumber(v) return typeof(v) == "number" end

-- Create a new Spring. initial: Number | Vector3 | CFrame
-- config: { Damper=0.7, Speed=12 } — Damper 0-1 (0.5 bouncy, 1 critically damped), Speed 8-25 Hz
function Spring.new(initial: any, config: table?): any
	local c = config or {}
	local damper = clamp(tonumber(c.Damper or c.damper or c.Damping or 0.68) or 0.68, 0.0, 1.8)
	local speed = clamp(tonumber(c.Speed or c.speed or c.Frequency or 14) or 14, 1, 40)
	local self: any = setmetatable({}, Spring)
	self.Damper = damper
	self.Speed = speed
	self.Target = initial
	self.Position = initial
	if isVector3(initial) then
		self.Velocity = Vector3.new(0, 0, 0)
	elseif isCFrame(initial) then
		self.VelocityPos = Vector3.new(0, 0, 0)
		self.VelocityRot = Vector3.new(0, 0, 0)
		-- NOTE: rotation is decomposed fresh from Target/Position on every
		-- Update via ToEulerAnglesYXZ — no cached Euler state is kept.
	else
		self.Velocity = 0
	end
	return self
end

function Spring:SetTarget(target: any)
	self.Target = target
end

function Spring:Impulse(impulse: any)
	-- Apply instant velocity kick for overshoot/bounce on impacts/landings
	if isVector3(impulse) and isVector3(self.Velocity) then
		self.Velocity += impulse
	elseif isCFrame(impulse) then
		-- impulse as CFrame delta: decompose impulse offset
		local ok, x, y, z = pcall(function() return (impulse :: CFrame):ToEulerAnglesYXZ() end)
		if ok then self.VelocityRot += Vector3.new(x, y, z) * 8 end
		self.VelocityPos += impulse.Position * 6
	elseif isNumber(impulse) and isNumber(self.Velocity) then
		self.Velocity += impulse
	elseif isVector3(impulse) and self.VelocityPos then
		-- CFrame spring receiving vector impulse
		self.VelocityPos += impulse
		self.VelocityRot += Vector3.new(impulse.X * 0.06, impulse.Y * 0.06, impulse.Z * 0.06)
	end
end

function Spring:SetParams(damper: number?, speed: number?)
	if damper ~= nil then self.Damper = clamp(damper, 0, 1.8) end
	if speed ~= nil then self.Speed = clamp(speed, 1, 40) end
end

function Spring:Reset(pos: any?)
	if pos ~= nil then
		self.Position = pos
		self.Target = pos
	end
	if isVector3(self.Velocity) then self.Velocity = Vector3.new(0,0,0)
	elseif self.VelocityPos then
		self.VelocityPos = Vector3.new(0,0,0)
		self.VelocityRot = Vector3.new(0,0,0)
	else self.Velocity = 0 end
end

-- Update spring by dt (seconds). Returns new Position.
function Spring:Update(dt: number): any
	dt = math.min(dt, 0.033) -- clamp to 30Hz to avoid explosion
	local damper = self.Damper
	local speed = self.Speed
	local k = speed * speed
	local c = 2 * damper * speed

	if isNumber(self.Position) and isNumber(self.Target) then
		local delta: number = (self.Target :: number) - (self.Position :: number)
		local accel: number = delta * k - (self.Velocity :: number) * c
		self.Velocity = (self.Velocity :: number) + accel * dt
		self.Position = (self.Position :: number) + (self.Velocity :: number) * dt
		return self.Position
	elseif isVector3(self.Position) and isVector3(self.Target) then
		local delta: Vector3 = (self.Target :: Vector3) - (self.Position :: Vector3)
		local accel: Vector3 = delta * k - (self.Velocity :: Vector3) * c
		self.Velocity = (self.Velocity :: Vector3) + accel * dt
		self.Position = (self.Position :: Vector3) + (self.Velocity :: Vector3) * dt
		return self.Position
	elseif isCFrame(self.Position) and isCFrame(self.Target) then
		-- Position part
		local tPos: Vector3 = (self.Target :: CFrame).Position
		local pPos: Vector3 = (self.Position :: CFrame).Position
		local deltaPos: Vector3 = tPos - pPos
		local accelPos: Vector3 = deltaPos * k - self.VelocityPos * c
		self.VelocityPos += accelPos * dt
		local newPos: Vector3 = pPos + self.VelocityPos * dt

		-- Rotation part via Euler
		local okT, tx, ty, tz = pcall(function() return (self.Target :: CFrame):ToEulerAnglesYXZ() end)
		local okP, px, py, pz = pcall(function() return (self.Position :: CFrame):ToEulerAnglesYXZ() end)
		if okT and okP then
			local targetRot = Vector3.new(tx, ty, tz)
			local posRot = Vector3.new(px, py, pz)
			-- keep continuity: unwrap angles to shortest delta
			local deltaRot = targetRot - posRot
			-- normalize delta to -pi..pi
			deltaRot = Vector3.new(
				math.atan2(math.sin(deltaRot.X), math.cos(deltaRot.X)),
				math.atan2(math.sin(deltaRot.Y), math.cos(deltaRot.Y)),
				math.atan2(math.sin(deltaRot.Z), math.cos(deltaRot.Z))
			)
			local accelRot: Vector3 = deltaRot * k - self.VelocityRot * c
			self.VelocityRot += accelRot * dt
			local newRot = posRot + self.VelocityRot * dt
			self.Position = CFrame.new(newPos) * CFrame.fromEulerAnglesYXZ(newRot.X, newRot.Y, newRot.Z)
		else
			-- fallback lerp if Euler fails
			local alpha = 1 - math.exp(-speed * dt * (1 - damper * 0.5))
			self.Position = (self.Position :: CFrame):Lerp(self.Target :: CFrame, clamp(alpha, 0, 1))
		end
		return self.Position
	else
		-- Type mismatch or unsupported — snap to target
		self.Position = self.Target
		return self.Position
	end
end

-- Convenience: create a spring tuned for joint angles (slightly bouncy)
function Spring.forJoint(initial: any, intensity: number?): any
	local s = intensity or 1.0
	return Spring.new(initial, { Damper = 0.62 + (1 - math.clamp(s, 0.5, 1.5)) * 0.12, Speed = 14 + s * 3 })
end

-- Convenience: spring tuned for impact overshoot (more bouncy)
function Spring.forImpact(initial: any): any
	return Spring.new(initial, { Damper = 0.45, Speed = 18 })
end

return Spring
