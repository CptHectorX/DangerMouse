@tool
extends Node2D

@export var light_index := 1

const RADIUS := 15.0
const GREEN := Color(0.3, 1.0, 0.4)

var t := 0.0

func _ready() -> void:
	z_index = 55
	queue_redraw()

func _process(delta: float) -> void:
	if Engine.is_editor_hint():
		return
	t += delta
	queue_redraw()

func _draw() -> void:
	var lit := true
	var wild := false
	if not Engine.is_editor_hint():
		var done := GameState.levels_done
		lit = light_index <= done
		wild = done >= 3
	if not lit:
		return
	var a := 1.0
	if wild:
		a = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * 14.0 + light_index * 1.7))
	draw_circle(Vector2.ZERO, RADIUS + 6.0, Color(GREEN.r, GREEN.g, GREEN.b, 0.25 * a))
	draw_circle(Vector2.ZERO, RADIUS, Color(GREEN.r, GREEN.g, GREEN.b, a))
