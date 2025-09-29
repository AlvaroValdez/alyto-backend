// backend/src/services/markupService.js
const Markup = require('../models/Markup');

async function getOrInit() {
  let doc = await Markup.findOne();
  if (!doc) doc = await Markup.create({ defaultPercent: 0, pairs: [] });
  return doc;
}

async function getPercent(originCurrency, destCountry) {
  const doc = await getOrInit();
  const found = doc.pairs.find(p =>
    p.originCurrency.toUpperCase() === originCurrency.toUpperCase() &&
    p.destCountry.toUpperCase() === destCountry.toUpperCase()
  );
  return (found ? found.percent : doc.defaultPercent) || 0;
}

async function upsertDefault(percent) {
  const doc = await getOrInit();
  doc.defaultPercent = percent;
  await doc.save();
  return doc;
}

async function upsertPair(originCurrency, destCountry, percent) {
  const doc = await getOrInit();
  const idx = doc.pairs.findIndex(p =>
    p.originCurrency.toUpperCase() === originCurrency.toUpperCase() &&
    p.destCountry.toUpperCase() === destCountry.toUpperCase()
  );
  if (idx >= 0) doc.pairs[idx].percent = percent;
  else doc.pairs.push({ originCurrency, destCountry, percent });
  await doc.save();
  return doc;
}

module.exports = { getPercent, upsertDefault, upsertPair, getOrInit };
