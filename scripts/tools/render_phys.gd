extends SceneTree

var frames := 0
var scn

func _initialize() -> void:
	scn = load("res://scenes/Level3.tscn").instantiate()
	root.add_child(scn)

func _process(_delta: float) -> bool:
	frames += 1
	if frames == 90:
		var img = root.get_texture().get_image()
		img.save_png(OS.get_environment("OUT"))
		print("pieces: ", scn._pieces.size())
		quit()
	return false
