extends SceneTree
var f = 0
var scn
func _dd(d): return [Vector2i(0,-1),Vector2i(1,0),Vector2i(0,1),Vector2i(-1,0)][d]
func _opp(d): return [2,3,0,1][d]
func _dir_of(diff):
	if diff.x>0: return 1
	if diff.x<0: return 3
	if diff.y>0: return 2
	return 0
func _solve_seg(b, A, B):
	var d = _dir_of(B-A); var dist = abs((B-A).x)+abs((B-A).y)
	if dist==2:
		b.set_lever(A,d); b.set_lever(B,_opp(d))
	else:
		var dd=_dd(d)
		for k in range(1,dist):
			var c=A+dd*k
			if k==1: b.place_cable(c, Board.Cable.PLUG, (_opp(d)-1+4)%4)
			elif k==dist-1: b.place_cable(c, Board.Cable.PLUG, (d-1+4)%4)
			else: b.place_cable(c, Board.Cable.STRAIGHT, 0 if (d==1 or d==3) else 1)
func _initialize():
	scn = load(OS.get_environment("SCENE")).instantiate(); root.add_child(scn)
func _process(_x):
	f += 1
	if f == 3:
		var b = scn.board
		var sw = b.switches.keys()
		var links = b.links
		for i in range(sw.size()-1):
			var A = sw[i]; var B = sw[i+1]
			var isl = false
			for l in links:
				if (l[0]==A and l[1]==B) or (l[0]==B and l[1]==A): isl = true
			if isl or (A.x!=B.x and A.y!=B.y): continue
			_solve_seg(b, A, B)
		if OS.get_environment("SHOWGRID")=="1":
			scn._grid_on = true; scn._update_grid()
		scn._rebuild()
		print("goal powered: ", b.is_goal_powered())
	if f == 14:
		root.get_texture().get_image().save_png(OS.get_environment("OUT")); quit()
	return false
