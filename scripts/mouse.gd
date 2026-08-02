extends Sprite2D

signal landed(hop_cell)

const SLOT := 64
var g_origin := Vector2(512, 220)
var g_col_min := 0
var g_row_min := 0
var g_cols := 15
var g_rows := 9
const SIZE_PX := 96.0
const HOP_DUR := 0.26
const HOP_HEIGHT := 18.0
const HOLE_WAIT_MIN := 8.0
const HOLE_WAIT_MAX := 16.0

enum State { HOLE, EMERGE, WANDER }

var state := State.WANDER
var cell := Vector2i.ZERO
var _emerge_cell := Vector2i.ZERO
var _from := Vector2.ZERO
var _to := Vector2.ZERO
var _target := Vector2i.ZERO
var _hopping := false
var _t := 0.0
var _wait := 0.0
var _wiggle := 0.0

func _ready() -> void:
	add_to_group("mouse")
	texture = load(AssetConfig.MOUSE)
	scale = Vector2(SIZE_PX / 700.0, SIZE_PX / 700.0)
	z_index = 40

func _center(c: Vector2i) -> Vector2:
	return g_origin + Vector2(c.x * SLOT + SLOT / 2.0, c.y * SLOT + SLOT / 2.0)

func spawn_in_hole(hole_pos: Vector2, emerge_cell: Vector2i) -> void:
	state = State.HOLE
	_emerge_cell = emerge_cell
	position = hole_pos
	_hopping = false
	_wiggle = 0.0
	_wait = randf_range(HOLE_WAIT_MIN, HOLE_WAIT_MAX)

func _process(delta: float) -> void:
	if state == State.HOLE:
		_wiggle += delta
		rotation = sin(_wiggle * 5.0) * 0.14
		_wait -= delta
		if _wait <= 0.0:
			_start_emerge()
		return
	if _hopping:
		_t += delta / HOP_DUR
		if _t >= 1.0:
			position = _to
			_hopping = false
			rotation = 0.0
			if state == State.EMERGE:
				cell = _emerge_cell
				state = State.WANDER
				_wait = randf_range(0.1, 0.4)
			else:
				cell = _target
				_wait = randf_range(0.7, 1.7) if randf() < 0.4 else randf_range(0.05, 0.2)
				landed.emit(cell)
		else:
			position = _from.lerp(_to, _t) - Vector2(0, sin(_t * PI) * HOP_HEIGHT)
		return
	_wait -= delta
	if _wait > 0.35:
		_wiggle += delta
		rotation = sin(_wiggle * 6.0) * 0.18
	else:
		rotation = 0.0
	if _wait <= 0.0:
		_start_hop()

func _start_emerge() -> void:
	state = State.EMERGE
	_from = position
	_to = _center(_emerge_cell)
	_t = 0.0
	_hopping = true

func _start_hop() -> void:
	var options := []
	for d in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:
		var n: Vector2i = cell + d
		if n.x >= g_col_min and n.x < g_cols and n.y >= g_row_min and n.y < g_rows:
			options.append(n)
	if options.is_empty():
		return
	_target = options[randi() % options.size()]
	_from = position
	_to = _center(_target)
	_t = 0.0
	_hopping = true
