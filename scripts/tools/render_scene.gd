extends SceneTree
var f = 0
var cap = 10
func _initialize() -> void:
	if OS.get_environment("FRAME") != "": cap = int(OS.get_environment("FRAME"))
	root.add_child(load(OS.get_environment("SCENE")).instantiate())
func _process(_d: float) -> bool:
	f += 1
	if f == cap:
		root.get_texture().get_image().save_png(OS.get_environment("OUT")); quit()
	return false
