/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * THE ENGLISH NAME OF A BUSINESS TYPE WRITTEN IN ANOTHER LANGUAGE (AGL-3779).
 *
 * The stock photo libraries are tagged in English, so a site in another
 * language is searched by its plan's English photo words
 * (`aiStockSourceTerms`). Where a plan gave none, the business type the
 * person typed is the next best word for what the site is about — but only
 * once it is English: "Una panadería familiar … con pan dulce" read as an
 * English noun phrase searched "con pan dulce" and placed the Río Dulce, and
 * the kind of site picked ("restaurant cafe") placed a coffee mug as a
 * bakery's hero (jobs ih6kVvCGP1 and iGmqrEgyW4, beta.250).
 *
 * This table names the common kinds of local business in Spanish, French,
 * Portuguese, German and Italian, each with the English words a library is
 * searched by. It is deliberately small: a kind belongs here when people
 * start sites for it and its name is not already English. Words English
 * shares ("café", "restaurant", "boutique", "pizzeria") are left out, because
 * the guided start's own brief is English around the person's words ("Make
 * it a restaurant & café site") and must never decide the subject; such a
 * site falls through to the kind it picked, as before.
 *
 * A word matches whole, accents and case aside: "panaderia" and "Panadería"
 * meet, so a name two languages spell alike ("farmacia", "fotógrafo") is
 * listed once; "pan" never matches inside "panadería", and a German compound
 * ("Familienbäckerei") matches only if it is listed itself. The first listed
 * name the text says wins, the longer of two that start at the same word —
 * "peluquería canina" is a dog groomer, "peluquería" a hair salon — so the
 * head noun a Romance-language business type opens with decides.
 */

/** A kind of business: the English words its photos are searched by, and its names in other languages. */
interface AiStockBusinessNoun {
  /** What a stock photo library is searched by: "bakery". */
  english: string
  /** Its names in es, fr, pt, de and it, as people write them. */
  names: readonly string[]
}

export const AI_STOCK_BUSINESS_NOUNS: readonly AiStockBusinessNoun[] = [
  { english: 'bakery', names: ['panadería', 'boulangerie', 'padaria', 'Bäckerei', 'panetteria', 'panificio'] },
  { english: 'pastry shop', names: ['pastelería', 'repostería', 'pâtisserie', 'confeitaria', 'Konditorei', 'pasticceria'] },
  { english: 'tacos', names: ['taquería'] },
  { english: 'cafe', names: ['cafetería', 'caffetteria'] },
  { english: 'restaurant', names: ['restaurante', 'ristorante', 'trattoria', 'osteria', 'Gaststätte'] },
  { english: 'butcher shop', names: ['carnicería', 'boucherie', 'açougue', 'Metzgerei', 'macelleria'] },
  { english: 'florist', names: ['floristería', 'florería', 'fleuriste', 'floricultura', 'Blumenladen', 'fioraio', 'fioreria'] },
  {
    english: 'hair salon',
    names: ['peluquería', 'salon de coiffure', 'coiffeur', 'coiffeuse', 'cabeleireiro', 'Friseur', 'Friseursalon', 'parrucchiere'],
  },
  { english: 'dog grooming', names: ['peluquería canina', 'toilettage', 'banho e tosa', 'Hundesalon', 'toelettatura'] },
  { english: 'beauty salon', names: ['salón de belleza', 'institut de beauté', 'salão de beleza', 'Kosmetikstudio', 'centro estetico'] },
  { english: 'barber shop', names: ['barbería', 'barbearia', 'Barbier', 'barbiere'] },
  { english: 'auto repair', names: ['taller mecánico', 'oficina mecânica', 'Autowerkstatt', 'Kfz-Werkstatt', 'officina meccanica', 'autofficina'] },
  { english: 'dentist', names: ['dentista', 'clínica dental', 'dentiste', 'cabinet dentaire', 'Zahnarzt', 'Zahnarztpraxis', 'studio dentistico'] },
  { english: 'veterinary clinic', names: ['veterinaria', 'veterinario', 'vétérinaire', 'Tierarzt', 'Tierarztpraxis'] },
  { english: 'pharmacy', names: ['farmacia', 'pharmacie', 'Apotheke'] },
  { english: 'bookstore', names: ['librería', 'librairie', 'livraria', 'Buchhandlung'] },
  { english: 'photographer', names: ['fotógrafo', 'fotógrafa', 'photographe', 'Fotograf', 'Fotografin'] },
  { english: 'plumber', names: ['fontanero', 'plomero', 'plombier', 'encanador', 'Klempner', 'idraulico'] },
  { english: 'cleaning service', names: ['servicio de limpieza', 'nettoyage', 'limpeza', 'Reinigung', 'impresa di pulizie'] },
]

/** A text's words, lowercase, without accents: "Panadería" and "panaderia" are one word. */
function foldedWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .split(/[^a-z]+/)
    .filter(Boolean)
}

/** Every listed name as its words, the longest first, so the longer of two at one word wins. */
const NAMES: ReadonlyArray<{ words: string[]; english: string }> = AI_STOCK_BUSINESS_NOUNS.flatMap(({ english, names }) =>
  names.map((name) => ({ words: foldedWords(name), english })),
).sort((a, b) => b.words.length - a.words.length)

/**
 * The English words for the kind of business a text in another language
 * names ({@link AI_STOCK_BUSINESS_NOUNS}): "bakery" for "Una panadería
 * familiar de San Antonio con pan dulce". Empty when it names none listed.
 */
export function aiStockBusinessNoun(text: string): string {
  const words = foldedWords(text)
  for (let at = 0; at < words.length; at += 1) {
    const found = NAMES.find((name) => name.words.every((word, index) => words[at + index] === word))
    if (found) return found.english
  }
  return ''
}
