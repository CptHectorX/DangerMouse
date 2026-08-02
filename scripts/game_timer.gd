@tool
extends Node2D

const TOTAL := 300.0
const DW := 40.0
const DH := 72.0
const ST := 10.0
const GAP := 6.0
const PAD := 24.0
const DIGITS := [
	[true, true, true, true, true, true, false],
	[false, true, true, false, false, false, false],
	[true, true, false, true, true, false, true],
	[true, true, true, true, false, false, true],
	[false, true, true, false, false, true, true],
	[true, false, true, true, false, true, true],
	[true, false, true, true, true, true, true],
	[true, true, true, false, false, false, false],
	[true, true, true, true, true, true, true],
	[true, true, true, true, false, true, true],
]

const INTRO := 1.6

var t := TOTAL
var _intro := 0.0
var _over := false

func _ready() -> void:
	add_to_group("timer")
	z_index = 60
	if not Engine.is_editor_hint():
		t = GameState.time_left
		_intro = INTRO
	queue_redraw()

func current_color() -> Color:
	return _color()

func _process(delta: float) -> void:
	if Engine.is_editor_hint():
		return
	if _intro > 0.0:
		_intro -= delta
		visible = (int((INTRO - _intro) / 0.26) % 2) == 0
		return
	visible = true
	if t > 0.0:
		t = maxf(0.0, t - delta)
	GameState.time_left = t
	if t <= 0.0 and not _over:
		_over = true
		get_tree().change_scene_to_file("res://scenes/GameOver.tscn")
		return
	queue_redraw()

func _digit_x(i: int) -> float:
	match i:
		0: return PAD
		1: return PAD + DW + 14.0
		2: return PAD + DW + 48.0
		3: return PAD + DW + DW + 62.0
	return 0.0

func _color() -> Color:
	if t > 170.0:
		return Color(0.25, 1.0, 0.35)
	if t > 60.0:
		return Color(1.0, 0.6, 0.1)
	return Color(1.0, 0.22, 0.22)

func _draw() -> void:
	var total_w := _digit_x(3) + DW + PAD
	var total_h := DH + PAD * 2.0
	draw_rect(Rect2(0, 0, total_w, total_h), Color(0.16, 0.17, 0.19))
	draw_rect(Rect2(6, 6, total_w - 12, total_h - 12), Color(0.08, 0.09, 0.10))
	var on := _color()
	var off := Color(on.r, on.g, on.b, 0.13)
	var mins := int(t) / 60
	var secs := int(t) % 60
	_digit(_digit_x(0), PAD, mins, on, off)
	_colon(_digit_x(1), PAD, on)
	_digit(_digit_x(2), PAD, secs / 10, on, off)
	_digit(_digit_x(3), PAD, secs % 10, on, off)

func _digit(x: float, y: float, d: int, on: Color, off: Color) -> void:
	var s: Array = DIGITS[d]
	var midy := y + DH / 2.0
	_hbar(x + GAP, x + DW - GAP, y, on if s[0] else off)
	_vbar(x + DW, y + GAP, midy - GAP, on if s[1] else off)
	_vbar(x + DW, midy + GAP, y + DH - GAP, on if s[2] else off)
	_hbar(x + GAP, x + DW - GAP, y + DH, on if s[3] else off)
	_vbar(x, midy + GAP, y + DH - GAP, on if s[4] else off)
	_vbar(x, y + GAP, midy - GAP, on if s[5] else off)
	_hbar(x + GAP, x + DW - GAP, midy, on if s[6] else off)

func _hbar(l: float, r: float, cy: float, c: Color) -> void:
	var h := ST / 2.0
	draw_colored_polygon(PackedVector2Array([
		Vector2(l, cy), Vector2(l + h, cy - h), Vector2(r - h, cy - h),
		Vector2(r, cy), Vector2(r - h, cy + h), Vector2(l + h, cy + h)
	]), c)

func _vbar(cx: float, top: float, bot: float, c: Color) -> void:
	var h := ST / 2.0
	draw_colored_polygon(PackedVector2Array([
		Vector2(cx, top), Vector2(cx - h, top + h), Vector2(cx - h, bot - h),
		Vector2(cx, bot), Vector2(cx + h, bot - h), Vector2(cx + h, top + h)
	]), c)

func _colon(x: float, y: float, c: Color) -> void:
	draw_circle(Vector2(x + 10, y + DH * 0.34), 5.5, c)
	draw_circle(Vector2(x + 10, y + DH * 0.66), 5.5, c)
