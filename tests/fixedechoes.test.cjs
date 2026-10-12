const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const FixedEchoes = require('../FixedEchoes.js')
const MapModel = require('../MapModel.js')

const helper = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'radar-convert.py'), 'utf8')

function grid(fill) {
  return { cols: FixedEchoes.COLS, rows: FixedEchoes.ROWS, bounds: Object.assign({}, FixedEchoes.BOUNDS),
    values: new Array(FixedEchoes.COLS * FixedEchoes.ROWS).fill(fill) }
}

test('the mask is made for the converter\'s grid over the map', () => {
  const m = helper.match(/^GRID_COLS, GRID_ROWS = (\d+), (\d+)$/m)
  assert.deepEqual([Number(m[1]), Number(m[2])], [FixedEchoes.COLS, FixedEchoes.ROWS])
  assert.deepEqual(FixedEchoes.BOUNDS, { west: MapModel.bounds.west, south: MapModel.bounds.south, east: MapModel.bounds.east, north: MapModel.bounds.north })
  assert.ok(FixedEchoes.applies(grid(0)))
})

test('no fixed echoes are mapped for France yet: filling changes nothing', () => {
  assert.equal(FixedEchoes.CELLS.length, 0)
  const g = grid(1.5)
  g.values[1234] = 9
  const before = g.values.slice()
  assert.equal(FixedEchoes.fill(g), g)
  assert.deepEqual(g.values, before)
})

test('every masked cell lies inside the grid', () => {
  for (const [row, col] of FixedEchoes.CELLS)
    assert.ok(row >= 0 && row < FixedEchoes.ROWS && col >= 0 && col < FixedEchoes.COLS)
})

test('other grids (another box, other sizes) are not touched', () => {
  assert.equal(FixedEchoes.applies({ cols: 4, rows: 2, bounds: FixedEchoes.BOUNDS, values: [0, 0, 0, 0, 0, 0, 0, 0] }), false)
  const other = grid(0)
  other.bounds.west -= 1
  assert.equal(FixedEchoes.applies(other), false)
})
