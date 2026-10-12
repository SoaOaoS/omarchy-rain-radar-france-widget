const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const MapModel = require('../MapModel.js')
const MapData = require('../MapData.js')

const helper = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'radar-convert.py'), 'utf8')
// the converter's constants: `WEST, SOUTH, EAST, NORTH = 5.0, ...` and `PNG_W, PNG_H = 640, 458`
const pyNumbers = (names) => {
  const m = helper.match(new RegExp('^' + names.join(', ') + ' = ([-0-9., ]+)$', 'm'))
  assert.ok(m, `helpers/radar-convert.py should define ${names.join(', ')}`)
  return m[1].split(',').map(Number)
}
const [west, south, east, north] = pyNumbers(['WEST', 'SOUTH', 'EAST', 'NORTH'])
const [pngW, pngH] = pyNumbers(['PNG_W', 'PNG_H'])
const [gridCols, gridRows] = pyNumbers(['GRID_COLS', 'GRID_ROWS'])

test('helpers/radar-convert.py map domain matches MapModel.bounds', () => {
  assert.equal(west, MapModel.bounds.west)
  assert.equal(east, MapModel.bounds.east)
  assert.equal(south, MapModel.bounds.south)
  assert.equal(north, MapModel.bounds.north)
})

test('the France region lies inside the map domain', () => {
  const b = MapModel.bounds, h = MapModel.franceBounds
  assert.ok(h.west >= b.west && h.east <= b.east && h.south >= b.south && h.north <= b.north)
})

test('radar PNG size has the map domain\'s aspect ratio (else it would be stretched against the coastlines)', () => {
  const pngAspect = pngW / pngH
  assert.ok(Math.abs(pngAspect / MapModel.dataAspect - 1) < 0.005, `png aspect ${pngAspect} vs map ${MapModel.dataAspect}`)
})

test('nowcast grid cells are ~square on the ground', () => {
  const b = MapModel.bounds
  const cellEast = (b.east - b.west) * MapModel.longitudeScale / gridCols
  const cellNorth = (b.north - b.south) / gridRows
  assert.ok(Math.abs(cellEast / cellNorth - 1) < 0.01, `cells ${cellEast} x ${cellNorth} deg`)
})

test('viewport fills a canvas sized from aspect exactly, with the 8px margin all round', () => {
  const width = 560
  const height = (width - 16) / MapModel.aspect + 16
  const vp = MapModel.viewport(width, height)
  assert.ok(Math.abs(vp.x - 8) < 1e-6 && Math.abs(vp.y - 8) < 1e-6, `origin ${vp.x},${vp.y}`)
  const corner = MapModel.project(MapModel.view.south, MapModel.view.east, width, height)
  assert.ok(Math.abs(corner.x - (width - 8)) < 1e-6 && Math.abs(corner.y - (height - 8)) < 1e-6)
})

test('regionPeak only looks at cells whose centers are inside the region', () => {
  const grid = { cols: 4, rows: 2, bounds: { west: 0, east: 4, south: 0, north: 2 }, values: new Float32Array(8) }
  grid.values[0] = 9 // row 0, col 0 -> center (0.5, 1.5)
  grid.values[7] = 3 // row 1, col 3 -> center (3.5, 0.5)
  assert.equal(MapModel.regionPeak(grid, { west: 0, east: 4, south: 0, north: 2 }), 9)
  assert.equal(MapModel.regionPeak(grid, { west: 2, east: 4, south: 0, north: 2 }), 3)
  assert.equal(MapModel.regionPeak(grid, { west: 0, east: 1, south: 0, north: 1 }), 0)
  assert.equal(MapModel.regionPeak(null, MapModel.franceBounds), 0)
})

const pad = 0.31 // build-map-data clips to the domain plus 0.3 degrees
const inPaddedDomain = ([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) &&
  lon >= MapModel.bounds.west - pad && lon <= MapModel.bounds.east + pad &&
  lat >= MapModel.bounds.south - pad && lat <= MapModel.bounds.north + pad

test('map data: mainland France and Corsica are complete and the neighbours are present, clipped to the domain', () => {
  // Detail floor: guards against silently regenerating from coarser data or
  // simplifying too hard (1:10m, simplified to about a third of a pixel).
  assert.ok(MapData.franceRings.length >= 5)
  assert.ok(MapData.franceRings.reduce((n, r) => n + r.length, 0) > 1000, 'France outline lost detail')
  for (const ring of MapData.franceRings) for (const p of ring) {
    assert.ok(p[0] >= MapModel.bounds.west && p[0] <= MapModel.bounds.east && p[1] >= MapModel.bounds.south && p[1] <= MapModel.bounds.north)
  }
  for (const name of ['United Kingdom', 'Spain', 'Italy', 'Switzerland', 'Germany', 'Belgium', 'Luxembourg', 'Andorra'])
    assert.ok(MapData.neighbours.some((n) => n.name === name), name)
  for (const n of MapData.neighbours) {
    assert.ok(n.rings.length > 0, `${n.name} should have visible land in the domain`)
    for (const ring of n.rings) {
      assert.ok(ring.length >= 3)
      assert.ok(ring.every(inPaddedDomain), `${n.name} has points outside the clip box`)
    }
  }
})

function inRing(ring, [x, y]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

test('each country label sits on that country\'s land, inside the view', () => {
  for (const label of MapData.labels) {
    assert.ok(MapModel.inView(label.lat, label.lon), `${label.name} outside the view`)
    const country = MapData.neighbours.find((n) => n.name === label.name)
    assert.ok(country, `${label.name} is not a known neighbour`)
    assert.ok(country.rings.some((r) => inRing(r, [label.lon, label.lat])), `${label.name} label is not on ${label.name}'s land`)
  }
})

test('the view lies inside the data area, with sea to the west kept out of sight', () => {
  const b = MapModel.bounds, v = MapModel.view
  assert.ok(v.west >= b.west && v.east <= b.east && v.south >= b.south && v.north <= b.north)
  assert.ok(MapModel.contains(47, -9) && !MapModel.inView(47, -9))
  // project and unproject stay inverses in the view
  const p = MapModel.project(48.86, 2.35, 560, 480), q = MapModel.unproject(p.x, p.y, 560, 480)
  assert.ok(Math.abs(q.latitude - 48.86) < 1e-9 && Math.abs(q.longitude - 2.35) < 1e-9)
})

test('the pin\'s graph sits on open sea, inside the view', () => {
  const Location = require('../LocationModel.js')
  const g = MapModel.graphBox
  assert.ok(MapModel.inView(g.north, g.west) && MapModel.inView(g.south, g.east))
  const land = MapData.franceRings.concat(...MapData.neighbours.map((n) => n.rings))
  for (let lat = g.south; lat <= g.north; lat += 0.1)
    for (let lon = g.west; lon <= g.east; lon += 0.1)
      assert.ok(!Location.inFrance(land, lat, lon, 0), `land under the graph at ${lat.toFixed(1)}, ${lon.toFixed(1)}`)
})

test('the map lies inside the radar tiles, and the converter reads the same tiles', () => {
  const RadarModel = require('../RadarModel.js')
  const T = RadarModel.TILES, n = 2 ** T.zoom
  const lon = (x) => x / n * 360 - 180
  const lat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI
  const b = MapModel.bounds
  assert.ok(lon(T.x0) <= b.west && lon(T.x0 + T.nx) >= b.east, 'tiles cover the map west to east')
  assert.ok(lat(T.y0) >= b.north && lat(T.y0 + T.ny) <= b.south, 'tiles cover the map north to south')
  assert.deepEqual(pyNumbers(['ZOOM', 'TILE_SIZE']), [T.zoom, T.size])
  assert.deepEqual(pyNumbers(['TILE_X0', 'TILE_Y0', 'TILES_X', 'TILES_Y']), [T.x0, T.y0, T.nx, T.ny])
})
