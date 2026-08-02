extends SceneTree

const ORIGIN := Vector2(0, 0)
const CS := 64

var POLYS := []

func _center(c: Vector2i) -> Vector2:
	return ORIGIN + Vector2(c.x * CS + CS / 2.0, c.y * CS + CS / 2.0)

func _inpoly(p: Vector2, poly: Array) -> bool:
	var ins := false
	var n := poly.size()
	var j := n - 1
	for i in n:
		var a: Vector2 = poly[i]
		var b: Vector2 = poly[j]
		if ((a.y > p.y) != (b.y > p.y)) and (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x):
			ins = not ins
		j = i
	return ins

func _pl(c: Vector2i) -> bool:
	if c.x < 0 or c.x >= 30 or c.y < 0 or c.y >= 17:
		return false
	var p := _center(c)
	for poly in POLYS:
		if _inpoly(p, poly):
			return true
	return false

func _dd(d: int) -> Vector2i:
	return [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)][d]

func _opp(d: int) -> int:
	return [2, 3, 0, 1][d]

func _dir_of(diff: Vector2i) -> int:
	if diff.x > 0: return 1
	if diff.x < 0: return 3
	if diff.y > 0: return 2
	return 0

func _run(chain: Array, types: Array, used: Dictionary, dir: int, length: int, last_lever: bool):
	var pos: Vector2i = chain[chain.size() - 1]
	var rem := length
	var dd := _dd(dir)
	var ll := last_lever
	while rem > 0:
		var opts := []
		if not ll and rem >= 2 and (rem - 2 == 0 or rem - 2 >= 2): opts.append(2)
		if rem >= 3 and (rem - 3 == 0 or rem - 3 >= 2): opts.append(3)
		if rem >= 4 and (rem - 4 == 0 or rem - 4 >= 2): opts.append(4)
		if opts.is_empty(): return null
		var seg: int = opts[randi() % opts.size()]
		var ok := true
		for k in range(1, seg + 1):
			var c: Vector2i = pos + dd * k
			if not _pl(c) or used.has(c): ok = false; break
		if not ok: return null
		for k in range(1, seg + 1): used[pos + dd * k] = true
		var target: Vector2i = pos + dd * seg
		chain.append(target)
		types.append("lever" if seg == 2 else "cable")
		ll = (seg == 2)
		rem -= seg
		pos = target
	return ll

func _build_path(waypoints: Array, used: Dictionary):
	var chain := [waypoints[0]]
	var types := []
	used[waypoints[0]] = true
	var ll := false
	for i in range(1, waypoints.size()):
		var frm: Vector2i = chain[chain.size() - 1]
		var to: Vector2i = waypoints[i]
		if to == frm:
			continue
		var d := _dir_of(to - frm)
		var l: int = abs((to - frm).x) + abs((to - frm).y)
		var r = _run(chain, types, used, d, l, ll)
		if r == null: return null
		ll = r
		if chain[chain.size() - 1] != to: return null
	return {"chain": chain, "types": types}

func _solve(board, chain, types):
	for i in range(types.size()):
		var A: Vector2i = chain[i]
		var B: Vector2i = chain[i + 1]
		var d := _dir_of(B - A)
		var dist: int = abs((B - A).x) + abs((B - A).y)
		if types[i] == "lever":
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

func _count(res, chain, types):
	for i in range(types.size()):
		var dist: int = abs((chain[i + 1] - chain[i]).x) + abs((chain[i + 1] - chain[i]).y)
		if types[i] == "lever": res["lever"] += 2
		else: res["plug"] += 2; res["straight"] += (dist - 3)

func _gen_one():
	var used := {}
	var a = _build_path([Vector2i(5, 7), Vector2i(5, 11), Vector2i(7, 11)], used)
	if a == null: return null
	var b = _build_path([Vector2i(10, 11), Vector2i(12, 11)], used)
	if b == null: return null
	var c = _build_path([Vector2i(12, 7), Vector2i(14, 7)], used)
	if c == null: return null
	var d = _build_path([Vector2i(18, 7), Vector2i(24, 7)], used)
	if d == null: return null
	var switches: Array = a["chain"] + b["chain"] + c["chain"] + d["chain"]
	var board := Board.new()
	board.entry = Vector2i(5, 7); board.exit = Vector2i(24, 7)
	for s in switches: board.place_switch(s); board.fixed[s] = true
	var links := [[Vector2i(7, 11), Vector2i(10, 11)], [Vector2i(12, 11), Vector2i(12, 7)], [Vector2i(14, 7), Vector2i(18, 7)]]
	for l in links: board.links.append([l[0], l[1]])
	_solve(board, a["chain"], a["types"])
	_solve(board, b["chain"], b["types"])
	_solve(board, c["chain"], c["types"])
	_solve(board, d["chain"], d["types"])
	if not board.is_goal_powered(): return null
	var res := {"lever": 0, "straight": 0, "plug": 0}
	_count(res, a["chain"], a["types"]); _count(res, b["chain"], b["types"])
	_count(res, c["chain"], c["types"]); _count(res, d["chain"], d["types"])
	return {"switches": switches, "links": links, "res": res}

func _key(sw: Array) -> String:
	var arr := []
	for s in sw: arr.append(str(s))
	arr.sort()
	return ",".join(arr)

func _initialize() -> void:
	randomize()
	var scn = load("res://scenes/Level2.tscn").instantiate()
	get_root().add_child(scn)
	var grids = scn.get_node("Grids")
	for gnode in grids.get_children():
		if gnode is Polygon2D:
			var gp := []
			for pt in gnode.polygon:
				gp.append(gnode.to_global(pt))
			POLYS.append(gp)
	var out := []
	var seen := {}
	var tries := 0
	while out.size() < 6 and tries < 6000:
		tries += 1
		var lay = _gen_one()
		if lay == null: continue
		var k := _key(lay["switches"])
		if seen.has(k): continue
		seen[k] = true
		out.append(lay)
	print("=== GENERATED %d ===" % out.size())
	for lay in out:
		var sw := []
		for s in lay["switches"]: sw.append("[%d, %d]" % [s.x, s.y])
		var lk := []
		for l in lay["links"]: lk.append("[[%d, %d], [%d, %d]]" % [l[0].x, l[0].y, l[1].x, l[1].y])
		var res = lay["res"]
		print('\t{')
		print('\t\t"switches": [%s],' % ", ".join(sw))
		print('\t\t"links": [%s],' % ", ".join(lk))
		print('\t\t"resources": {"lever": %d, "straight": %d, "curve": 0, "plug": %d},' % [res["lever"], res["straight"], res["plug"]])
		print('\t},')
	quit()
