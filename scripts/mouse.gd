extends Sprite2D

signal landed(hop_cell)

const SLOT := 64
const ORIGIN := Vector2(512, 220)
const COLS := 15
const ROWS := 9
const SIZE_PX := 96.0
const HOP_DUR := 0.26
const HOP_HEIGHT := 18.0

var cell := Vector2i.ZERO
var _from := Vector2.ZERO
var _to := Vector2.ZERO
var _target := Vector2i.ZERO
var _hopping := false
var _t := 0.0
var _wait := 0.0
var _wiggle := 0.0

func _ready() -> void:
	texture = load(AssetConfig.MOUSE)
	scale = Vector2(SIZE_PX / 700.0, SIZE_PX / 700.0)
	z_index = 40
	cell = Vector2i(randi() % COLS, randi() % ROWS)
	position = _center(cell)
	_wait = randf_range(0.3, 0.9)

func _center(c: Vector2i) -> Vector2:
	return ORIGIN + Vector2(c.x * SLOT + SLOT / 2.0, c.y * SLOT + SLOT / 2.0)

func _process(delta: float) -> void:
	if _hopping:
		_t += delta / HOP_DUR
		if _t >= 1.0:
			position = _to
			cell = _target
			_hopping = false
			rotation = 0.0
			_wait = randf_range(0.7, 1.7) if randf() < 0.4 else randf_range(0.05, 0.2)
			landed.emit(cell)
		else:
			position = _from.lerp(_to, _t) - Vector2(0, sin(_t * PI) * HOP_HEIGHT)
	else:
		_wait -= delta
		if _wait > 0.35:
			_wiggle += delta
			rotation = sin(_wiggle * 6.0) * 0.18
		else:
			rotation = 0.0
		if _wait <= 0.0:
			_start_hop()

func reset_to(c: Vector2i) -> void:
	cell = c
	position = _center(c)
	_hopping = false
	_t = 0.0
	rotation = 0.0
	_wait = randf_range(0.4, 1.0)

func _start_hop() -> void:
	var options := []
	for d in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:
		var n: Vector2i = cell + d
		if n.x >= 0 and n.x < COLS and n.y >= 0 and n.y < ROWS:
			options.append(n)
	if options.is_empty():
		return
	_target = options[randi() % options.size()]
	_from = position
	_to = _center(_target)
	_t = 0.0
	_hopping = true
