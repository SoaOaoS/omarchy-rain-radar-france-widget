// Fixed radar echoes: places where a radar shows rain far more often than rain
// allows (structures, wind turbines, the beam catching the ground). Each
// masked cell is filled, in every frame, from the cells one and two cells
// outside its patch, weighted by inverse squared distance: dry surroundings
// remove the echo, wet ones carry a shower through.
//
// The Danish widget this one is ported from carries a mask measured on 185
// days of DMI radar (Denmark-rain-nowcast report, Appendix A.3). No such
// study exists yet for the French composite, so the mask here is EMPTY and
// fill() changes nothing: the machinery is kept so that cells can be added
// (as [row, col] on the 305 x 244 nowcast grid over BOUNDS, row 0 north) once
// someone has measured them.
var COLS = 305
var ROWS = 244
var BOUNDS = { west: -9.5, south: 41.0, east: 10.5, north: 52.0 }
var CELLS = []
var REACH = 2   // source cells: up to this many cells outside a patch

// The mask split into patches (cells touching, diagonals included).
function patches() {
  var masked = {}
  for (var i = 0; i < CELLS.length; i++) masked[CELLS[i][0] * COLS + CELLS[i][1]] = true
  var seen = {}, out = []
  for (var j = 0; j < CELLS.length; j++) {
    var start = CELLS[j][0] * COLS + CELLS[j][1]
    if (seen[start]) continue
    var patch = [], stack = [start]
    seen[start] = true
    while (stack.length) {
      var idx = stack.pop(), r = Math.floor(idx / COLS), c = idx % COLS
      patch.push(idx)
      for (var dr = -1; dr <= 1; dr++)
        for (var dc = -1; dc <= 1; dc++) {
          var n = (r + dr) * COLS + (c + dc)
          if (masked[n] && !seen[n]) { seen[n] = true; stack.push(n) }
        }
    }
    out.push(patch)
  }
  return out
}

// For every masked cell, its source cells (the patch's ring, REACH cells
// wide) and their weights, 1 / squared distance.
function buildPlan() {
  var plan = []
  var ps = patches()
  for (var p = 0; p < ps.length; p++) {
    var inPatch = {}
    for (var i = 0; i < ps[p].length; i++) inPatch[ps[p][i]] = true
    var ring = [], inRing = {}
    for (var k = 0; k < ps[p].length; k++) {
      var r = Math.floor(ps[p][k] / COLS), c = ps[p][k] % COLS
      for (var dr = -REACH; dr <= REACH; dr++)
        for (var dc = -REACH; dc <= REACH; dc++) {
          var rr = r + dr, cc = c + dc, n = rr * COLS + cc
          if (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS || inPatch[n] || inRing[n]) continue
          inRing[n] = true
          ring.push(n)
        }
    }
    for (var m = 0; m < ps[p].length; m++) {
      var mr = Math.floor(ps[p][m] / COLS), mc = ps[p][m] % COLS
      var sources = [], weights = []
      for (var s = 0; s < ring.length; s++) {
        var sr = Math.floor(ring[s] / COLS), sc = ring[s] % COLS
        sources.push(ring[s])
        weights.push(1 / ((sr - mr) * (sr - mr) + (sc - mc) * (sc - mc)))
      }
      plan.push({ cell: ps[p][m], sources: sources, weights: weights })
    }
  }
  return plan
}

var _plan = null
function plan() {
  if (!_plan) _plan = buildPlan()
  return _plan
}

// Whether `grid` is the nowcast grid the mask was made for.
function applies(grid) {
  if (!grid || !grid.values || grid.cols !== COLS || grid.rows !== ROWS || !grid.bounds) return false
  var b = grid.bounds
  return Math.abs(b.west - BOUNDS.west) < 1e-6 && Math.abs(b.east - BOUNDS.east) < 1e-6 &&
    Math.abs(b.south - BOUNDS.south) < 1e-6 && Math.abs(b.north - BOUNDS.north) < 1e-6
}

// Fills the masked cells of an observed grid in place and returns it. Every
// value is computed from the unfilled grid; cells without a finite source
// value are skipped. Any other grid is returned unchanged.
function fill(grid) {
  if (!applies(grid) || grid.fixedEchoesFilled) return grid
  var values = grid.values, steps = plan(), filled = []
  for (var i = 0; i < steps.length; i++) {
    var sum = 0, weight = 0
    for (var k = 0; k < steps[i].sources.length; k++) {
      var v = values[steps[i].sources[k]]
      if (!isFinite(v)) continue
      sum += v * steps[i].weights[k]
      weight += steps[i].weights[k]
    }
    filled.push(weight > 0 ? sum / weight : values[steps[i].cell])
  }
  for (var j = 0; j < steps.length; j++) values[steps[j].cell] = filled[j]
  grid.fixedEchoesFilled = true
  return grid
}

if (typeof module !== "undefined") module.exports = {
  COLS: COLS,
  ROWS: ROWS,
  BOUNDS: BOUNDS,
  CELLS: CELLS,
  patches: patches,
  plan: plan,
  applies: applies,
  fill: fill
}
