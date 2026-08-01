extends SceneTree

var frames := 0
var scn

func _dd(d: int) -> Vector2i:
	return [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)][d]

func _opp(d: int) -> int:
	return [2, 3, 0, 1][d]

func _dir_of(diff: Vector2i) -> int:
	if diff.x > 0: return 1
	if diff.x < 0: return 3
	if diff.y > 0: return 2
	return 0

func _solve_seg(board, A: Vector2i, B: Vector2i) -> void:
	var d := _dir_of(B - A)
	var dist: int = abs((B - A).x) + abs((B - A).y)
	if dist == 2:
		board.set_lever(A, d); board.set_lever(B, _opp(d))
	else:
		var dd := _dd(d)
		for k in range(1, dist):
			var c: Vector2i = A + dd * k
			if k == 1:
				board.place_cable(c, Board.Cable.PLUG, (_opp(d) - 1 + 4) % 4)
			elif k == dist - 1:
				board.place_cable(c, Board.Cable.PLUG, (d - 1 + 4) % 4)
			else:
				board.place_cable(c, Board.Cable.STRAIGHT, 0 if (d == 1 or d == 3) else 1)

func _initialize() -> void:
	scn = load("res://scenes/Level3.tscn").instantiate()
	root.add_child(scn)

func _process(_delta: float) -> bool:
	frames += 1
	if frames == 3:
		var idx := int(OS.get_environment("IDX")) if OS.get_environment("IDX") != "" else 0
		var lay = Level3Layouts.LAYOUTS[idx]
		scn._load_layout(lay)
		var board = scn.board
		var links := []
		for lk in lay["links"]:
			links.append([Vector2i(lk[0][0], lk[0][1]), Vector2i(lk[1][0], lk[1][1])])
		var sw = lay["switches"]
		for i in range(sw.size() - 1):
			var A := Vector2i(sw[i][0], sw[i][1])
			var B := Vector2i(sw[i + 1][0], sw[i + 1][1])
			var is_link := false
			for l in links:
				if (l[0] == A and l[1] == B) or (l[0] == B and l[1] == A):
					is_link = true
			if is_link or (A.x != B.x and A.y != B.y):
				continue
			_solve_seg(board, A, B)
		scn._rebuild()
		print("goal powered: ", board.is_goal_powered())
	if frames == 12:
		var img = root.get_texture().get_image()
		img.save_png(OS.get_environment("OUT"))
		quit()
	return false
