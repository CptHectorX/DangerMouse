@tool
extends Node2D

const SLOT := 64
const COLS := 30
const ROWS := 17

func _ready() -> void:
	queue_redraw()

func _process(_delta: float) -> void:
	queue_redraw()

func _draw() -> void:
	var grids := get_node_or_null("../Grids")
	if grids == null:
		return
	var polys := []
	for c in grids.get_children():
		if c is Polygon2D:
			var gp := []
			for pt in c.polygon:
				gp.append(c.to_global(pt))
			polys.append(gp)
	for col in COLS:
		for row in ROWS:
			var ctr := Vector2(col * SLOT + SLOT / 2.0, row * SLOT + SLOT / 2.0)
			if _in_any(ctr, polys):
				var p := Vector2(col * SLOT, row * SLOT)
				draw_rect(Rect2(p + Vector2(1, 1), Vector2(SLOT - 2, SLOT - 2)), Color(0, 1, 1, 0.22))
				draw_rect(Rect2(p, Vector2(SLOT, SLOT)), Color(0, 1, 1, 0.6), false, 1.0)
	_draw_marker("../StartMarker", Color(0.2, 1.0, 0.3))
	_draw_marker("../GoalMarker", Color(1.0, 0.25, 0.25))

func _draw_marker(path: String, col: Color) -> void:
	var m := get_node_or_null(path)
	if m == null:
		return
	var p: Vector2 = m.global_position
	var cell := Vector2(floor(p.x / SLOT) * SLOT, floor(p.y / SLOT) * SLOT)
	draw_rect(Rect2(cell, Vector2(SLOT, SLOT)), Color(col.r, col.g, col.b, 0.5))
	draw_rect(Rect2(cell, Vector2(SLOT, SLOT)), col, false, 3.0)
	draw_circle(p, 9.0, col)

func _in_any(pt: Vector2, polys: Array) -> bool:
	for poly in polys:
		if _inpoly(pt, poly):
			return true
	return false

func _inpoly(p: Vector2, poly) -> bool:
	var n: int = poly.size()
	if n < 3:
		return false
	var ins := false
	var j := n - 1
	for i in n:
		var a: Vector2 = poly[i]
		var b: Vector2 = poly[j]
		if ((a.y > p.y) != (b.y > p.y)) and (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x):
			ins = not ins
		j = i
	return ins
