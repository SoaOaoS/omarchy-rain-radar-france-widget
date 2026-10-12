const { test } = require('node:test')
const assert = require('node:assert/strict')
const RadarModel = require('../RadarModel.js')

// RainViewer's index as captured on 2026-10-12 (shortened to three frames, out of order).
const index = JSON.stringify({
  version: '2.0', generated: 1791810626, host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1791810600, path: '/v2/radar/ee8389ccb409' },
      { time: 1791809400, path: '/v2/radar/fc1a2fc91481' },
      { time: 1791810000, path: '/v2/radar/bfd1adbd9c78' }
    ],
    nowcast: []
  }
})

test('parseIndex gives the frames sorted by time, each with an id made from its time', () => {
  const items = RadarModel.parseIndex(index)
  assert.deepEqual(items.map((i) => i.id), ['rv.1791809400', 'rv.1791810000', 'rv.1791810600'])
  assert.equal(items[2].datetime, '2026-10-12T13:10:00Z')
  assert.equal(items[2].path, '/v2/radar/ee8389ccb409')
})

test('parseIndex tolerates malformed input', () => {
  assert.deepEqual(RadarModel.parseIndex('not json'), [])
  assert.deepEqual(RadarModel.parseIndex(''), [])
  assert.deepEqual(RadarModel.parseIndex('{"radar":{"past":"x"}}'), [])
  assert.deepEqual(RadarModel.parseIndex('{"radar":{"past":[null,{"time":"soon","path":"/v2/radar/a"},{"time":1791810600}]}}'), [])
})

test('a frame whose path is not RainViewer\'s own form is dropped', () => {
  const bad = ['https://evil.example/x', '/v2/radar/../../etc', '/v2/radar/abc?x=1', '/v2/radar/a/b', '//evil.example/v2/radar/abc', '']
  for (const path of bad) {
    assert.equal(RadarModel.isSafeFramePath(path), false, path)
    assert.deepEqual(RadarModel.parseIndex(JSON.stringify({ radar: { past: [{ time: 1791810600, path }] } })), [])
    assert.deepEqual(RadarModel.tileUrls(path), [])
  }
  assert.ok(RadarModel.isSafeFramePath('/v2/radar/ee8389ccb409'))
})

test('frame ids are safe file names', () => {
  assert.ok(RadarModel.isSafeFrameId('rv.1791810600'))
  for (const id of ['rv.', 'rv.12', '../rv.1791810600', 'rv.1791810600/x', 'rv.17918106000000', 42, null])
    assert.equal(RadarModel.isSafeFrameId(id), false, String(id))
})

test('tileUrls: the four zoom-5 tiles over France, from the tile host, exact colours', () => {
  const tiles = RadarModel.tileUrls('/v2/radar/ee8389ccb409')
  assert.deepEqual(tiles.map((t) => [t.x, t.y]), [[15, 10], [16, 10], [15, 11], [16, 11]])
  assert.equal(tiles[0].url, 'https://tilecache.rainviewer.com/v2/radar/ee8389ccb409/512/5/15/10/2/0_0.png')
  for (const t of tiles) assert.ok(t.url.startsWith(RadarModel.TILE_HOST + '/v2/radar/'))
})

test('newItems leaves out the frames already converted', () => {
  const items = RadarModel.parseIndex(index)
  assert.deepEqual(RadarModel.newItems(items, { 'rv.1791810000': true }).map((i) => i.id), ['rv.1791809400', 'rv.1791810600'])
  assert.equal(RadarModel.newItems(items).length, 3)
})

test('dbzToRainRate is Marshall-Palmer', () => {
  assert.ok(Math.abs(RadarModel.dbzToRainRate(23) - 1) < 0.01) // 200 * 1^1.6 = 200 = 23 dBZ
  assert.ok(Math.abs(RadarModel.dbzToRainRate(39) - 10) < 0.1)
  assert.equal(RadarModel.dbzToRainRate(NaN), 0)
  assert.equal(RadarModel.dbzToRainRate('30'), 0)
})
