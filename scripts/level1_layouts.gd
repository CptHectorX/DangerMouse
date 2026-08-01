class_name Level1Layouts

# Level 1 = 2 Grids (A links, B rechts). Kontaktknoten [A-B] am rechten Rand von A,
# [B-A] am linken Rand von B; links verbindet sie ueber den Riss. Kein Schalter im Riss.
# 10 Layouts, generiert + validiert (loesbar, riss-frei) via scripts/tools/gen.gd.
const LAYOUTS := [
	{
		"switches": [[0, 2], [3, 2], [5, 2], [9, 2], [11, 2], [14, 2], [14, 6], [14, 8]],
		"links": [[[5, 2], [9, 2]]],
		"resources": {"lever": 6, "straight": 1, "curve": 0, "plug": 6},
	},
	{
		"switches": [[0, 2], [3, 2], [5, 2], [9, 2], [12, 2], [14, 2], [14, 5], [14, 8]],
		"links": [[[5, 2], [9, 2]]],
		"resources": {"lever": 4, "straight": 0, "curve": 0, "plug": 8},
	},
	{
		"switches": [[0, 2], [3, 2], [5, 2], [9, 2], [12, 2], [14, 2], [14, 6], [14, 8]],
		"links": [[[5, 2], [9, 2]]],
		"resources": {"lever": 6, "straight": 1, "curve": 0, "plug": 6},
	},
	{
		"switches": [[0, 2], [0, 4], [4, 4], [7, 4], [10, 4], [14, 4], [14, 8]],
		"links": [[[7, 4], [10, 4]]],
		"resources": {"lever": 2, "straight": 3, "curve": 0, "plug": 8},
	},
	{
		"switches": [[0, 2], [0, 4], [3, 4], [7, 4], [10, 4], [14, 4], [14, 8]],
		"links": [[[7, 4], [10, 4]]],
		"resources": {"lever": 2, "straight": 3, "curve": 0, "plug": 8},
	},
	{
		"switches": [[0, 2], [0, 5], [3, 5], [7, 5], [11, 5], [14, 5], [14, 8]],
		"links": [[[7, 5], [11, 5]]],
		"resources": {"lever": 0, "straight": 1, "curve": 0, "plug": 10},
	},
	{
		"switches": [[0, 2], [0, 5], [4, 5], [7, 5], [11, 5], [14, 5], [14, 8]],
		"links": [[[7, 5], [11, 5]]],
		"resources": {"lever": 0, "straight": 1, "curve": 0, "plug": 10},
	},
	{
		"switches": [[0, 2], [0, 5], [2, 5], [5, 5], [7, 5], [11, 5], [14, 5], [14, 8]],
		"links": [[[7, 5], [11, 5]]],
		"resources": {"lever": 4, "straight": 0, "curve": 0, "plug": 8},
	},
	{
		"switches": [[0, 2], [0, 5], [0, 8], [4, 8], [7, 8], [9, 8], [12, 8], [14, 8]],
		"links": [[[9, 8], [12, 8]]],
		"resources": {"lever": 4, "straight": 1, "curve": 0, "plug": 8},
	},
	{
		"switches": [[0, 2], [0, 4], [0, 8], [4, 8], [7, 8], [9, 8], [12, 8], [14, 8]],
		"links": [[[9, 8], [12, 8]]],
		"resources": {"lever": 6, "straight": 2, "curve": 0, "plug": 6},
	},
]
