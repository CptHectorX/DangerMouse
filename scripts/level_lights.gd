extends Node2D

const OFFSETS := [Vector2(-48, 0), Vector2(0, 0), Vector2(48, 0)]
const RADIUS := 15.0

var t := 0.0

func _ready() -> void:
	add_to_group("keep")
	z_index = 55

func _process(delta: float) -> void:
	t += delta
	queue_redraw()

func _draw() -> void:
	var col := Color(0.25, 1.0, 0.35)
	var tm = get_tree().get_first_node_in_group("timer")
	if tm:
		col = tm.current_color()
	var pulse := 0.35 + 0.65 * (0.5 + 0.5 * sin(t * 1.8))
	for off in OFFSETS:
		draw_circle(off, RADIUS + 5.0, Color(col.r, col.g, col.b, 0.22 * pulse))
		draw_circle(off, RADIUS, Color(col.r, col.g, col.b, pulse))
