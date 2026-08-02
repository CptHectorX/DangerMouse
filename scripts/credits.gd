extends Node2D

var _done := false

func _unhandled_input(event: InputEvent) -> void:
	var go := false
	if event is InputEventKey and event.pressed and not event.echo:
		go = true
	elif event is InputEventMouseButton and event.pressed:
		go = true
	if go and not _done:
		_done = true
		get_tree().change_scene_to_file("res://scenes/TitleCard.tscn")
