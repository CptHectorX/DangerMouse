@tool
extends Node2D

const RADIUS := 34.0
const HIT := 46.0
const GREEN := Color(0.35, 1.0, 0.45)

func _ready() -> void:
	z_index = 62
	queue_redraw()

func _draw() -> void:
	draw_circle(Vector2.ZERO, RADIUS + 12.0, Color(0.09, 0.11, 0.12, 0.9))
	var a0 := deg_to_rad(35.0)
	var a1 := deg_to_rad(320.0)
	draw_arc(Vector2.ZERO, RADIUS, a0, a1, 48, GREEN, 8.0)
	var p := Vector2(cos(a1), sin(a1)) * RADIUS
	var tang := Vector2(-sin(a1), cos(a1))
	var rad := Vector2(cos(a1), sin(a1))
	draw_colored_polygon(PackedVector2Array([
		p + tang * 18.0,
		p + rad * 16.0,
		p - rad * 16.0
	]), GREEN)
