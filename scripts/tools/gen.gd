extends SceneTree

const PMAP := [
	"######...######", "#######..######", "######...######", "#######...#####",
	"########..#####", "########...####", "#########...###", "##########..###", "##########..###",
]
var A_edge := []
var B_edge := []

func _pl(c: Vector2i) -> bool:
	if c.y < 0 or c.y >= 9 or c.x < 0 or c.x >= 15:
		return false
	return PMAP[c.y][c.x] == "#"

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

func _build_chain(start: Vector2i, corner_axis_first: int, corner: Vector2i, target: Vector2i, used: Dictionary):
	# two runs: start -> corner (dir1), corner -> target (dir2)
	var chain := [start]
	var types := []
	used[start] = true
	var ll := false
	var d1 := _dir_of(corner - start)
	if corner != start:
		var l1: int = abs((corner - start).x) + abs((corner - start).y)
		var r1 = _run(chain, types, used, d1, l1, ll)
		if r1 == null: return null
		ll = r1
	if target != corner:
		var d2 := _dir_of(target - corner)
		var l2: int = abs((target - corner).x) + abs((target - corner).y)
		var r2 = _run(chain, types, used, d2, l2, ll)
		if r2 == null: return null
	if chain[chain.size() - 1] != target: return null
	return {"chain": chain, "types": types}

func _gen_one(r: int):
	if A_edge[r] < 0 or B_edge[r] < 0: return null
	var ab := Vector2i(A_edge[r], r)
	var ba := Vector2i(B_edge[r], r)
	var used := {}
	var a = _build_chain(Vector2i(0, 2), 0, Vector2i(0, r), ab, used)
	if a == null: return null
	var b = _build_chain(ba, 0, Vector2i(14, r), Vector2i(14, 8), used)
	if b == null: return null
	var switches: Array = a["chain"] + b["chain"]
	var board := Board.new()
	board.entry = Vector2i(0, 2); board.exit = Vector2i(14, 8)
	for s in switches: board.place_switch(s); board.fixed[s] = true
	board.links.append([ab, ba])
	_solve(board, a["chain"], a["types"])
	_solve(board, b["chain"], b["types"])
	if not board.is_goal_powered(): return null
	var res := {"lever": 0, "straight": 0, "plug": 0}
	_count(res, a["chain"], a["types"]); _count(res, b["chain"], b["types"])
	return {"switches": switches, "ab": ab, "ba": ba, "res": res}

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

func _key(sw: Array) -> String:
	var a := []
	for s in sw: a.append(str(s))
	a.sort()
	return ",".join(a)

func _initialize() -> void:
	randomize()
	for r in 9:
		var i := 0
		while i < 15 and PMAP[r][i] == "#": i += 1
		A_edge.append(i - 1)
		while i < 15 and PMAP[r][i] == ".": i += 1
		B_edge.append(i if i < 15 else -1)
	var out := []
	var seen := {}
	for r in [2, 4, 5, 8]:
		var got := 0
		var tries := 0
		while got < 3 and tries < 3000 and out.size() < 10:
			tries += 1
			var lay = _gen_one(r)
			if lay == null: continue
			var k := _key(lay["switches"])
			if seen.has(k): continue
			seen[k] = true
			out.append(lay)
			got += 1
	var t2 := 0
	while out.size() < 10 and t2 < 4000:
		t2 += 1
		var lay = _gen_one([2, 4, 5, 8][randi() % 4])
		if lay == null: continue
		var k := _key(lay["switches"])
		if seen.has(k): continue
		seen[k] = true
		out.append(lay)
	print("=== GENERATED %d ===" % out.size())
	for lay in out:
		var sw := []
		for s in lay["switches"]: sw.append("[%d, %d]" % [s.x, s.y])
		var res = lay["res"]
		print('\t{')
		print('\t\t"switches": [%s],' % ", ".join(sw))
		print('\t\t"links": [[[%d, %d], [%d, %d]]],' % [lay["ab"].x, lay["ab"].y, lay["ba"].x, lay["ba"].y])
		print('\t\t"resources": {"lever": %d, "straight": %d, "curve": 0, "plug": %d},' % [res["lever"], res["straight"], res["plug"]])
		print('\t},')
	quit()
