// Where the rain graph is drawn for: parsing the Omarchy Weather location and
// this plugin's own saved pin, plus naming a clicked point. Pure functions.

// French cities offered as quick picks (the first four, the largest) and
// used to resolve a name-only Omarchy weather location. Coordinates are town
// centres, rounded to 4 decimals.
var cities = [
  { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
  { name: "Marseille", latitude: 43.2965, longitude: 5.3698 },
  { name: "Lyon", latitude: 45.7640, longitude: 4.8357 },
  { name: "Toulouse", latitude: 43.6047, longitude: 1.4442 },
  { name: "Nice", latitude: 43.7102, longitude: 7.2620 },
  { name: "Nantes", latitude: 47.2184, longitude: -1.5536 },
  { name: "Montpellier", latitude: 43.6108, longitude: 3.8767 },
  { name: "Strasbourg", latitude: 48.5734, longitude: 7.7521 },
  { name: "Bordeaux", latitude: 44.8378, longitude: -0.5792 },
  { name: "Lille", latitude: 50.6292, longitude: 3.0573 },
  { name: "Rennes", latitude: 48.1173, longitude: -1.6778 },
  { name: "Reims", latitude: 49.2583, longitude: 4.0317 },
  { name: "Le Havre", latitude: 49.4944, longitude: 0.1079 },
  { name: "Dijon", latitude: 47.3220, longitude: 5.0415 },
  { name: "Grenoble", latitude: 45.1885, longitude: 5.7245 },
  { name: "Clermont-Ferrand", latitude: 45.7772, longitude: 3.0870 },
  { name: "Brest", latitude: 48.3904, longitude: -4.4861 },
  { name: "Ajaccio", latitude: 41.9192, longitude: 8.7386 }
]

// Names people type for the same place. Keys are already folded.
var aliases = { "marseilles": "Marseille", "lyons": "Lyon", "clermont": "Clermont-Ferrand" }

function trim(value) {
  return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
}

function finiteNumber(value) {
  if (value === null || value === undefined || trim(value) === "") return null
  var number = parseFloat(trim(value))
  return isFinite(number) ? number : null
}

// Lower-case, without accents, hyphens and apostrophes as spaces, and "st" /
// "ste" spelled out, so "st etienne" == "Saint-Étienne" and "l hay" == "L'Haÿ".
var ACCENTS = [[/[àâä]/g, "a"], [/[éèêë]/g, "e"], [/[îï]/g, "i"], [/[ôö]/g, "o"], [/[ùûü]/g, "u"],
               [/ÿ/g, "y"], [/ç/g, "c"], [/œ/g, "oe"], [/æ/g, "ae"]]
function fold(name) {
  var s = trim(name).toLowerCase()
  for (var i = 0; i < ACCENTS.length; i++) s = s.replace(ACCENTS[i][0], ACCENTS[i][1])
  return s.replace(/[-'’.]/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").replace(/^ | $/g, "")
    .replace(/(^| )st /g, "$1saint ").replace(/(^| )ste /g, "$1sainte ")
}

function cityByName(name) {
  var key = fold(name)
  if (!key) return null
  if (aliases[key]) key = fold(aliases[key])
  for (var i = 0; i < cities.length; i++) if (fold(cities[i].name) === key) return cities[i]
  return null
}

function validCoords(latitude, longitude) {
  return latitude !== null && longitude !== null &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

// Omarchy's settings/weather.json: {"name", "latitude", "longitude"}, where
// the coordinates are optional ("a hand-written {"name": "Malibu"} alone
// works too"). A name without coordinates is resolved against the city list;
// anything else (an unknown name, junk) yields null. With no weather.json at
// all Omarchy detects the location from the IP address (wttr.in); this
// plugin does the same, but only when the user turns "Use location" on
// (parseWttrLocation, followsLocation).
function parseWeatherLocation(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    var name = trim(data.name)
    var latitude = finiteNumber(data.latitude), longitude = finiteNumber(data.longitude)
    if (validCoords(latitude, longitude)) return { name: name, latitude: latitude, longitude: longitude }
    var city = cityByName(name)
    return city ? { name: city.name, latitude: city.latitude, longitude: city.longitude } : null
  } catch (e) {
    return null
  }
}

// This plugin's own saved pin: {"name", "latitude", "longitude"}, coordinates
// required.
function parseSelection(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    var latitude = finiteNumber(data.latitude), longitude = finiteNumber(data.longitude)
    if (!validCoords(latitude, longitude)) return null
    return { name: trim(data.name), latitude: latitude, longitude: longitude }
  } catch (e) {
    return null
  }
}

// Whether the saved pin file says "follow my location" ({"followLocation":
// true}, written by the "Use location" chip when Omarchy has no weather.json).
function followsLocation(raw) {
  try {
    return JSON.parse(String(raw || "{}")).followLocation === true
  } catch (e) {
    return false
  }
}

// Whether the saved pin file says "no place" ({"noPlace": true}: the ✕, or
// "Change place" while following a location). Without it, an empty file
// means "follow the Omarchy weather location, if there is one".
function noPlace(raw) {
  try {
    return JSON.parse(String(raw || "{}")).noPlace === true
  } catch (e) {
    return false
  }
}

// The location Omarchy detects from the IP address when no weather location is
// stored: wttr.in's `?format=j1` answer, nearest_area. {name, latitude,
// longitude} or null. Approximate: it is where the internet connection seems
// to be, often the provider's area.
function parseWttrLocation(raw) {
  try {
    var area = JSON.parse(String(raw || "{}")).nearest_area[0]
    var latitude = finiteNumber(area.latitude), longitude = finiteNumber(area.longitude)
    if (!validCoords(latitude, longitude)) return null
    var name = area.areaName && area.areaName[0] ? trim(area.areaName[0].value) : ""
    return { name: name, latitude: latitude, longitude: longitude }
  } catch (e) {
    return null
  }
}

// Whether a point is in France: inside one of the outlines in `rings`
// (MapData.franceRings, [lon, lat] pairs) or within `toleranceKm` of one, so
// a click on the shore or a small island still counts.
function inFrance(rings, latitude, longitude, toleranceKm) {
  var kx = 111.2 * Math.cos(latitude * Math.PI / 180), ky = 111.2
  var tol = toleranceKm || 0
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r], inside = false
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
      if ((yi > latitude) !== (yj > latitude) && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside
      if (tol > 0) {
        // distance from the point to this edge, in km
        var ax = (xi - longitude) * kx, ay = (yi - latitude) * ky, bx = (xj - longitude) * kx, by = (yj - latitude) * ky
        var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy
        var t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
        if (Math.hypot(ax + t * dx, ay + t * dy) <= tol) return true
      }
    }
    if (inside) return true
  }
  return false
}

function serializeSelection(location) {
  return JSON.stringify({ name: location.name || "", latitude: location.latitude, longitude: location.longitude })
}

function distanceKm(latA, lonA, latB, lonB) {
  var rad = Math.PI / 180
  var dLat = (latB - latA) * rad, dLon = (lonB - lonA) * rad
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(latA * rad) * Math.cos(latB * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// A clicked point's name, from the town search's places (Towns.js rows:
// [name, latitude, longitude, population, ...]; without them, the quick-pick
// cities). On a place: its name ("Vierzon"); with several there, the most
// populous (the list's order). A place reaches as far as its people would
// cover at URBAN_DENSITY per km² (a circle: Lille about 5 km, Rennes 5 km,
// Dijon 4 km), at least ON_PLACE_KM, about what a click on the map can tell
// apart, and at most MAX_PLACE_KM (Paris is far denser: without the limit it
// would take in its inner suburbs). Else "near" the nearest town of at least
// NEAR_TOWN_POP people within NEAR_TOWN_KM ("near Vierzon"), else the nearest
// commune of any size within NEAR_ANY_KM, else "Pinned location" (out at sea).
var ON_PLACE_KM = 1.5, MAX_PLACE_KM = 5, NEAR_TOWN_KM = 12, NEAR_TOWN_POP = 1000, NEAR_ANY_KM = 6, URBAN_DENSITY = 3000

function reachKm(population) {
  return Math.min(MAX_PLACE_KM, Math.max(ON_PLACE_KM, Math.sqrt((population || 0) / (Math.PI * URBAN_DENSITY))))
}

function nameForPoint(latitude, longitude, towns) {
  var rows = towns && towns.length ? towns : cities.map(function(c) { return [c.name, c.latitude, c.longitude, NEAR_TOWN_POP] })
  var on = null, any = null, anyKm = Infinity, town = null, townKm = Infinity
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i]
    if (Math.abs(t[1] - latitude) > 0.2 || Math.abs(t[2] - longitude) > 0.35) continue // farther than NEAR_TOWN_KM
    var km = distanceKm(latitude, longitude, t[1], t[2])
    if (!on && km <= reachKm(t[3])) on = t // rows come most important first
    if (km < anyKm) { anyKm = km; any = t }
    if (t[3] >= NEAR_TOWN_POP && km < townKm) { townKm = km; town = t }
  }
  if (on) return on[0]
  if (town && townKm <= NEAR_TOWN_KM) return "near " + town[0]
  if (any && anyKm <= NEAR_ANY_KM) return "near " + any[0]
  return "Pinned location"
}

function formatCoords(latitude, longitude) {
  return Math.abs(latitude).toFixed(2) + "°" + (latitude >= 0 ? "N" : "S") + " " +
    Math.abs(longitude).toFixed(2) + "°" + (longitude >= 0 ? "E" : "W")
}

// The location the graph should use: the user's own pin wins over the
// Omarchy Weather location; either may be absent.
function resolve(selection, weather) {
  if (selection) return { name: selection.name, latitude: selection.latitude, longitude: selection.longitude, source: "pin" }
  if (weather) return { name: weather.name, latitude: weather.latitude, longitude: weather.longitude, source: "weather" }
  return null
}

// French communes matching what is being typed, for the panel's town search:
// up to `limit` of {name, latitude, longitude, label}, best first. `towns` is
// Towns.js's list ([name, lat, lon, population, department], most populous
// first). Case, accents and hyphens are ignored ("st etienne" finds
// Saint-Étienne); a name that is the query ranks first, then names starting
// with it, then names with a word starting with it, each in the list's order.
// The label carries the department, since many names repeat: "Saint-Aubin (39)".
// The folded names are kept on the list, so only the first search folds them.
function searchTowns(towns, query, limit) {
  var q = fold(query)
  if (!q || !towns) return []
  var alt = aliases[q] ? fold(aliases[q]) : ""
  var max = limit || 5
  if (!towns.folded) towns.folded = towns.map(function(t) { return fold(t[0]) })
  var found = [[], [], []]
  for (var i = 0; i < towns.length; i++) {
    var key = towns.folded[i]
    var rank = 3
    if (key === q || (alt && key === alt)) rank = 0
    else if (key.indexOf(q) === 0) rank = 1
    else if (key.indexOf(" " + q) >= 0) rank = 2
    if (rank < 3 && found[rank].length < max) found[rank].push(towns[i])
  }
  var best = found[0].concat(found[1], found[2]).slice(0, max)
  return best.map(function(t) {
    return { name: t[0], latitude: t[1], longitude: t[2], label: t[4] ? t[0] + " (" + t[4] + ")" : t[0] }
  })
}

if (typeof module !== "undefined") module.exports = {
  cities: cities,
  followsLocation: followsLocation,
  noPlace: noPlace,
  parseWttrLocation: parseWttrLocation,
  inFrance: inFrance,
  searchTowns: searchTowns,
  fold: fold,
  cityByName: cityByName,
  parseWeatherLocation: parseWeatherLocation,
  parseSelection: parseSelection,
  serializeSelection: serializeSelection,
  distanceKm: distanceKm,
  nameForPoint: nameForPoint,
  formatCoords: formatCoords,
  resolve: resolve
}
