extends Node

const CFG := {
	"menu": [AssetConfig.TITLE_SOUND, -2.0, true],
	"gameplay": [AssetConfig.GAMEPLAY_SOUND, -15.0, true],
	"mausi": [AssetConfig.MAUSI_SOUND, -6.0, true],
	"spark": [AssetConfig.SPARK_LOOP_SOUND, -9.0, true],
	"gameover": [AssetConfig.GAMEOVER_SOUND, 0.0, false],
}
const LOOPS := ["menu", "gameplay", "mausi", "spark"]

var _p := {}

func _ensure(name: String) -> AudioStreamPlayer:
	if not _p.has(name):
		var cfg: Array = CFG[name]
		var s = load(cfg[0])
		if cfg[2]:
			if s is AudioStreamOggVorbis:
				s.loop = true
			elif s is AudioStreamWAV:
				s.loop_mode = AudioStreamWAV.LOOP_FORWARD
				s.loop_begin = 0
				var bps := 2 if s.format == AudioStreamWAV.FORMAT_16_BITS else 1
				var ch := 2 if s.stereo else 1
				s.loop_end = int(s.data.size() / (bps * ch))
		var pl := AudioStreamPlayer.new()
		pl.stream = s
		pl.volume_db = cfg[1]
		add_child(pl)
		_p[name] = pl
	return _p[name]

func _set_loops(names: Array) -> void:
	for n in LOOPS:
		if names.has(n):
			var pl := _ensure(n)
			if not pl.playing:
				pl.play()
		elif _p.has(n) and _p[n].playing:
			_p[n].stop()

func menu() -> void:
	_set_loops(["menu"])

func levels() -> void:
	_set_loops(["gameplay", "mausi", "spark"])

func game_over() -> void:
	_set_loops([])
	_ensure("gameover").play()
