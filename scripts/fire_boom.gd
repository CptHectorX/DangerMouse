extends Node2D

const DUR := 1.5
var t := 0.0

func _ready() -> void:
	z_index = 80

func _process(delta: float) -> void:
	t += delta
	queue_redraw()
	if t >= DUR:
		queue_free()

func _draw() -> void:
	var p := t / DUR
	var a := 1.0 - p
	draw_circle(Vector2.ZERO, lerpf(150.0, 20.0, p), Color(1.0, 1.0, 0.85, a * 0.9))
	var cols := [Color(1.0, 0.9, 0.3), Color(1.0, 0.55, 0.12), Color(0.85, 0.2, 0.1)]
	for k in range(3):
		draw_arc(Vector2.ZERO, lerpf(30.0, 300.0 - k * 55.0, p), 0.0, TAU, 44, Color(cols[k].r, cols[k].g, cols[k].b, a * 0.7), lerpf(34.0, 4.0, p))
	for i in range(30):
		var ang := i * TAU / 30.0 + p * 1.5
		var d := Vector2(cos(ang), sin(ang))
		draw_line(d * 60.0 * p, d * (270.0 + randf() * 90.0) * p, Color(1.0, 0.8, 0.35, a), 5.0)
