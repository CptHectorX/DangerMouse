extends Area2D

var _sounds := []

func _ready() -> void:
	input_pickable = true
	input_event.connect(_on_input)
	_load_sounds()

func _load_sounds() -> void:
	var dir := DirAccess.open(AssetConfig.GLOECKLER_SOUNDS)
	if dir == null:
		return
	dir.list_dir_begin()
	var f := dir.get_next()
	while f != "":
		if not dir.current_is_dir():
			var name := f
			if name.ends_with(".import"):
				name = name.substr(0, name.length() - 7)
			if name.get_extension() in ["ogg", "wav", "mp3"]:
				var full := AssetConfig.GLOECKLER_SOUNDS + "/" + name
				if not _sounds.has(full):
					_sounds.append(full)
		f = dir.get_next()
	dir.list_dir_end()

func _on_input(_viewport: Node, event: InputEvent, _shape: int) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_ring()
		get_viewport().set_input_as_handled()

func _ring() -> void:
	_wiggle()
	_play_sound()
	get_tree().call_group("mouse", "scare")

func _wiggle() -> void:
	var spr := $Spr
	spr.rotation_degrees = 0.0
	var tw := create_tween()
	for i in range(5):
		tw.tween_property(spr, "rotation_degrees", 13.0, 0.09)
		tw.tween_property(spr, "rotation_degrees", -13.0, 0.09)
	tw.tween_property(spr, "rotation_degrees", 0.0, 0.09)

func _play_sound() -> void:
	if _sounds.is_empty():
		return
	var stream = load(_sounds[randi() % _sounds.size()])
	if stream == null:
		return
	$Sound.stream = stream
	$Sound.play()
