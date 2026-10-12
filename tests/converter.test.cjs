const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const RadarModel = require('../RadarModel.js')
const MapModel = require('../MapModel.js')

const helper = path.join(__dirname, '..', 'helpers', 'radar-convert.py')
const T = RadarModel.TILES

// A 512 x 512 RGBA PNG (no filter) from a function giving each pixel's colour.
function png(colourAt) {
  const stride = T.size * 4 + 1
  const raw = Buffer.alloc(stride * T.size)
  for (let y = 0; y < T.size; y++)
    for (let x = 0; x < T.size; x++) {
      const c = colourAt(x, y)
      if (c) raw.set(c, y * stride + 1 + x * 4)
    }
  const chunk = (tag, body) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0)
    out.write(tag, 4, 'latin1')
    body.copy(out, 8)
    out.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(tag, 'latin1'), body])), 8 + body.length)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(T.size, 0); head.writeUInt32BE(T.size, 4); head[8] = 8; head[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// The frame's four tiles, written as <dir>/in.<x>.<y>.png; `colourAt` gets mosaic pixel coordinates.
function writeTiles(dir, colourAt) {
  for (let ty = 0; ty < T.ny; ty++)
    for (let tx = 0; tx < T.nx; tx++)
      fs.writeFileSync(path.join(dir, `in.${T.x0 + tx}.${T.y0 + ty}.png`), png((x, y) => colourAt(tx * T.size + x, ty * T.size + y)))
}

function run(dir, out) {
  try { execFileSync('python3', [helper, path.join(dir, 'in'), out || path.join(dir, 'out')], { stdio: 'pipe' }); return 0 } catch (e) { return e.status }
}

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-radar-convert-'))
  try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// A place's pixel in the tile mosaic (Web Mercator, as any slippy map).
function mosaicPixel(latitude, longitude) {
  const world = T.size * 2 ** T.zoom
  const phi = latitude * Math.PI / 180
  return {
    x: Math.floor((longitude + 180) / 360 * world) - T.x0 * T.size,
    y: Math.floor((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * world) - T.y0 * T.size
  }
}

function cellOf(grid, latitude, longitude) {
  const b = grid.bounds
  return Math.floor((b.north - latitude) / (b.north - b.south) * grid.rows) * grid.cols +
    Math.floor((longitude - b.west) / (b.east - b.west) * grid.cols)
}

const BLUE_30_DBZ = [0x00, 0x55, 0x88, 0xff] // 30 dBZ: 2.73 mm/h
const FAINT_M10_DBZ = [0x63, 0x61, 0x59, 0x14] // -10 dBZ: far below the 0.05 mm/h floor

test('rain painted over Paris and Ajaccio lands in their grid cells, at Marshall-Palmer\'s rate', () => {
  withDir((dir) => {
    const places = [[48.8566, 2.3522], [41.9192, 8.7386]]
    const spots = places.map(([lat, lon]) => mosaicPixel(lat, lon))
    // a 9 x 9 pixel square (about 15 km) around each place: it covers the place's whole cell
    writeTiles(dir, (x, y) => spots.some((s) => Math.abs(x - s.x) <= 4 && Math.abs(y - s.y) <= 4) ? BLUE_30_DBZ : null)
    assert.equal(run(dir), 0)
    const grid = JSON.parse(fs.readFileSync(path.join(dir, 'out.nowcast-grid.json'), 'utf8'))
    assert.equal(grid.cols * grid.rows, grid.values.length)
    assert.deepEqual(grid.bounds, { west: MapModel.bounds.west, south: MapModel.bounds.south, east: MapModel.bounds.east, north: MapModel.bounds.north })
    const rate = RadarModel.dbzToRainRate(30)
    for (const [lat, lon] of places)
      assert.ok(Math.abs(grid.values[cellOf(grid, lat, lon)] - rate) < 0.01, `cell at ${lat}, ${lon}: ${grid.values[cellOf(grid, lat, lon)]}`)
    // and nowhere far from them: Brest, Strasbourg, Toulouse are dry
    for (const [lat, lon] of [[48.39, -4.49], [48.57, 7.75], [43.6, 1.44]]) assert.equal(grid.values[cellOf(grid, lat, lon)], 0)
    const wet = grid.values.filter((v) => v > 0).length
    assert.ok(wet >= 2 && wet <= 40, `${wet} wet cells`)
  })
})

test('the map image is an RGBA PNG with the converter\'s size', () => {
  withDir((dir) => {
    writeTiles(dir, () => null)
    assert.equal(run(dir), 0)
    const out = fs.readFileSync(path.join(dir, 'out.png'))
    assert.deepEqual([...out.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert.equal(out.readUInt32BE(16), 800)
    assert.equal(out.readUInt32BE(20), 639)
    assert.equal(out[25], 6) // colour type RGBA
    const grid = JSON.parse(fs.readFileSync(path.join(dir, 'out.nowcast-grid.json'), 'utf8'))
    assert.ok(grid.values.every((v) => v === 0), 'transparent tiles are a dry map')
  })
})

test('echoes below the 0.05 mm/h floor count as dry', () => {
  withDir((dir) => {
    writeTiles(dir, () => FAINT_M10_DBZ)
    assert.equal(run(dir), 0)
    const grid = JSON.parse(fs.readFileSync(path.join(dir, 'out.nowcast-grid.json'), 'utf8'))
    assert.ok(grid.values.every((v) => v === 0))
  })
})

test('a real frame (12 October 2026, 13:10 UTC) converts: showers, nothing absurd', () => {
  withDir((dir) => {
    for (let ty = 0; ty < T.ny; ty++)
      for (let tx = 0; tx < T.nx; tx++) {
        const name = `${T.x0 + tx}.${T.y0 + ty}.png`
        fs.copyFileSync(path.join(__dirname, 'fixtures', 'frame.' + name), path.join(dir, 'in.' + name))
      }
    assert.equal(run(dir), 0)
    const grid = JSON.parse(fs.readFileSync(path.join(dir, 'out.nowcast-grid.json'), 'utf8'))
    const wet = grid.values.filter((v) => v >= 0.1).length
    assert.ok(wet > 500 && wet < grid.values.length / 4, `${wet} wet cells`)
    assert.ok(Math.max(...grid.values) < 150)
  })
})

test('pictures in other colours stop with exit code 2, not a wrong map', () => {
  withDir((dir) => {
    writeTiles(dir, (x, y) => x < 100 && y > 300 ? [1, 2, 3, 255] : null)
    assert.equal(run(dir), 2)
    assert.equal(fs.existsSync(path.join(dir, 'out.nowcast-grid.json')), false)
  })
})

test('a damaged or missing tile, or an output outside its folder, is refused with exit code 2', () => {
  withDir((dir) => {
    writeTiles(dir, () => null)
    assert.equal(run(dir, path.join(dir, '..', '..', 'etc', 'x;y')), 2)
    assert.equal(run(dir, path.join(dir, 'no-such-folder', 'out')), 2)
    const tile = path.join(dir, `in.${T.x0}.${T.y0}.png`)
    const whole = fs.readFileSync(tile)
    fs.writeFileSync(tile, whole.subarray(0, 60)) // cut short
    assert.equal(run(dir), 2)
    fs.writeFileSync(tile, 'not a PNG file')
    assert.equal(run(dir), 2)
    fs.rmSync(tile)
    assert.equal(run(dir), 2)
  })
})
