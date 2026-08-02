extends Node2D

var lit := false

func set_lit(v: bool) -> void:
	if v != lit:
		lit = v
		queue_redraw()

func _draw() -> void:
	var col := Color(0.35, 0.95, 0.4) if lit else Color(0.92, 0.22, 0.16)
	var w := 27.0
	var h := 18.0
	draw_rect(Rect2(-w / 2.0, -h / 2.0, w, h), col)
	draw_circle(Vector2(-w / 2.0, 0), h / 2.0, col)
	draw_circle(Vector2(w / 2.0, 0), h / 2.0, col)
	if lit:
		draw_circle(Vector2(0, 0), h / 2.0 + 6.0, Color(0.4, 1.0, 0.5, 0.22))
