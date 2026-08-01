class_name Level1Layouts

# Level 1 = 2 Grids (A links, B rechts). Kontaktknoten [A-B] am rechten Rand von A,
# [B-A] am linken Rand von B; links verbindet sie ueber den Riss. Kein Schalter im Riss.
const LAYOUTS := [
	{
		"switches": [[0, 2], [5, 2], [9, 2], [14, 2], [14, 8]],
		"links": [[[5, 2], [9, 2]]],
		"resources": {"lever": 0, "straight": 7, "curve": 0, "plug": 6},
	},
	{
		"switches": [[0, 2], [2, 2], [5, 2], [9, 2], [12, 2], [12, 4], [12, 8], [14, 8]],
		"links": [[[5, 2], [9, 2]]],
		"resources": {"lever": 6, "straight": 1, "curve": 0, "plug": 6},
	},
	{
		"switches": [[0, 2], [4, 2], [4, 4], [7, 4], [10, 4], [14, 4], [14, 8]],
		"links": [[[7, 4], [10, 4]]],
		"resources": {"lever": 2, "straight": 3, "curve": 0, "plug": 8},
	},
]
