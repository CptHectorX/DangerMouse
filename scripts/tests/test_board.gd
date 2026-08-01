extends SceneTree

func _initialize() -> void:
	var fails := 0
	fails += _check("Hebelbruecke ueber leeres Feld leitet", _build_bridge().is_goal_powered())
	var broken := _build_bridge()
	broken.set_lever(Vector2i(4, 0), Board.Dir.RIGHT)
	fails += _check("Hebel weggedreht -> kein Strom", not broken.is_goal_powered())
	fails += _check("Kabelkurve leitet um die Ecke", _build_curve().is_goal_powered())
	fails += _check("Reiner Kabelweg leitet", _build_cableline().is_goal_powered())
	if fails == 0:
		print("ALLE TESTS OK")
	else:
		print("TESTS FEHLGESCHLAGEN: %d" % fails)
	quit(fails)

func _check(label: String, ok: bool) -> int:
	print(("[OK]   " if ok else "[FAIL] ") + label)
	return 0 if ok else 1

func _build_bridge() -> Board:
	var b := Board.new()
	b.cols = 7
	b.rows = 1
	b.start = Vector2i(0, 0)
	b.goal = Vector2i(6, 0)
	b.place_cable(Vector2i(1, 0), Board.Cable.STRAIGHT, 0)
	b.place_switch(Vector2i(2, 0), Board.Dir.RIGHT)
	b.place_switch(Vector2i(4, 0), Board.Dir.LEFT)
	b.place_cable(Vector2i(5, 0), Board.Cable.STRAIGHT, 0)
	return b

func _build_curve() -> Board:
	var b := Board.new()
	b.cols = 2
	b.rows = 2
	b.start = Vector2i(0, 0)
	b.goal = Vector2i(1, 1)
	b.place_cable(Vector2i(1, 0), Board.Cable.CURVE, 0)
	return b

func _build_cableline() -> Board:
	var b := Board.new()
	b.cols = 4
	b.rows = 1
	b.start = Vector2i(0, 0)
	b.goal = Vector2i(3, 0)
	b.place_cable(Vector2i(1, 0), Board.Cable.STRAIGHT, 0)
	b.place_cable(Vector2i(2, 0), Board.Cable.STRAIGHT, 0)
	return b
