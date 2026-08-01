extends Node2D

const SLOT := 64
const PLAY_ORIGIN := Vector2(340, 220)

func _ready() -> void:
	_add_background()
	var board := _demo_board()
	var powered := board.powered_cells()
	_render(board, powered)
	_add_status(board.is_goal_powered())

func _add_background() -> void:
	var bg := Sprite2D.new()
	bg.texture = load(AssetConfig.BG_LEVEL1)
	bg.position = Vector2(960, 540)
	add_child(bg)
	var grid := Sprite2D.new()
	grid.texture = load(AssetConfig.BG_LEVEL1_GRID)
	grid.position = Vector2(960, 540)
	add_child(grid)

func _demo_board() -> Board:
	var b := Board.new()
	b.start = Vector2i(0, 0)
	b.goal = Vector2i(6, 0)
	b.place_cable(Vector2i(1, 0), Board.Cable.STRAIGHT, 0)
	b.place_switch(Vector2i(2, 0), Board.Dir.RIGHT)
	b.place_switch(Vector2i(4, 0), Board.Dir.LEFT)
	b.place_cable(Vector2i(5, 0), Board.Cable.STRAIGHT, 0)
	b.place_switch(Vector2i(2, 2), Board.Dir.UP)
	return b

func _cell_center(cell: Vector2i) -> Vector2:
	return PLAY_ORIGIN + Vector2(cell.x * SLOT + SLOT / 2.0, cell.y * SLOT + SLOT / 2.0)

func _tint(item: CanvasItem, live: bool) -> void:
	item.modulate = Color(1, 1, 1) if live else Color(0.4, 0.4, 0.45)

func _sprite(path: String, cell: Vector2i, live: bool, rot_deg := 0.0) -> void:
	var s := Sprite2D.new()
	s.texture = load(path)
	s.position = _cell_center(cell)
	s.rotation_degrees = rot_deg
	s.scale = Vector2(SLOT / 128.0, SLOT / 128.0)
	_tint(s, live)
	add_child(s)

func _render(board: Board, powered: Dictionary) -> void:
	for cell in board.cables:
		var data = board.cables[cell]
		var path := AssetConfig.CABLE_STRAIGHT
		if data["type"] == Board.Cable.CURVE:
			path = AssetConfig.CABLE_CURVE
		elif data["type"] == Board.Cable.PLUG:
			path = AssetConfig.CABLE_PLUG
		_sprite(path, cell, powered.has(cell), data["rot"] * 90.0)
	for cell in board.switches:
		var live: bool = powered.has(cell)
		_sprite(AssetConfig.SWITCH, cell, live)
		var lever = board.switches[cell]
		if lever != Board.NO_LEVER:
			_sprite(AssetConfig.LEVER, cell, live, (lever - Board.Dir.RIGHT) * 90.0)
	_marker(board.start, "START", Color(0.2, 0.8, 0.3))
	_marker(board.goal, "ZIEL", Color(1.0, 0.8, 0.1))

func _marker(cell: Vector2i, text: String, col: Color) -> void:
	var rect := ColorRect.new()
	rect.size = Vector2(SLOT, SLOT)
	rect.position = _cell_center(cell) - Vector2(SLOT, SLOT) / 2.0
	rect.color = Color(col, 0.55)
	add_child(rect)
	var label := Label.new()
	label.text = text
	label.position = rect.position + Vector2(2, SLOT / 2.0 - 8)
	label.add_theme_font_size_override("font_size", 12)
	add_child(label)

func _add_status(won: bool) -> void:
	var label := Label.new()
	label.text = "Level 1 (Vorschau) · Slot 64px · Ziel mit Strom: " + ("JA" if won else "NEIN")
	label.position = Vector2(340, 176)
	label.add_theme_font_size_override("font_size", 30)
	label.modulate = Color(1.0, 0.9, 0.3)
	add_child(label)
