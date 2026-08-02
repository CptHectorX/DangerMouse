extends SceneTree
var f = 0
func _initialize() -> void:
	root.add_child(load(OS.get_environment("SCENE")).instantiate())
func _process(_d: float) -> bool:
	f += 1
	if f == 10:
		root.get_texture().get_image().save_png(OS.get_environment("OUT"))
		quit()
	return false
