const { test } = require('node:test')
const assert = require('node:assert/strict')
const Words = require('../Words.js')

test('a saved language: French unless English', () => {
  assert.equal(Words.language('English'), 'en')
  assert.equal(Words.language('en'), 'en')
  assert.equal(Words.language('fr'), 'fr')
  assert.equal(Words.language(undefined), 'fr')
})

test('French has every English word', () => {
  assert.deepEqual(Object.keys(Words.TEXT.fr).sort(), Object.keys(Words.TEXT.en).sort())
})

test('words that take values', () => {
  assert.equal(Words.t('dataAge', 'en', '14:20', '20 min'), 'Radar from 14:20 · 20 min ago')
  assert.equal(Words.t('dataAge', 'fr', '14:20', '20 min'), 'Radar de 14:20 · il y a 20 min')
  assert.equal(Words.t('outside', 'fr', 'Genève'), 'Votre position (Genève) est hors de France. Choisissez plutôt un lieu.')
  assert.equal(Words.t('light', 'xx'), 'Light')
})

test('places the models name in English, in French', () => {
  assert.equal(Words.placeName('near Vierzon', 'fr'), 'près de Vierzon')
  assert.equal(Words.placeName('near Avignon', 'fr'), 'près d\'Avignon')
  assert.equal(Words.placeName('near Épinal', 'fr'), 'près d\'Épinal')
  assert.equal(Words.placeName('near Le Havre', 'fr'), 'près du Havre')
  assert.equal(Words.placeName('near Les Sables-d\'Olonne', 'fr'), 'près des Sables-d\'Olonne')
  assert.equal(Words.placeName('near La Rochelle', 'fr'), 'près de La Rochelle')
  assert.equal(Words.placeName('Pinned location', 'fr'), 'Lieu choisi')
  assert.equal(Words.placeName('Germany', 'fr'), 'Allemagne')
  assert.equal(Words.placeName('Lyon', 'fr'), 'Lyon')
  assert.equal(Words.placeName('near Vierzon', 'en'), 'near Vierzon')
})
