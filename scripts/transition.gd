extends Node2D

const DUR := 5.0
const W := 1920.0
const H := 1080.0
const CY := 660.0

var _t := 0.0

func _process(delta: float) -> void:
	_t += delta
	queue_redraw()
	if _t >= DUR:
		set_process(false)
		var target: String = GameState.next_scene
		if target == "":
			target = "res://scenes/Level3.tscn"
		get_tree().change_scene_to_file(target)

func _draw() -> void:
	var p := clampf(_t / DUR, 0.0, 1.0)
	var head := p * W
	var pts := PackedVector2Array()
	pts.append(Vector2(0, CY))
	var step := 46.0
	var n := int(head / step)
	for i in range(1, n + 1):
		pts.append(Vector2(i * step, CY + (randf() * 2.0 - 1.0) * 34.0))
	pts.append(Vector2(head, CY + (randf() * 2.0 - 1.0) * 18.0))
	if pts.size() >= 2:
		draw_polyline(pts, Color(1.0, 0.85, 0.3, 0.35), 12.0)
		draw_polyline(pts, Color(1.0, 1.0, 0.78, 0.95), 4.0)
	draw_circle(Vector2(head, CY), 24.0, Color(1.0, 0.9, 0.4, 0.4))
	draw_circle(Vector2(head, CY), 11.0, Color(1.0, 1.0, 0.8, 1.0))
