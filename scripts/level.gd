extends Node2D

const SLOT := 64
const ORIGIN := Vector2(512, 220)
const COLS := 15
const ROWS := 9
const ENTRY := Vector2i(0, 2)
const EXIT := Vector2i(14, 8)
const START_PX := Vector2(372, 380)
const GOAL_PX := Vector2(1500, 812)

const TRAY := ["switch", "lever", "straight", "curve", "plug"]
const TRAY_NAME := {"switch": "Schalter", "lever": "Hebel", "straight": "Kabel |", "curve": "Kabel L", "plug": "Stecker"}
const LightningScript := preload("res://scripts/lightning.gd")
const MouseScript := preload("res://scripts/mouse.gd")
const ExplosionScript := preload("res://scripts/explosion.gd")

var mice := []
var _holes := []
var board: Board
var _dyn: Node2D

func _ready() -> void:
	_dyn = Node2D.new()
	add_child(_dyn)
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
	_rebuild()

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
	for c in [cell, cell + Vector2i(0, -1), cell + Vector2i(1, 0), cell + Vector2i(0, 1), cell + Vector2i(-1, 0)]:
		if board.fixed.has(c):
			if board.switches.has(c) and board.switches[c] != Board.NO_LEVER:
				inventory["lever"] += 1
				board.switches[c] = Board.NO_LEVER
		else:
			_remove(c)
	_rebuild()
	var boom = ExplosionScript.new()
	boom.position = _center(cell)
	add_child(boom)
	var hole = _holes[randi() % _holes.size()]
	m.spawn_in_hole(hole[0], hole[1])

var inventory := {"switch": 14, "lever": 12, "straight": 22, "curve": 10, "plug": 6}
var active := "switch"

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_K:
		$Grid.visible = not $Grid.visible
		return
	if not (event is InputEventMouseButton and event.pressed):
		return
	if event.button_index == MOUSE_BUTTON_LEFT:
		for i in TRAY.size():
			if _tray_rect(i).has_point(event.position):
				active = TRAY[i]
				_rebuild()
				return
		_left_grid(event.position)
	elif event.button_index == MOUSE_BUTTON_RIGHT:
		_right_grid(event.position)

func _cell_at(pos: Vector2) -> Vector2i:
	return Vector2i(int(floor((pos.x - ORIGIN.x) / SLOT)), int(floor((pos.y - ORIGIN.y) / SLOT)))

func _in_grid(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.x < COLS and cell.y >= 0 and cell.y < ROWS

func _left_grid(pos: Vector2) -> void:
	var cell := _cell_at(pos)
	if not _in_grid(cell):
		return
	if active == "lever":
		if board.switches.has(cell) and board.switches[cell] == Board.NO_LEVER and inventory["lever"] > 0:
			board.set_lever(cell, Board.Dir.RIGHT)
			inventory["lever"] -= 1
			_rebuild()
		return
	if board.switches.has(cell) or board.cables.has(cell):
		_remove(cell)
		_rebuild()
		return
	if inventory[active] <= 0:
		return
	match active:
		"switch": board.place_switch(cell)
		"straight": board.place_cable(cell, Board.Cable.STRAIGHT)
		"curve": board.place_cable(cell, Board.Cable.CURVE)
		"plug": board.place_cable(cell, Board.Cable.PLUG)
	inventory[active] -= 1
	_rebuild()

func _right_grid(pos: Vector2) -> void:
	var cell := _cell_at(pos)
	if not _in_grid(cell):
		return
	if board.switches.has(cell) and board.switches[cell] != Board.NO_LEVER:
		board.switches[cell] = (board.switches[cell] + 1) % 4
		_rebuild()
	elif board.cables.has(cell):
		board.cables[cell]["rot"] = (board.cables[cell]["rot"] + 1) % 4
		_rebuild()

func _remove(cell: Vector2i) -> void:
	if board.switches.has(cell):
		if board.switches[cell] != Board.NO_LEVER:
			inventory["lever"] += 1
		inventory["switch"] += 1
		board.switches.erase(cell)
	elif board.cables.has(cell):
		match board.cables[cell]["type"]:
			Board.Cable.STRAIGHT: inventory["straight"] += 1
			Board.Cable.CURVE: inventory["curve"] += 1
			Board.Cable.PLUG: inventory["plug"] += 1
		board.cables.erase(cell)

func _center(cell: Vector2i) -> Vector2:
	return ORIGIN + Vector2(cell.x * SLOT + SLOT / 2.0, cell.y * SLOT + SLOT / 2.0)

func _rebuild() -> void:
	for child in _dyn.get_children():
		child.free()
	var powered := board.powered_cells()
	_add_pieces(powered)
	_add_lightning(powered)
	_add_tray()
	_add_hud(board.is_goal_powered())

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

func _tray_rect(i: int) -> Rect2:
	return Rect2(520 + i * 150, 958, 96, 96)

func _card_tex(type: String) -> String:
	match type:
		"switch": return AssetConfig.SWITCH
		"lever": return AssetConfig.LEVER
		"straight": return AssetConfig.CABLE_STRAIGHT
		"curve": return AssetConfig.CABLE_CURVE
		"plug": return AssetConfig.CABLE_PLUG
	return AssetConfig.SWITCH

func _add_tray() -> void:
	for i in TRAY.size():
		var type: String = TRAY[i]
		var rect := _tray_rect(i)
		var box := ColorRect.new()
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.position = rect.position
		box.size = rect.size
		box.color = Color(1, 0.9, 0.3, 0.35) if type == active else Color(0, 0, 0, 0.45)
		_dyn.add_child(box)
		var s := Sprite2D.new()
		s.texture = load(_card_tex(type))
		s.position = rect.position + Vector2(48, 40)
		s.scale = Vector2(0.5, 0.5)
		_dyn.add_child(s)
		var label := Label.new()
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.text = "%s\n%s x%d" % [str(i + 1), TRAY_NAME[type], inventory[type]]
		label.position = rect.position + Vector2(2, 60)
		label.add_theme_font_size_override("font_size", 13)
		_dyn.add_child(label)

func _add_hud(won: bool) -> void:
	var help := Label.new()
	help.mouse_filter = Control.MOUSE_FILTER_IGNORE
	help.text = "Schalter aufs gelbe Landefeld (links) -> sofort unter Strom. Links: setzen/entfernen  Rechts: drehen  K: Raster"
	help.position = Vector2(500, 26)
	help.add_theme_font_size_override("font_size", 24)
	help.modulate = Color(1, 1, 1, 0.9)
	_dyn.add_child(help)
	var status := Label.new()
	status.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status.text = "STROM AM ZIEL!" if won else "kein Strom am Ziel"
	status.position = Vector2(1470, 26)
	status.add_theme_font_size_override("font_size", 30)
	status.modulate = Color(1.0, 0.9, 0.3) if won else Color(0.9, 0.5, 0.5)
	_dyn.add_child(status)
