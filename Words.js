// The panel's words in French and English, and the French names of the places
// the models name in English. The forecast's own sentences are in
// PointSeries.summary and ChanceModel.parts (both take the same `lang`).
// Pure functions (no QML), unit-tested.

// A saved or asked-for language ("en", "English"; anything else French) as a code.
function language(value) {
  return value === "English" || value === "en" ? "en" : "fr"
}

var TEXT = {
  en: {
    rainRadar: "Rain radar",
    france: "France",
    peak: "peak",
    past: "PAST",
    projected: "PROJECTED",
    needsPython: "needs Python 3 to read the radar",
    radarOld: function(lead) { return "radar " + lead + " old" },
    dataAge: function(time, lead) { return "Radar from " + time + " · " + lead + " ago" },
    delayed: "the radar may be delayed; the nowcast runs from then",
    rainAtLocation: "Rain at a location",
    done: "Done",
    changePlace: "Change place",
    finding: "Finding your location…",
    intro: "Click the map in France or pick a town to see the rain falling there, and what to expect over the next 90 minutes.",
    locating: "Locating…",
    useLocation: "Use location",
    noWttr: "Could not find your location (wttr.in did not answer). Pick a place instead.",
    outside: function(name) { return "Your location (" + (name || "unknown") + ") is outside France. Pick a place instead." },
    townPlaceholder: "French town or village",
    noTown: "No French commune by that name",
    lastKnown: "Showing last known data — ",
    how: "How does it work?",
    data: "Data: RainViewer",
    otherLanguage: "Français",
    light: "Light", heavy: "Heavy", extreme: "Extreme",
    edge: "Rain from beyond the map's edge: a guess (brighter = heavier)",
    now: "now",
    chanceOfRain: "chance of rain",
    chance: "chance",
    unit: "mm/h",
    pythonMissing: "Python 3 is needed to read the radar pictures, and was not found.",
    formatChanged: "RainViewer's radar pictures have changed, and this version cannot read them.",
    noData: "No data available.",
    needTwo: "Need at least two recent radar frames to extrapolate — showing observed radar only.",
    cannotExtrapolate: "Could not read radar data for extrapolation — showing observed radar only.",
    noApi: "Could not reach RainViewer's radar."
  },
  fr: {
    rainRadar: "Radar de pluie",
    france: "France",
    peak: "max.",
    past: "PASSÉ",
    projected: "PRÉVISION",
    needsPython: "Python 3 est nécessaire pour lire le radar",
    radarOld: function(lead) { return "radar vieux de " + lead },
    dataAge: function(time, lead) { return "Radar de " + time + " · il y a " + lead },
    delayed: "le radar est peut-être en retard ; la prévision part de là",
    rainAtLocation: "La pluie à un endroit",
    done: "Terminé",
    changePlace: "Changer de lieu",
    finding: "Recherche de votre position…",
    intro: "Cliquez sur la carte en France ou choisissez une commune pour voir la pluie qui y tombe et ce qui est attendu dans les 90 prochaines minutes.",
    locating: "Localisation…",
    useLocation: "Ma position",
    noWttr: "Position introuvable (wttr.in n'a pas répondu). Choisissez plutôt un lieu.",
    outside: function(name) { return "Votre position (" + (name || "inconnue") + ") est hors de France. Choisissez plutôt un lieu." },
    townPlaceholder: "Ville ou village de France",
    noTown: "Aucune commune française de ce nom",
    lastKnown: "Dernières données connues — ",
    how: "Comment ça marche ?",
    data: "Données : RainViewer",
    otherLanguage: "English",
    light: "Faible", heavy: "Forte", extreme: "Extrême",
    edge: "Pluie venue d'au-delà du bord de la carte : une estimation (plus clair = plus fort)",
    now: "mnt",
    chanceOfRain: "risque de pluie",
    chance: "risque",
    unit: "mm/h",
    pythonMissing: "Python 3 est nécessaire pour lire les images radar, et il est introuvable.",
    formatChanged: "Les images radar de RainViewer ont changé, et cette version ne sait pas les lire.",
    noData: "Aucune donnée disponible.",
    needTwo: "Il faut au moins deux images radar récentes pour prévoir — seul le radar observé est affiché.",
    cannotExtrapolate: "Impossible de lire les données radar pour la prévision — seul le radar observé est affiché.",
    noApi: "Impossible de joindre le radar de RainViewer."
  }
}

// The word for `key` in `lang` (English if French lacks it); a word that
// takes values (dataAge, outside, radarOld) gets them as the further arguments.
function t(key, lang) {
  var table = TEXT[lang] || TEXT.en
  var w = key in table ? table[key] : TEXT.en[key]
  return typeof w === "function" ? w.apply(null, Array.prototype.slice.call(arguments, 2)) : w
}

// The models name some places in English (LocationModel's "near …", "Pinned
// location"; MapData's country labels): their French names. "near Avignon"
// becomes "près d'Avignon".
var FRENCH_NAMES = { "United Kingdom": "Royaume-Uni", Spain: "Espagne", Italy: "Italie", Switzerland: "Suisse",
                     Germany: "Allemagne", Belgium: "Belgique" }
function placeName(name, lang) {
  if (lang !== "fr" || !name) return name
  if (name === "Pinned location") return "Lieu choisi"
  if (name.indexOf("near ") !== 0) return FRENCH_NAMES[name] || name
  var base = name.slice(5)
  return (/^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(base) ? "près d'" : "près de ") + base
}

if (typeof module !== "undefined") module.exports = {
  TEXT: TEXT,
  language: language,
  t: t,
  placeName: placeName
}
