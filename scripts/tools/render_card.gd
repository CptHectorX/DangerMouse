extends SceneTree
var f=0
var cap=10
func _initialize():
	GameState.card_mode = OS.get_environment("MODE")
	GameState.card_title = OS.get_environment("TITLE")
	GameState.card_sub = ""
	if OS.get_environment("FRAME") != "": cap = int(OS.get_environment("FRAME"))
	root.add_child(load("res://scenes/TitleCard.tscn").instantiate())
func _process(_d):
	f+=1
	if f==cap:
		root.get_texture().get_image().save_png(OS.get_environment("OUT")); quit()
	return false
