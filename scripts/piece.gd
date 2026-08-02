extends RigidBody2D

var kind := "plug"
var rot := 0

func setup(k: String, tex: String, slot: int) -> void:
	kind = k
	z_index = 6
	continuous_cd = RigidBody2D.CCD_MODE_CAST_RAY
	var spr := Sprite2D.new()
	spr.name = "Spr"
	spr.texture = load(tex)
	var tw: float = maxf(1.0, float(spr.texture.get_width()))
	spr.scale = Vector2(float(slot) / tw, float(slot) / tw)
	spr.z_index = 1
	add_child(spr)
	var col := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(slot * 0.82, slot * 0.82)
	col.shape = shape
	add_child(col)
	var pm := PhysicsMaterial.new()
	pm.friction = 0.75
	pm.bounce = 0.12
	physics_material_override = pm

func set_rot(r: int) -> void:
	rot = ((r % 4) + 4) % 4
	rotation_degrees = rot * 90.0

func hold() -> void:
	freeze = true
	z_index = 50
	collision_layer = 0
	collision_mask = 0
	linear_velocity = Vector2.ZERO
	angular_velocity = 0.0

func drop(vel: Vector2) -> void:
	freeze = false
	z_index = 6
	collision_layer = 1
	collision_mask = 1
	linear_velocity = vel
	angular_velocity = randf_range(-4.0, 4.0)
