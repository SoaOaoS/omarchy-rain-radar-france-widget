const { test } = require('node:test')
const assert = require('node:assert/strict')
const Location = require('../LocationModel.js')
const MapModel = require('../MapModel.js')

test('the Omarchy weather file is parsed with its own coordinates', () => {
  assert.deepEqual(
    Location.parseWeatherLocation('{"name":"Vierzon","latitude":47.2221,"longitude":2.0684}'),
    { name: 'Vierzon', latitude: 47.2221, longitude: 2.0684 })
  // coordinates may be stored as strings
  assert.equal(Location.parseWeatherLocation('{"name":"X","latitude":"45.5","longitude":"1.5"}').latitude, 45.5)
})

test('a name-only weather file resolves through the city list, whatever the case and accents', () => {
  assert.equal(Location.parseWeatherLocation('{"name":"Lyon"}').latitude, 45.764)
  assert.equal(Location.parseWeatherLocation('{"name":"MARSEILLE"}').name, 'Marseille')
  assert.equal(Location.parseWeatherLocation('{"name":"Marseilles"}').name, 'Marseille')
  assert.equal(Location.parseWeatherLocation('{"name":"clermont ferrand"}').name, 'Clermont-Ferrand')
})

test('an unknown name, junk or missing file yields null rather than a guess', () => {
  assert.equal(Location.parseWeatherLocation('{"name":"Malibu"}'), null)
  assert.equal(Location.parseWeatherLocation('not json'), null)
  assert.equal(Location.parseWeatherLocation(''), null)
  assert.equal(Location.parseWeatherLocation(null), null)
  assert.equal(Location.parseWeatherLocation('{"name":"X","latitude":95,"longitude":10}'), null)
  assert.equal(Location.parseWeatherLocation('{"name":"X","latitude":null,"longitude":null}'), null)
})

test('a saved pin needs coordinates and round-trips', () => {
  const pin = { name: 'Lyon', latitude: 45.764, longitude: 4.8357 }
  assert.deepEqual(Location.parseSelection(Location.serializeSelection(pin)), pin)
  assert.equal(Location.parseSelection('{"name":"Lyon"}'), null)
  assert.equal(Location.parseSelection('{}'), null)
  assert.equal(Location.parseSelection('nope'), null)
  assert.equal(Location.parseSelection('{"latitude":"","longitude":""}'), null)
})

test('a clicked point is named after a city within range, else left generic', () => {
  // without the town list: the quick-pick cities
  assert.equal(Location.nameForPoint(43.605, 1.444), 'Toulouse')
  assert.equal(Location.nameForPoint(43.65, 1.50), 'near Toulouse')
  assert.equal(Location.nameForPoint(46.0, 1.5), 'Pinned location')
  assert.equal(Location.nameForPoint(45.0, -5.0), 'Pinned location') // out at sea
})

test('distanceKm is sensible', () => {
  const d = Location.distanceKm(48.8566, 2.3522, 45.764, 4.8357) // Paris-Lyon
  assert.ok(d > 385 && d < 400, String(d))
  assert.equal(Location.distanceKm(45, 2, 45, 2), 0)
})

test('the user pin wins over the Omarchy Weather location', () => {
  const pin = { name: 'Pin', latitude: 55, longitude: 10 }
  const weather = { name: 'Weather', latitude: 56, longitude: 11 }
  assert.equal(Location.resolve(pin, weather).source, 'pin')
  assert.equal(Location.resolve(null, weather).source, 'weather')
  assert.equal(Location.resolve(null, null), null)
})

test('formatCoords', () => {
  assert.equal(Location.formatCoords(48.8566, 2.3522), '48.86°N 2.35°E')
  assert.equal(Location.formatCoords(-1.5, -2.25), '1.50°S 2.25°W')
})

test('every quick-pick city lies inside the map and is unique', () => {
  const seen = new Set()
  for (const c of Location.cities) {
    assert.ok(MapModel.contains(c.latitude, c.longitude), c.name)
    assert.ok(!seen.has(c.name), 'duplicate ' + c.name)
    seen.add(c.name)
  }
})

test('unproject inverts project across the map, and clicks outside the window are detectable', () => {
  for (const [w, h] of [[560, 480], [700, 600], [300, 260]]) {
    for (const [lat, lon] of [[48.8566, 2.3522], [43.2965, 5.3698], [41.5, -8.0], [51.0, 9.5]]) {
      const p = MapModel.project(lat, lon, w, h)
      const back = MapModel.unproject(p.x, p.y, w, h)
      assert.ok(Math.abs(back.latitude - lat) < 1e-9 && Math.abs(back.longitude - lon) < 1e-9)
    }
  }
  const outside = MapModel.unproject(0, 0, 560, 480)
  assert.equal(MapModel.inView(outside.latitude, outside.longitude), false)
  assert.equal(MapModel.inView(48.8, 2.3), true)
  assert.equal(MapModel.unproject(10, 10, 0, 0), null)
})

const Towns = require('../Towns.js').towns

test('town search finds French communes as typed, ignoring case, accents and hyphens', () => {
  const names = (q) => Location.searchTowns(Towns, q, 5).map((m) => m.name)
  assert.equal(names('bezier')[0], 'Béziers')
  assert.equal(names('st etienne')[0], 'Saint-Étienne')   // "st" spelled out
  assert.equal(names('SAINT-MALO')[0], 'Saint-Malo')
  assert.equal(names("l'hay")[0], "L'Haÿ-les-Roses")
  assert.equal(names('marseilles')[0], 'Marseille')        // the English spelling
  assert.deepEqual(names(''), [])
  assert.deepEqual(names('zzzz'), [])
})

test('town search: an exact name first, then larger places; every match says its department', () => {
  const m = Location.searchTowns(Towns, 'saint-aubin', 5)
  assert.equal(m.length, 5)
  assert.ok(m.every((x) => x.name === 'Saint-Aubin' && /^Saint-Aubin \((\d\d|2[AB])\)$/.test(x.label)), JSON.stringify(m))
  assert.equal(new Set(m.map((x) => x.label)).size, 5)
  // the small town of that exact name before the larger ones that only start with it
  assert.equal(Location.searchTowns(Towns, 'eu', 3)[0].label, 'Eu (76)')
  assert.equal(Location.searchTowns(Towns, 'lyon', 3)[0].label, 'Lyon (69)')
  assert.ok(Math.abs(Location.searchTowns(Towns, 'lyon', 1)[0].latitude - 45.76) < 0.02)
})

test('the town list covers mainland France and Corsica, and stays inside the map', () => {
  assert.ok(Towns.length > 30000)
  assert.ok(Towns.every((t) => MapModel.contains(t[1], t[2])))
  assert.ok(Towns.every((t) => !/^9[78]/.test(t[4])), 'no overseas commune')
  for (const n of ['Paris', 'Marseille', 'Brest', 'Ajaccio', 'Bonifacio', 'Dunkerque', 'Strasbourg', 'Perpignan', 'Menton'])
    assert.ok(Towns.some((t) => t[0] === n), n)
})

test('the quick picks start with the four largest towns, by population', () => {
  const pop = (name) => {
    const t = Towns.find((r) => r[0] === name)
    assert.ok(t, name)
    return t[3]
  }
  const four = Location.cities.slice(0, 4).map((c) => pop(c.name))
  for (let i = 1; i < 4; i++) assert.ok(four[i] < four[i - 1], `${Location.cities[i].name} after ${Location.cities[i - 1].name}`)
  const largestRest = Math.max(...Location.cities.slice(4).map((c) => pop(c.name)))
  assert.ok(four[3] > largestRest, 'no later quick pick is larger than the fourth')
})

const MapData = require('../MapData.js')

test('inFrance: French land and the shore count; the neighbours and the open sea do not', () => {
  const fr = (lat, lon) => Location.inFrance(MapData.franceRings, lat, lon, 3)
  for (const [n, lat, lon] of [['Paris', 48.86, 2.35], ['Brest', 48.39, -4.49], ['Ajaccio', 41.92, 8.74],
    ['Strasbourg', 48.57, 7.75], ['Lille', 50.63, 3.06], ['Nice', 43.70, 7.25]]) assert.ok(fr(lat, lon), n)
  for (const [n, lat, lon] of [['Barcelona', 41.39, 2.17], ['Brussels', 50.85, 4.35], ['Turin', 45.07, 7.69],
    ['London', 51.5, -0.12], ['Bay of Biscay', 45.5, -4.0], ['Jersey', 49.21, -2.13], ['Geneva', 46.2, 6.14]]) assert.ok(!fr(lat, lon), n)
  // a point 2 km off the Landes coast counts with the tolerance, not without it
  assert.ok(!Location.inFrance(MapData.franceRings, 44.2, -1.33, 0) && fr(44.2, -1.33))
})

test('the remembered "follow my location" choice and wttr.in\'s answer are read safely', () => {
  assert.equal(Location.followsLocation('{"followLocation": true}'), true)
  assert.equal(Location.followsLocation('{}'), false)
  assert.equal(Location.followsLocation('junk'), false)
  const j1 = JSON.stringify({ nearest_area: [{ areaName: [{ value: 'Villeurbanne' }], latitude: '45.767', longitude: '4.883' }] })
  assert.deepEqual(Location.parseWttrLocation(j1), { name: 'Villeurbanne', latitude: 45.767, longitude: 4.883 })
  assert.equal(Location.parseWttrLocation('{}'), null)
  assert.equal(Location.parseWttrLocation('not json'), null)
})

test('"no place" is read from the saved pin file, and nothing else is mistaken for it', () => {
  assert.equal(Location.noPlace('{"noPlace": true}'), true)
  assert.equal(Location.noPlace('{}'), false)
  assert.equal(Location.noPlace('{"followLocation": true}'), false)
  assert.equal(Location.noPlace('junk'), false)
})

test('a map click is named from the town list: on a place, else near a town', () => {
  const towns = require('../Towns.js').towns
  // a small town, clicked on its centre
  const beziers = towns.find((t) => t[0] === 'Béziers')
  assert.equal(Location.nameForPoint(beziers[1], beziers[2], towns), 'Béziers')
  // central Paris, and a suburb that keeps its own name: Paris does not reach over it
  assert.equal(Location.nameForPoint(48.8566, 2.3522, towns), 'Paris')
  const versailles = towns.find((t) => t[0] === 'Versailles')
  assert.equal(Location.nameForPoint(versailles[1], versailles[2], towns), 'Versailles')
  // open country: never a name that claims to be the place itself
  assert.equal(Location.nameForPoint(47.22, 2.07, towns), 'near Vierzon')
  // the Bay of Biscay
  assert.equal(Location.nameForPoint(45.5, -4.0, towns), 'Pinned location')
})
