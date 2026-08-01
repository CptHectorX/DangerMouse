class_name Board

enum Dir { UP, RIGHT, DOWN, LEFT }
enum Cable { STRAIGHT, CURVE, PLUG }

const NO_LEVER := -1

var cols := 0
var rows := 0
var usable := {}
var start := Vector2i.ZERO
var goal := Vector2i.ZERO
var switches := {}
var cables := {}

static func delta(dir: int) -> Vector2i:
	match dir:
		Dir.UP: return Vector2i(0, -1)
		Dir.RIGHT: return Vector2i(1, 0)
		Dir.DOWN: return Vector2i(0, 1)
		Dir.LEFT: return Vector2i(-1, 0)
	return Vector2i.ZERO

static func opposite(dir: int) -> int:
	match dir:
		Dir.UP: return Dir.DOWN
		Dir.RIGHT: return Dir.LEFT
		Dir.DOWN: return Dir.UP
		Dir.LEFT: return Dir.RIGHT
	return dir

static func rotate_dir(dir: int, rot: int) -> int:
	var order := [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]
	return order[(order.find(dir) + rot) % 4]

func place_switch(cell: Vector2i, lever := NO_LEVER) -> void:
	switches[cell] = lever

func place_cable(cell: Vector2i, type: int, rot := 0) -> void:
	cables[cell] = { "type": type, "rot": rot }

func set_lever(cell: Vector2i, lever: int) -> void:
	if switches.has(cell):
		switches[cell] = lever

func is_goal_powered() -> bool:
	return goal in powered_cells()

func powered_cells() -> Dictionary:
	var seen := { start: true }
	var stack := [start]
	while not stack.is_empty():
		for nb in _neighbors(stack.pop_back()):
			if not seen.has(nb):
				seen[nb] = true
				stack.append(nb)
	return seen

func neighbors(cell: Vector2i) -> Array:
	return _neighbors(cell)

func _is_terminal(cell: Vector2i) -> bool:
	return cell == start or cell == goal

func _is_occupied(cell: Vector2i) -> bool:
	return switches.has(cell) or cables.has(cell) or _is_terminal(cell)

func _cable_sides(type: int, rot: int) -> Array:
	var base := []
	match type:
		Cable.STRAIGHT: base = [Dir.LEFT, Dir.RIGHT]
		Cable.CURVE: base = [Dir.LEFT, Dir.DOWN]
		Cable.PLUG: base = [Dir.RIGHT]
	var out := []
	for d in base:
		out.append(rotate_dir(d, rot))
	return out

func _open_sides(cell: Vector2i) -> Array:
	if _is_terminal(cell) or switches.has(cell):
		return [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]
	if cables.has(cell):
		return _cable_sides(cables[cell]["type"], cables[cell]["rot"])
	return []

func _border_connects(a: Vector2i, dir: int, b: Vector2i) -> bool:
	if not _is_occupied(a) or not _is_occupied(b):
		return false
	if switches.has(a) and switches.has(b):
		return false
	return _open_sides(a).has(dir) and _open_sides(b).has(opposite(dir))

func _neighbors(cell: Vector2i) -> Array:
	var res := []
	for dir in [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]:
		if _border_connects(cell, dir, cell + delta(dir)):
			res.append(cell + delta(dir))
	if switches.has(cell) and switches[cell] != NO_LEVER:
		var d = switches[cell]
		var mid = cell + delta(d)
		var far = cell + delta(d) * 2
		if not _is_occupied(mid) and (_is_terminal(far) or (switches.has(far) and switches[far] == opposite(d))):
			res.append(far)
	if _is_terminal(cell):
		for dir in [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]:
			var m = cell + delta(dir)
			var f = cell + delta(dir) * 2
			if not _is_occupied(m) and switches.has(f) and switches[f] == opposite(dir):
				res.append(f)
	return res
