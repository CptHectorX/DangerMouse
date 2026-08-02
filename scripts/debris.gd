extends Node2D

var vel := Vector2.ZERO
var spin := 0.0
var life := 2.8
var col := Color(0.5, 0.2, 0.15)

func _process(delta: float) -> void:
	vel.y += 1100.0 * delta
	position += vel * delta
	rotation += spin * delta
	life -= delta
	if life <= 0.0:
		queue_free()
	else:
		queue_redraw()

func _draw() -> void:
	draw_colored_polygon(PackedVector2Array([Vector2(-9, 7), Vector2(9, 6), Vector2(1, -11)]), col)
