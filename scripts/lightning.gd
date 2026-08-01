extends Node2D

var segments: Array = []
var t := 0.0

func setup(segs: Array) -> void:
	segments = segs

func _process(delta: float) -> void:
	t += delta
	queue_redraw()

func _draw() -> void:
	for seg in segments:
		_bolt(seg[0], seg[1])

func _bolt(a: Vector2, b: Vector2) -> void:
	var perp := (b - a).orthogonal().normalized()
	var pts := PackedVector2Array()
	pts.append(a)
	for i in range(1, 7):
		var base := a.lerp(b, float(i) / 7.0)
		pts.append(base + perp * (randf() * 2.0 - 1.0) * 7.0)
	pts.append(b)
	draw_polyline(pts, Color(1.0, 0.85, 0.3, 0.35), 8.0)
	draw_polyline(pts, Color(1.0, 1.0, 0.78, 0.95), 2.5)
	var s := a.lerp(b, fmod(t * 1.6 + a.x * 0.003, 1.0))
	draw_circle(s, 9.0, Color(1.0, 0.9, 0.4, 0.35))
	draw_circle(s, 4.5, Color(1.0, 1.0, 0.75, 0.95))
