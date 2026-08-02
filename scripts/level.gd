extends Node2D

const SLOT := 64
const ORIGIN := Vector2(512, 220)
const COLS := 15
const ROWS := 9
const ENTRY := Vector2i(0, 2)
const EXIT := Vector2i(14, 8)
const START_PX := Vector2(372, 380)
const GOAL_PX := Vector2(1500, 812)

const PLACEABLE := [
	"######...######",
	"#######..######",
	"######...######",
	"#######...#####",
	"########..#####",
	"########...####",
	"#########...###",
	"##########..###",
	"##########..###",
]
const RESERVE := {"lever": 2, "straight": 1, "curve": 1, "plug": 1}

const LightningScript := preload("res://scripts/lightning.gd")
const MouseScript := preload("res://scripts/mouse.gd")
const ExplosionScript := preload("res://scripts/explosion.gd")
const PieceScript := preload("res://scripts/piece.gd")

var mice := []
var _holes := []
var board: Board

var _dyn: Node2D
var _hintbox: Node2D
var _pieces := []
var _held = null

var inventory := {"lever": 0, "straight": 0, "curve": 0, "plug": 0}

func _ready() -> void:
	_dyn = Node2D.new()
	add_child(_dyn)
	_hintbox = Node2D.new()
	_hintbox.z_index = 25
	add_child(_hintbox)
	_add_bounds()
	board = Board.new()
	board.entry = ENTRY
	board.exit = EXIT
	_holes = [
		[Vector2(415, 150), Vector2i(0, 0)],
		[Vector2(1640, 288), Vector2i(14, 1)],
		[Vector2(283, 800), Vector2i(0, 8)],
	]
	var h = _holes[randi() % _holes.size()]
	_spawn_mouse(h[0], h[1])
	_load_random_layout()

func _add_bounds() -> void:
	var flr := StaticBody2D.new()
	var fc := CollisionShape2D.new()
	var fs := RectangleShape2D.new()
	fs.size = Vector2(2400, 80)
	fc.shape = fs
	flr.position = Vector2(960, 1120)
	flr.add_child(fc)
	add_child(flr)
	for wx in [-40, 1960]:
		var wall := StaticBody2D.new()
		var wc := CollisionShape2D.new()
		var ws := RectangleShape2D.new()
		ws.size = Vector2(80, 1400)
		wc.shape = ws
		wall.position = Vector2(wx, 540)
		wall.add_child(wc)
		add_child(wall)

func _load_random_layout() -> void:
	_load_layout(Level1Layouts.LAYOUTS[randi() % Level1Layouts.LAYOUTS.size()])

func _load_layout(layout) -> void:
	board.switches.clear()
	board.cables.clear()
	board.fixed.clear()
	board.links.clear()
	for s in layout["switches"]:
		var c := Vector2i(s[0], s[1])
		if not _placeable(c):
			push_warning("Layout-Schalter im Riss/ausserhalb ignoriert: %s" % c)
			continue
		board.place_switch(c)
		board.fixed[c] = true
	for lk in layout["links"]:
		board.links.append([Vector2i(lk[0][0], lk[0][1]), Vector2i(lk[1][0], lk[1][1])])
	var res = layout["resources"]
	inventory = {
		"lever": res["lever"] + RESERVE["lever"],
		"straight": res["straight"] + RESERVE["straight"],
		"curve": res["curve"] + RESERVE["curve"],
		"plug": res["plug"] + RESERVE["plug"],
	}
	_spawn_pile()
	_rebuild()

func _spawn_pile() -> void:
	for p in _pieces:
		if is_instance_valid(p):
			p.queue_free()
	_pieces.clear()
	if _held != null and is_instance_valid(_held):
		_held.queue_free()
	_held = null
	_clear_hint()
	for kind in ["lever", "straight", "curve", "plug"]:
		for i in inventory.get(kind, 0):
			var p = _make_piece(kind)
			p.position = Vector2(randf_range(140, 1780), randf_range(-260, -20))
			p.set_rot(randi() % 4)
			p.drop(Vector2(randf_range(-30, 30), 0))
			_pieces.append(p)

func _make_piece(kind: String):
	var p = PieceScript.new()
	p.setup(kind, _kind_tex(kind), SLOT)
	add_child(p)
	return p

func _kind_tex(kind: String) -> String:
	match kind:
		"lever": return AssetConfig.LEVER
		"straight": return AssetConfig.CABLE_STRAIGHT
		"curve": return AssetConfig.CABLE_CURVE
		"plug": return AssetConfig.CABLE_PLUG
	return AssetConfig.CABLE_PLUG

func _kind_type(kind: String) -> int:
	match kind:
		"curve": return Board.Cable.CURVE
		"plug": return Board.Cable.PLUG
	return Board.Cable.STRAIGHT

func _type_kind(t: int) -> String:
	match t:
		Board.Cable.CURVE: return "curve"
		Board.Cable.PLUG: return "plug"
	return "straight"

func _process(_delta: float) -> void:
	if _held != null and is_instance_valid(_held):
		_held.position = get_global_mouse_position()
		_update_hint()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_K:
			$Grid.visible = not $Grid.visible
			return
		if event.keycode == KEY_SPACE and _held != null:
			_held.set_rot(_held.rot + 1)
			_update_hint()
			return
	if not (event is InputEventMouseButton):
		return
	if event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			if _held != null:
				return
			if has_node("ReloadButton") and event.position.distance_to($ReloadButton.position) < 46.0:
				_load_random_layout()
				return
			_pick(event.position)
		elif _held != null:
			_release(event.position)
	elif event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		if _held != null:
			_held.set_rot(_held.rot + 1)
			_update_hint()
		else:
			_rotate_placed(event.position)

func _rotate_placed(pos: Vector2) -> void:
	var cell := _cell_at(pos)
	if board.switches.has(cell) and board.switches[cell] != Board.NO_LEVER:
		board.switches[cell] = (board.switches[cell] + 1) % 4
		_rebuild()

func _pick(pos: Vector2) -> void:
	var pk = _piece_at(pos)
	if pk != null:
		_pieces.erase(pk)
		pk.hold()
		_held = pk
		return
	var cell := _cell_at(pos)
	if not _placeable(cell):
		return
	if board.cables.has(cell):
		var kind := _type_kind(board.cables[cell]["type"])
		var r: int = board.cables[cell]["rot"]
		board.cables.erase(cell)
		_rebuild()
		_held = _make_piece(kind)
		_held.set_rot(r)
		_held.hold()
		_held.position = pos
	elif board.switches.has(cell) and board.switches[cell] != Board.NO_LEVER:
		var dir: int = board.switches[cell]
		board.switches[cell] = Board.NO_LEVER
		_rebuild()
		_held = _make_piece("lever")
		_held.set_rot((dir - Board.Dir.RIGHT + 4) % 4)
		_held.hold()
		_held.position = pos

func _piece_at(pos: Vector2):
	var best = null
	var bestd := SLOT * 0.62
	for p in _pieces:
		if not is_instance_valid(p):
			continue
		var d: float = p.position.distance_to(pos)
		if d < bestd:
			bestd = d
			best = p
	return best

func _release(pos: Vector2) -> void:
	var p = _held
	_held = null
	_clear_hint()
	var cell := _cell_at(pos)
	if _snap_ok(p, cell):
		if p.kind == "lever":
			board.set_lever(cell, (p.rot + Board.Dir.RIGHT) % 4)
		else:
			board.place_cable(cell, _kind_type(p.kind), p.rot)
		p.queue_free()
		_rebuild()
		return
	p.drop(Vector2(randf_range(-40, 40), -20))
	_pieces.append(p)

func _snap_ok(p, cell: Vector2i) -> bool:
	if not _placeable(cell):
		return false
	if p.kind == "lever":
		return board.switches.has(cell) and board.switches[cell] == Board.NO_LEVER and _can_build_at(cell) and _can_lever(cell)
	return not board.switches.has(cell) and not board.cables.has(cell) and _can_build_at(cell)

func _placeable(cell: Vector2i) -> bool:
	if cell.y < 0 or cell.y >= ROWS or cell.x < 0 or cell.x >= COLS:
		return false
	return PLACEABLE[cell.y][cell.x] == "#"

func _spawn_mouse(hole_pos: Vector2, emerge_cell: Vector2i) -> void:
	var m = MouseScript.new()
	add_child(m)
	m.landed.connect(_on_mouse_landed.bind(m))
	m.spawn_in_hole(hole_pos, emerge_cell)
	mice.append(m)

func _on_mouse_landed(cell: Vector2i, m: Node) -> void:
	if board.powered_cells().has(cell):
		_explode_at(cell, m)

func _explode_at(cell: Vector2i, m: Node) -> void:
	_pop_off(cell)
	_rebuild()
	var boom = ExplosionScript.new()
	boom.position = _center(cell)
	add_child(boom)
	var hole = _holes[randi() % _holes.size()]
	m.spawn_in_hole(hole[0], hole[1])

func _pop_off(cell: Vector2i) -> void:
	if board.cables.has(cell):
		var kind := _type_kind(board.cables[cell]["type"])
		var r: int = board.cables[cell]["rot"]
		board.cables.erase(cell)
		_fly_piece(kind, r, _center(cell))
	elif board.switches.has(cell) and board.switches[cell] != Board.NO_LEVER:
		var dir: int = board.switches[cell]
		board.switches[cell] = Board.NO_LEVER
		_fly_piece("lever", (dir - Board.Dir.RIGHT + 4) % 4, _center(cell))

func _fly_piece(kind: String, rot: int, at: Vector2) -> void:
	var p = _make_piece(kind)
	p.position = at
	p.set_rot(rot)
	p.drop(Vector2(randf_range(-260, 260), randf_range(-520, -260)))
	_pieces.append(p)

func _cell_at(pos: Vector2) -> Vector2i:
	return Vector2i(int(floor((pos.x - ORIGIN.x) / SLOT)), int(floor((pos.y - ORIGIN.y) / SLOT)))

func _can_lever(cell: Vector2i) -> bool:
	for d in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:
		var mid: Vector2i = cell + d
		var far: Vector2i = cell + d * 2
		if board.switches.has(far) and not board.switches.has(mid) and not board.cables.has(mid):
			return true
	return false

func _can_build_at(cell: Vector2i) -> bool:
	if cell == ENTRY:
		return true
	var powered := board.powered_cells()
	if powered.has(cell):
		return true
	for d in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:
		var nb: Vector2i = cell + d
		if powered.has(nb):
			return true
		var far: Vector2i = cell + d * 2
		if powered.has(far) and board.switches.has(far) and not board.switches.has(nb) and not board.cables.has(nb):
			return true
	return false

func _center(cell: Vector2i) -> Vector2:
	return ORIGIN + Vector2(cell.x * SLOT + SLOT / 2.0, cell.y * SLOT + SLOT / 2.0)

func _update_hint() -> void:
	_clear_hint()
	if _held == null:
		return
	var cell := _cell_at(get_global_mouse_position())
	if not _placeable(cell):
		return
	var ok := _snap_ok(_held, cell)
	var box := ColorRect.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.size = Vector2(SLOT - 4, SLOT - 4)
	box.position = _center(cell) - Vector2(SLOT / 2.0 - 2, SLOT / 2.0 - 2)
	box.color = Color(0.3, 1.0, 0.45, 0.28) if ok else Color(1.0, 1.0, 1.0, 0.10)
	_hintbox.add_child(box)
	var powered := board.powered_cells()
	for d in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:
		var nb: Vector2i = cell + d
		if powered.has(nb):
			var dot := ColorRect.new()
			dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
			dot.size = Vector2(16, 16)
			dot.position = _center(nb) - Vector2(8, 8)
			dot.color = Color(1.0, 0.85, 0.2, 0.75)
			_hintbox.add_child(dot)

func _clear_hint() -> void:
	for c in _hintbox.get_children():
		c.free()

func _rebuild() -> void:
	for child in _dyn.get_children():
		child.free()
	var powered := board.powered_cells()
	if powered.has(EXIT) and GameState.levels_done < 1:
		GameState.levels_done = 1
	_add_pieces(powered)
	_add_lightning(powered)

func _sprite(path: String, at: Vector2, live: bool, rot_deg := 0.0) -> void:
	var s := Sprite2D.new()
	s.texture = load(path)
	s.position = at
	s.rotation_degrees = rot_deg
	s.scale = Vector2(SLOT / 128.0, SLOT / 128.0)
	s.modulate = Color(1, 1, 1) if live else Color(0.45, 0.45, 0.5)
	_dyn.add_child(s)

func _lever(at: Vector2, live: bool, dir: int) -> void:
	var s := Sprite2D.new()
	s.texture = load(AssetConfig.LEVER)
	s.centered = false
	s.offset = Vector2(0, -64)
	s.position = at
	s.rotation_degrees = (dir - Board.Dir.RIGHT) * 90.0
	s.scale = Vector2(SLOT / 128.0, SLOT / 128.0)
	s.z_index = 2
	s.modulate = Color(1, 1, 1) if live else Color(0.45, 0.45, 0.5)
	_dyn.add_child(s)

func _piece_tex(type: int) -> String:
	match type:
		Board.Cable.CURVE: return AssetConfig.CABLE_CURVE
		Board.Cable.PLUG: return AssetConfig.CABLE_PLUG
	return AssetConfig.CABLE_STRAIGHT

func _add_pieces(powered: Dictionary) -> void:
	for cell in board.cables:
		var data = board.cables[cell]
		_sprite(_piece_tex(data["type"]), _center(cell), powered.has(cell), data["rot"] * 90.0)
	for cell in board.switches:
		var live: bool = powered.has(cell)
		_sprite(AssetConfig.SWITCH, _center(cell), live)
		var lever = board.switches[cell]
		if lever != Board.NO_LEVER:
			_lever(_center(cell), live, lever)

func _add_lightning(powered: Dictionary) -> void:
	var segs := [[START_PX, _center(ENTRY)]]
	var seen := {}
	for cell in powered:
		for nb in board.neighbors(cell):
			if not powered.has(nb):
				continue
			var key := str(cell) + str(nb)
			if seen.has(key) or seen.has(str(nb) + str(cell)):
				continue
			seen[key] = true
			segs.append([_center(cell), _center(nb)])
	if powered.has(EXIT):
		segs.append([_center(EXIT), GOAL_PX])
	var bolt = LightningScript.new()
	bolt.z_index = 30
	_dyn.add_child(bolt)
	bolt.setup(segs)
