extends Node2D

const FLASH := preload("res://assets/fx/explosion_flash.png")
const RING := preload("res://assets/fx/explosion_ring.png")
const PUFFS := [
	preload("res://assets/fx/explosion_puff_01.png"),
	preload("res://assets/fx/explosion_puff_02.png"),
	preload("res://assets/fx/explosion_puff_03.png"),
	preload("res://assets/fx/explosion_puff_04.png"),
]
const DUR := 0.75

var tint := Color(1.0, 0.6, 0.25)
var size := 1.0
var t := 0.0

func setup(tint_color: Color, scale_mul: float) -> void:
	tint = tint_color
	size = scale_mul

func _ready() -> void:
	add_to_group("fx")
	z_index = 50
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = mat
	queue_redraw()

func _process(delta: float) -> void:
	t += delta
	queue_redraw()
	if t >= DUR:
		queue_free()

func _blit(tex: Texture2D, px: float, alpha: float, col: Color) -> void:
	if alpha <= 0.0:
		return
	var w := float(tex.get_width())
	var h := float(tex.get_height())
	var sc := px / w
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(sc, sc))
	draw_texture(tex, Vector2(-w * 0.5, -h * 0.5), Color(col.r, col.g, col.b, clampf(alpha, 0.0, 1.0)))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw() -> void:
	var p := t / DUR
	var ring_p := minf(p / 0.75, 1.0)
	_blit(RING, size * 60.0 * (0.5 + 2.0 * ring_p), (1.0 - ring_p) * 0.85, tint)
	var puff_frame: Texture2D = PUFFS[clampi(int(p / 0.22), 0, 3)]
	var puff_a := 1.0 if p < 0.45 else maxf(0.0, 1.0 - (p - 0.45) / 0.55)
	_blit(puff_frame, size * 70.0 * (0.55 + 1.3 * p), puff_a, tint)
	if p < 0.32:
		var fp := p / 0.32
		_blit(FLASH, size * 95.0 * (0.5 + 0.9 * fp), 1.0 - fp, Color(1.0, 0.92, 0.65))
