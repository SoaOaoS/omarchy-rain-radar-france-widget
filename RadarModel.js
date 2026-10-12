// RainViewer radar client logic — pure functions, no Process/IO here (that
// lives in DataService.qml), so this is unit-testable with `node --test`.
//
// RainViewer (https://www.rainviewer.com/api.html) publishes a worldwide radar
// composite as map tiles, no API key needed: a small JSON index of the last
// two hours' frames (one every 10 minutes), each with a path under which its
// tiles are served. Over France the composite comes from Météo-France's radar
// network. Verified live on 2026-10-12: 13 frames 10 minutes apart, the newest
// published within about a minute of its time stamp; tiles up to zoom 7, PNG,
// in the "Universal Blue" colours whatever colour scheme is asked for, one
// colour per dBZ (helpers/radar-convert.py turns them back into mm/h).
//
// Météo-France's own radar mosaics are open data too, but only through its
// API portal, which needs a personal key: that is why this widget, which has
// to work on a standard install with nothing to set up, reads RainViewer.

var INDEX_URL = "https://api.rainviewer.com/public/weather-maps.json"
// Tiles are downloaded from this host only, whatever the index says.
var TILE_HOST = "https://tilecache.rainviewer.com"

// The four zoom-5 tiles (512 px) that cover the map: columns 15-16, rows
// 10-11, 11.25 W - 11.25 E and 40.98 - 55.78 N, about 1.7 km per pixel over
// France. helpers/radar-convert.py keeps its own copy of these numbers
// (tests/maprange.test.cjs fails if they drift apart).
var TILES = { zoom: 5, size: 512, x0: 15, y0: 10, nx: 2, ny: 2 }

// A frame's id becomes a file name in the widget's cache (and the converter's
// input and output), so it is built here from the frame's time alone:
// "rv.<unix seconds>".
var FRAME_ID = /^rv\.[0-9]{9,11}$/
// A frame's path goes into the tile URLs: only RainViewer's own form is
// accepted, so nothing else (a host, "..", a query) can be asked for.
var FRAME_PATH = /^\/v2\/radar\/[A-Za-z0-9_]{1,64}$/

function isSafeFrameId(id) {
  return typeof id === "string" && FRAME_ID.test(id)
}

function isSafeFramePath(path) {
  return typeof path === "string" && FRAME_PATH.test(path)
}

// The tiles of one frame: [{x, y, url}], west to east, north to south.
// Colour scheme 2 (Universal Blue), no smoothing, no snow colours: the
// converter needs each pixel's exact colour.
function tileUrls(path) {
  if (!isSafeFramePath(path)) return []
  var out = []
  for (var y = TILES.y0; y < TILES.y0 + TILES.ny; y++)
    for (var x = TILES.x0; x < TILES.x0 + TILES.nx; x++)
      out.push({ x: x, y: y, url: TILE_HOST + path + "/" + TILES.size + "/" + TILES.zoom + "/" + x + "/" + y + "/2/0_0.png" })
  return out
}

// Parses RainViewer's index into a flat, time-sorted list of
// { id, datetime, path }. Malformed or partial entries are skipped.
function parseIndex(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    var past = data.radar && Array.isArray(data.radar.past) ? data.radar.past : []
    var items = []
    for (var i = 0; i < past.length; i++) {
      var f = past[i] || {}
      var time = typeof f.time === "number" && isFinite(f.time) ? Math.round(f.time) : NaN
      var id = "rv." + time
      if (!isSafeFrameId(id) || !isSafeFramePath(f.path)) continue
      items.push({ id: id, datetime: new Date(time * 1000).toISOString().replace(".000Z", "Z"), path: f.path })
    }
    items.sort(function(a, b) { return a.datetime < b.datetime ? -1 : (a.datetime > b.datetime ? 1 : 0) })
    return items
  } catch (e) {
    return []
  }
}

// Only the frames not already converted this session need downloading.
// `cachedIds` is a plain object used as a set.
function newItems(items, cachedIds) {
  cachedIds = cachedIds || {}
  return items.filter(function(item) { return !cachedIds[item.id] })
}

// Marshall-Palmer Z-R relationship: Z = a * R^b (Z in mm^6/m^3, dBZ =
// 10*log10(Z)), inverted to solve for R (mm/h) given dBZ. The same formula as
// helpers/radar-convert.py's, kept here too so it is unit-tested.
function dbzToRainRate(dbz, zrA, zrB) {
  var a = typeof zrA === "number" ? zrA : 200
  var b = typeof zrB === "number" ? zrB : 1.6
  if (typeof dbz !== "number" || !isFinite(dbz)) return 0
  var z = Math.pow(10, dbz / 10)
  var rate = Math.pow(z / a, 1 / b)
  return isFinite(rate) ? rate : 0
}

if (typeof module !== "undefined") module.exports = {
  INDEX_URL: INDEX_URL,
  TILE_HOST: TILE_HOST,
  TILES: TILES,
  isSafeFrameId: isSafeFrameId,
  isSafeFramePath: isSafeFramePath,
  tileUrls: tileUrls,
  parseIndex: parseIndex,
  newItems: newItems,
  dbzToRainRate: dbzToRainRate
}
