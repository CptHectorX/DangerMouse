extends Node2D

const FireBoom := preload("res://scripts/fire_boom.gd")
const Debris := preload("res://scripts/debris.gd")
const PieceScript := preload("res://scripts/piece.gd")
const START_SCENE := "res://scenes/Level.tscn"
const CARD_SCENE := "res://scenes/TitleCard.tscn"
const TOY := 128

const W := 1920.0
const CY := 660.0
const SWEEP := 5.0
const ROCKET_X := 1600.0

@export var card_mode := "start"
@export var card_title := "Dangermouse"
@export var card_sub := "* insert coin *"

var mode := "start"
var _t := 0.0
var _phase := "sweep"
var _rt := 0.0
var _rocket = null
var _rocket_x := ROCKET_X
var _exploded := false
var _done := false

var _toys: Array = []
var _pile: Array = []
var _held = null
var _held_vel := Vector2.ZERO
var _rain_t := 0.0

func _ready() -> void:
	mode = card_mode
	$Title.text = card_title
	_fit_title()
	$Subtitle.text = card_sub
	$Subtitle.visible = card_sub != ""
	_rocket = $Rocket
	_rocket.visible = mode == "gameover" or mode == "win"
	_rocket_x = _rocket.position.x
	if mode == "start":
		_toys = AssetConfig.JUNK + [AssetConfig.SWITCH, AssetConfig.LEVER, AssetConfig.GLOECKLER]
		_add_bounds()
		for i in range(24):
			_spawn_toy(randf_range(-1400.0, -60.0))

func _fit_title() -> void:
	var maxw := 1440.0
	var fs := 130
	var font: Font = $Title.get_theme_font("font")
	var tw: float = font.get_string_size($Title.text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	if tw > maxw:
		fs = int(fs * maxw / tw)
		$Title.add_theme_font_size_override("font_size", fs)
		$Title.add_theme_constant_override("outline_size", maxi(4, int(fs * 0.09)))

func _process(delta: float) -> void:
	_t += delta
	queue_redraw()
	if mode == "start":
		$Subtitle.modulate.a = 0.3 + 0.5 * (0.5 + 0.5 * sin(_t * 4.0))
		_pile_process(delta)
	if _phase == "sweep":
		if _t >= SWEEP:
			if mode == "start":
				_phase = "wait"
			else:
				_end_sweep()
	elif _phase == "rocket":
		_rt += delta
		_rocket_phase(delta)

func _end_sweep() -> void:
	if mode == "transition":
		_go(GameState.next_scene if GameState.next_scene != "" else "res://scenes/Level3.tscn")
	else:
		_phase = "rocket"
		_rt = 0.0

func _rocket_phase(delta: float) -> void:
	if mode == "win":
		_rocket.position.y -= (250.0 + _rt * _rt * 720.0) * delta
		_rocket.rotation = sin(_rt * 8.0) * 0.03
		if _rt > 3.2:
			_back_to_start()
	else:
		if _rt < 0.45:
			_rocket.position.y -= 130.0 * delta
			_rocket.rotation = sin(_rt * 30.0) * 0.05
		elif not _exploded:
			_exploded = true
			_explode()
		elif _rt > 2.8:
			_back_to_start()

func _explode() -> void:
	var at: Vector2 = _rocket.position
	_rocket.visible = false
	var boom = FireBoom.new()
	boom.position = at
	add_child(boom)
	var frag := [Color(0.45, 0.18, 0.14), Color(0.55, 0.55, 0.58), Color(0.3, 0.12, 0.1)]
	for i in range(60):
		var d = Debris.new()
		d.position = at + Vector2(randf_range(-40, 40), randf_range(-70, 70))
		var ang := randf() * TAU
		var spd := randf_range(200.0, 780.0)
		d.vel = Vector2(cos(ang), sin(ang)) * spd - Vector2(0, 220)
		d.spin = randf_range(-12.0, 12.0)
		d.col = frag[randi() % frag.size()]
		d.z_index = 82
		add_child(d)

func _back_to_start() -> void:
	_go(CARD_SCENE)

func _go(scene: String) -> void:
	if _done:
		return
	_done = true
	get_tree().change_scene_to_file(scene)

func _head_x() -> float:
	if mode == "start":
		return fmod(_t, SWEEP) / SWEEP * W
	var target := _rocket_x if (mode == "gameover" or mode == "win") else W
	return minf(_t / SWEEP, 1.0) * target

func _draw() -> void:
	var head := _head_x()
	var pts := PackedVector2Array()
	pts.append(Vector2(0, CY))
	var step := 46.0
	var n := int(head / step)
	for i in range(1, n + 1):
		pts.append(Vector2(i * step, CY + (randf() * 2.0 - 1.0) * 32.0))
	pts.append(Vector2(head, CY + (randf() * 2.0 - 1.0) * 16.0))
	if pts.size() >= 2:
		draw_polyline(pts, Color(1.0, 0.85, 0.3, 0.35), 12.0)
		draw_polyline(pts, Color(1.0, 1.0, 0.78, 0.95), 4.0)
	draw_circle(Vector2(head, CY), 22.0, Color(1.0, 0.9, 0.4, 0.4))
	draw_circle(Vector2(head, CY), 10.0, Color(1.0, 1.0, 0.8, 1.0))

func _add_bounds() -> void:
	var body := StaticBody2D.new()
	body.name = "Bounds"
	_add_wall(body, Vector2(960, 1130), Vector2(2200, 120))
	_add_wall(body, Vector2(-40, 540), Vector2(120, 1400))
	_add_wall(body, Vector2(1960, 540), Vector2(120, 1400))
	add_child(body)

func _add_wall(body: StaticBody2D, pos: Vector2, size: Vector2) -> void:
	var c := CollisionShape2D.new()
	var s := RectangleShape2D.new()
	s.size = size
	c.shape = s
	c.position = pos
	body.add_child(c)

func _spawn_toy(y: float) -> void:
	var tex: String = _toys[randi() % _toys.size()]
	var p := PieceScript.new()
	p.setup("junk", tex, TOY)
	p.position = Vector2(randf_range(150.0, 1770.0), y)
	p.set_rot(randi() % 4)
	p.drop(Vector2(randf_range(-60.0, 60.0), 0.0))
	add_child(p)
	p.z_index = -1
	_pile.append(p)

func _pile_process(delta: float) -> void:
	if _held != null and is_instance_valid(_held):
		var mp := get_global_mouse_position()
		_held_vel = (mp - _held.position) / maxf(delta, 0.001)
		_held.position = mp
		_held.z_index = -1
	_rain_t += delta
	if _rain_t > 0.4:
		_rain_t = 0.0
		_spawn_toy(randf_range(-320.0, -120.0))
		if _pile.size() > 64:
			var old = _pile.pop_front()
			if is_instance_valid(old):
				old.queue_free()

func _pick(pos: Vector2) -> void:
	var best = null
	var bd := 95.0
	for p in _pile:
		if is_instance_valid(p):
			var d: float = p.position.distance_to(pos)
			if d < bd:
				bd = d
				best = p
	if best != null:
		_pile.erase(best)
		best.hold()
		best.z_index = -1
		_held = best

func _release() -> void:
	if _held == null:
		return
	var p = _held
	_held = null
	p.drop(_held_vel.limit_length(1800.0))
	p.z_index = -1
	_pile.append(p)

func _unhandled_input(event: InputEvent) -> void:
	if mode != "start":
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			GameState.time_left = 300.0
			GameState.levels_done = 0
			GameState.next_scene = ""
			_go(START_SCENE)
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_pick(get_global_mouse_position())
		else:
			_release()
