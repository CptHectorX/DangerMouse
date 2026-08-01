extends Node2D

const SLOT := 64
const COLS := 15
const ROWS := 9
const ORIGIN := Vector2(512, 220)

const TRAY := ["switch", "lever", "straight", "curve", "plug"]
const TRAY_NAME := {"switch": "Schalter", "lever": "Hebel", "straight": "Kabel |", "curve": "Kabel L", "plug": "Stecker"}

var board: Board
var inventory := {"switch": 14, "lever": 12, "straight": 22, "curve": 10, "plug": 4}
var active := "switch"
var _glow: Array = []
var _t := 0.0

func _ready() -> void:
	board = Board.new()
	board.start = Vector2i(0, 2)
	board.goal = Vector2i(14, 8)
	_rebuild()

func _process(delta: float) -> void:
	_t += delta
	var pulse := 0.72 + 0.28 * sin(_t * 9.0)
	for node in _glow:
		if is_instance_valid(node):
			node.modulate.a = pulse

func _unhandled_input(event: InputEvent) -> void:
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
	if not _in_grid(cell) or cell == board.start or cell == board.goal:
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
	for child in get_children():
		child.free()
	_glow = []
	_add_background()
	var powered := board.powered_cells()
	_add_current(powered)
	_add_terminal(board.start, "START", Color(0.3, 0.9, 0.4), powered.has(board.start))
	_add_terminal(board.goal, "ZIEL", Color(1.0, 0.8, 0.1), powered.has(board.goal))
	_add_pieces(powered)
	_add_tray()
	_add_hud(powered.has(board.goal))

func _add_background() -> void:
	var bg := Sprite2D.new()
	bg.texture = load(AssetConfig.BG_LEVEL1)
	bg.position = Vector2(960, 540)
	add_child(bg)
	var grid := Sprite2D.new()
	grid.texture = load(AssetConfig.BG_LEVEL1_GRID)
	grid.position = Vector2(960, 540)
	grid.modulate = Color(1, 1, 1, 0.7)
	add_child(grid)

func _add_current(powered: Dictionary) -> void:
	var seen := {}
	for cell in powered:
		for nb in board.neighbors(cell):
			if not powered.has(nb):
				continue
			var key := str(cell) + str(nb)
			if seen.has(key) or seen.has(str(nb) + str(cell)):
				continue
			seen[key] = true
			var line := Line2D.new()
			line.add_point(_center(cell))
			line.add_point(_center(nb))
			line.width = 10
			line.default_color = Color(1.0, 0.92, 0.2)
			line.begin_cap_mode = Line2D.LINE_CAP_ROUND
			line.end_cap_mode = Line2D.LINE_CAP_ROUND
			line.z_index = 20
			add_child(line)
			_glow.append(line)

func _add_terminal(cell: Vector2i, text: String, col: Color, live: bool) -> void:
	var rect := ColorRect.new()
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.size = Vector2(SLOT, SLOT)
	rect.position = _center(cell) - Vector2(SLOT, SLOT) / 2.0
	rect.color = Color(col, 0.85 if live else 0.5)
	add_child(rect)
	if live:
		_glow.append(rect)
	var label := Label.new()
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.text = text
	label.position = rect.position + Vector2(2, SLOT / 2.0 - 9)
	label.add_theme_font_size_override("font_size", 13)
	add_child(label)

func _piece_tex(type: int) -> String:
	match type:
		Board.Cable.CURVE: return AssetConfig.CABLE_CURVE
		Board.Cable.PLUG: return AssetConfig.CABLE_PLUG
	return AssetConfig.CABLE_STRAIGHT

func _sprite(path: String, at: Vector2, live: bool, rot_deg := 0.0) -> void:
	var s := Sprite2D.new()
	s.texture = load(path)
	s.position = at
	s.rotation_degrees = rot_deg
	s.scale = Vector2(SLOT / 128.0, SLOT / 128.0)
	s.modulate = Color(1, 1, 1) if live else Color(0.45, 0.45, 0.5)
	add_child(s)

func _add_pieces(powered: Dictionary) -> void:
	for cell in board.cables:
		var data = board.cables[cell]
		_sprite(_piece_tex(data["type"]), _center(cell), powered.has(cell), data["rot"] * 90.0)
	for cell in board.switches:
		var live: bool = powered.has(cell)
		_sprite(AssetConfig.SWITCH, _center(cell), live)
		var lever = board.switches[cell]
		if lever != Board.NO_LEVER:
			_sprite(AssetConfig.LEVER, _center(cell), live, (lever - Board.Dir.RIGHT) * 90.0)

func _tray_rect(i: int) -> Rect2:
	return Rect2(520 + i * 150, 958, 96, 96)

func _add_tray() -> void:
	for i in TRAY.size():
		var type: String = TRAY[i]
		var rect := _tray_rect(i)
		var box := ColorRect.new()
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.position = rect.position
		box.size = rect.size
		box.color = Color(1, 0.9, 0.3, 0.35) if type == active else Color(0, 0, 0, 0.45)
		add_child(box)
		var s := Sprite2D.new()
		s.texture = load(_card_tex(type))
		s.position = rect.position + Vector2(48, 40)
		s.scale = Vector2(0.5, 0.5)
		add_child(s)
		var label := Label.new()
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.text = "%s\n%s x%d" % [str(i + 1), TRAY_NAME[type], inventory[type]]
		label.position = rect.position + Vector2(2, 60)
		label.add_theme_font_size_override("font_size", 13)
		add_child(label)

func _card_tex(type: String) -> String:
	match type:
		"switch": return AssetConfig.SWITCH
		"lever": return AssetConfig.LEVER
		"straight": return AssetConfig.CABLE_STRAIGHT
		"curve": return AssetConfig.CABLE_CURVE
		"plug": return AssetConfig.CABLE_PLUG
	return AssetConfig.SWITCH

func _add_hud(won: bool) -> void:
	var help := Label.new()
	help.mouse_filter = Control.MOUSE_FILTER_IGNORE
	help.text = "Karte unten waehlen · Links: setzen / entfernen · Rechts: drehen"
	help.position = Vector2(500, 26)
	help.add_theme_font_size_override("font_size", 26)
	help.modulate = Color(1, 1, 1, 0.9)
	add_child(help)
	var status := Label.new()
	status.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status.text = "STROM AM ZIEL!" if won else "kein Strom am Ziel"
	status.position = Vector2(1470, 26)
	status.add_theme_font_size_override("font_size", 30)
	status.modulate = Color(1.0, 0.9, 0.3) if won else Color(0.9, 0.5, 0.5)
	add_child(status)
