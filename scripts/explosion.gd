extends Node2D

const DUR := 0.45
var t := 0.0

func _ready() -> void:
	add_to_group("fx")
	z_index = 50

func _process(delta: float) -> void:
	t += delta
	queue_redraw()
	if t >= DUR:
		queue_free()

func _draw() -> void:
	var p := t / DUR
	var a := 1.0 - p
	var r := lerpf(8.0, 58.0, p)
	draw_circle(Vector2.ZERO, lerpf(34.0, 0.0, p), Color(1.0, 1.0, 0.7, a * 0.7))
	draw_arc(Vector2.ZERO, r, 0.0, TAU, 28, Color(1.0, 0.8, 0.2, a * 0.9), 5.0)
	for i in range(9):
		var ang := i * TAU / 9.0 + p * 2.0
		var dir := Vector2(cos(ang), sin(ang))
		var tip: Vector2 = dir * (r + randf() * 10.0)
		draw_line(dir * r * 0.45, tip, Color(1.0, 0.9, 0.4, a), 3.0)
