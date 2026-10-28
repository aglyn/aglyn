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

import {
  aiDanglingWord,
  detectOffVoiceCopy,
} from '../runtime/ai-doctrine-validators'
import { aiLayoutSpeaksOtherThanEnglish } from './ai-layout-labels'

/**
 * The words of a layout language document, made to fit where they are shown
 * (AGL-3660). Every word is the model's; the compiler only cleans and fits
 * them: markup a person would see is taken out, a line too long for its place
 * ends at a clean boundary instead of mid-word, a line that would end on a
 * dangling word ("…for you and") loses it, and a phone number or an email
 * address the brief never gave is written as the bracketed gap the doctrine
 * asks for (rule 14) rather than shown as a fact.
 */

/** Characters each place holds before its line is ended. */
export const AI_LAYOUT_TEXT_LIMITS = {
  /** A page's h1. */
  title: 70,
  /** A section's heading. */
  heading: 80,
  /** A card's, a step's or a sub-heading's title. */
  itemTitle: 60,
  eyebrow: 40,
  /** A button's label; the palette holds a label to 40. */
  label: 28,
  lede: 240,
  text: 420,
  itemText: 240,
  listItem: 140,
  stat: 14,
  statLabel: 60,
  question: 120,
  answer: 420,
  quote: 240,
  note: 200,
  /** An image's description, which is its alt text. */
  alt: 160,
} as const

export type AiLayoutTextPlace = keyof typeof AI_LAYOUT_TEXT_LIMITS

/** Inline markup a model writes out of habit, which a page would print literally. */
const MARKUP = /(\*\*|__|`|~~|^#{1,6}\s+|^\s*[-*•]\s+)/gm

/** A sentence's end inside a line. */
const SENTENCE_END = /[.!?…](?=["'”’)\]]?\s)/g

/** A clause boundary inside a line: a comma, a semicolon, a colon or a dash, with what follows. */
const CLAUSE_END = /\s*(?:[,;:]|\s[—–-])\s/g

/** Punctuation that may not end a line it was cut back to. */
const TRAILING_JOINERS = /[\s,;:—–-]+$/

/** Collapses whitespace and takes out markup a page would print. */
export function aiLayoutCleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(MARKUP, '')
    // A JSON escape a model wrote out as text ("\\u2014") is the character it names.
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * "a" and "an" made to agree with the word after them, in English copy
 * (AGL-3988): the beta.270 Sugar Hollow packages said "A easygoing session"
 * twice, in their records and on the home page's cards. Only where the
 * letters settle it: "a" before a word opening a, e, i or o becomes "an" —
 * never before "one" or "once", or "eu" ("a European"); "an" before a word
 * opening a consonant other than h becomes "a". A word opening u or h, or
 * one in capitals ("an FAQ"), is said as the model wrote it, and so is a
 * capital "A" inside a sentence, a letter rather than an article ("Plan A
 * is"). Any other language's text comes back as it is.
 */
export function aiLayoutArticles(text: string, language?: string | null): string {
  if (!text || aiLayoutSpeaksOtherThanEnglish(language)) return text
  return text.replace(
    /(?<![\p{L}\p{N}'’-])(a|an|A|An)(\s+)([A-Za-z][\p{L}\p{N}'’-]*)/gu,
    (whole, article: string, space: string, word: string, at: number) => {
      // A capital opens a sentence; anywhere else "A" is a letter, never an article.
      if (/^A/.test(article) && !/(?:^|[.!?:]["”’)]?\s*)$/.test(text.slice(0, at))) return whole
      // An initialism is said by its letters, which the letters alone do not settle.
      if (/^[A-Z]{2,}/.test(word)) return whole
      const lower = word.toLowerCase()
      const vowel = /^[aeio]/.test(lower) && !/^(?:one(?![a-z])|once|eu|ewe)/.test(lower)
      const consonant = /^[bcdfgjklmnpqrstvwxyz]/.test(lower)
      const an = article.toLowerCase() === 'an'
      if (!an && vowel) return `${article === 'a' ? 'an' : 'An'}${space}${word}`
      if (an && consonant) return `${article === 'an' ? 'a' : 'A'}${space}${word}`
      return whole
    },
  )
}

/**
 * The line with every trailing dangling word taken off, as rule 14 reads one,
 * in the site's language (AGL-3828): a Spanish line cut to "…para la" loses
 * both words, as an English one cut to "…for the" does.
 */
function withoutDanglingTail(line: string, language?: string): string {
  let text = line.replace(TRAILING_JOINERS, '').trim()
  for (let guard = 0; guard < 6; guard += 1) {
    const word = aiDanglingWord(text, language)
    if (!word) break
    text = text
      .slice(0, text.length - word.length)
      .replace(TRAILING_JOINERS, '')
      .trim()
  }
  return text
}

/**
 * A line held to the characters its place holds, ended where a reader expects
 * a line to end: at the last sentence's end that leaves at least half the
 * room, else the last clause boundary that does, else the last whole word. A
 * line that fits is returned clean, with any dangling tail taken off.
 */
function fitText(value: unknown, place: AiLayoutTextPlace, language?: string): string {
  if (place === 'eyebrow') return aiLayoutFitEyebrow(value, language)
  const text = aiLayoutArticles(aiLayoutCleanText(value), language)
  const limit = AI_LAYOUT_TEXT_LIMITS[place]
  if (text.length <= limit) return withoutDanglingTail(text, language)
  return boundaryCut(text, limit, language) ?? spaceCut(text, limit, language)
}

/** The least of a line's room a cut may leave: 40% of it. */
const leastOf = (limit: number) => Math.floor(limit * 0.4)

/**
 * A line too long for its room ended at the last sentence's end that leaves
 * at least 40% of the room, else at the last clause boundary that does;
 * `null` where it has neither.
 */
function boundaryCut(text: string, limit: number, language?: string): string | null {
  const room = text.slice(0, limit + 1)
  const half = leastOf(limit)
  const lastMatch = (pattern: RegExp): number => {
    let at = -1
    for (const match of room.matchAll(pattern)) {
      const end = (match.index ?? 0) + (pattern === SENTENCE_END ? 1 : 0)
      if (end <= limit && end >= half) at = end
    }
    return at
  }
  const sentence = lastMatch(SENTENCE_END)
  if (sentence > 0) return withoutDanglingTail(room.slice(0, sentence), language)
  const clause = lastMatch(CLAUSE_END)
  if (clause > 0) return withoutDanglingTail(room.slice(0, clause), language)
  return null
}

/** A line too long for its room ended at its last whole word, else at the room's edge. */
function spaceCut(text: string, limit: number, language?: string): string {
  const room = text.slice(0, limit + 1)
  const space = room.lastIndexOf(' ', limit)
  return withoutDanglingTail(space > leastOf(limit) ? room.slice(0, space) : room.slice(0, limit), language)
}

// ── An eyebrow, fitted whole (AGL-4065) ────────────────────────────────────

/**
 * What joins the parts of an eyebrow, in each language the compiler writes
 * (`ai-layout-labels.ts`): the conjunctions a coordinated part ends on, and
 * the prepositions a part opens after. A language with no row is cut, never
 * re-phrased.
 */
const EYEBROW_JOINS: Readonly<Record<string, Joins>> = {
  en: { and: ['and', '&'], at: ['in', 'for', 'of', 'at', 'to', 'with', 'from', 'by', 'on', 'near', 'around', 'across', 'serving'], place: ['in', 'for'] },
  es: { and: ['y', 'e', '&'], at: ['en', 'para', 'de', 'del', 'con', 'desde', 'cerca'], place: ['en', 'para'] },
  pt: { and: ['e', '&'], at: ['em', 'para', 'de', 'do', 'da', 'com', 'perto'], place: ['em', 'para'] },
  fr: { and: ['et', '&'], at: ['à', 'en', 'pour', 'de', 'du', 'avec', 'près'], place: ['à', 'en', 'pour'] },
  it: { and: ['e', 'ed', '&'], at: ['a', 'in', 'per', 'di', 'da', 'con', 'vicino'], place: ['a', 'in', 'per'] },
  de: { and: ['und', '&'], at: ['in', 'für', 'von', 'aus', 'mit', 'bei'], place: ['in', 'für'] },
}

/** A language's joining words: `and` ends a coordinated part, `at` opens one, `place` opens where a business is or whom it serves. */
interface Joins {
  and: readonly string[]
  at: readonly string[]
  place: readonly string[]
}

/** Words an English eyebrow cut back to a word may not end on, beside rule 14's dangling words. */
const EYEBROW_TAIL_EN: ReadonlySet<string> = new Set([
  'in', 'of', 'for', 'and', 'or', 'nor', 'but', 'at', 'to', 'the', 'a', 'an', 'with', 'from', 'by', 'on', 'near', 'around', 'across',
  'about', 'into', 'over', 'through', 'throughout', 'between', 'within', 'via', 'out', 'serving', 'your', 'our', 'their', 'my', '&',
])

function joinsOf(language?: string | null): Joins | null {
  if (!aiLayoutSpeaksOtherThanEnglish(language)) return EYEBROW_JOINS['en'] as Joins
  return EYEBROW_JOINS[String(language).toLowerCase().split(/[-_]/)[0] ?? ''] ?? null
}

/** A word's letters in any script: a capital opens a name. */
const NAME_WORD = /^\p{Lu}[\p{L}\p{M}'’.-]*$/u
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where each of `keep` stands in a line, whole words only, earliest first. */
function keptSpans(text: string, keep: readonly string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  for (const word of keep) {
    const trimmed = word.trim()
    if (!trimmed) continue
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`, 'giu'))) {
      spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
    }
  }
  return spans.sort((one, two) => one.start - two.start || two.end - one.end)
}

/** Whether a line still holds the words a span of the original named. */
function stillHolds(line: string, words: string): boolean {
  return keptSpans(line, [words]).length > 0
}

/**
 * The lines an eyebrow becomes with ONE coordinated part taken out, each
 * still holding every word to keep: "Lawn care and landscaping in New
 * Braunfels" without "Lawn care and"; "San Marcos motorcycle and dirt bike
 * repair" without "motorcycle and"; a list without its first element. A part
 * is the one to three words between the last boundary before a conjunction
 * or a comma — the line's start, a word to keep, a preposition, a comma or
 * another conjunction — and it.
 */
function withoutAPart(text: string, kept: ReadonlyArray<{ start: number; end: number }>, language?: string | null): string[] {
  const joins = joinsOf(language)
  if (!joins) return []
  const tokens = [...text.matchAll(/[^\s]+/g)].map((match) => ({ word: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
  const bare = (word: string) => word.toLowerCase().replace(/[,;:]+$/, '')
  const insideKept = (start: number, end: number) => kept.some((span) => start < span.end && end > span.start)
  const out: string[] = []
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at] as (typeof tokens)[number]
    const conjunction = joins.and.includes(bare(token.word))
    const comma = /,$/.test(token.word) && !insideKept(token.start, token.end - 1)
    if (!conjunction && !comma) continue
    // The part ends with the conjunction, or is the word the comma closes.
    const last = conjunction ? at - 1 : at
    if (last < 0) continue
    let first = last
    while (first > 0) {
      const before = tokens[first - 1] as (typeof tokens)[number]
      if (/[,;:]$/.test(before.word) || joins.and.includes(bare(before.word)) || joins.at.includes(bare(before.word)) || insideKept(before.start, before.end)) break
      first -= 1
    }
    if (last < first || last - first > 2) continue
    const start = (tokens[first] as (typeof tokens)[number]).start
    const end = token.end
    if (insideKept(start, end)) continue
    // Inside the line, a conjunction's part goes only where what follows it
    // shares a head with it ("motorcycle and dirt bike repair"): two words
    // or more to the next boundary, never "big and small".
    if (conjunction && start > 0) {
      let right = 0
      for (let next = at + 1; next < tokens.length; next += 1) {
        const word = tokens[next] as (typeof tokens)[number]
        if (joins.and.includes(bare(word.word)) || joins.at.includes(bare(word.word)) || insideKept(word.start, word.end)) break
        right += 1
        if (/[,;:]$/.test(word.word)) break
      }
      if (right < 2) continue
    }
    const line = `${text.slice(0, start)}${text.slice(end).replace(/^\s+/, '')}`.replace(/\s+/g, ' ').trim()
    if (!line || line === text) continue
    out.push(start === 0 ? line.charAt(0).toLocaleUpperCase() + line.slice(1) : line)
  }
  return out
}

/**
 * An eyebrow read from after a leading clause, up to "in", "for" or a comma:
 * "Weekly mowing and seasonal cleanups for homeowners in New Braunfels" read
 * from "homeowners". Every such start, longest first.
 */
function fromAPreposition(text: string, language?: string | null): string[] {
  const joins = joinsOf(language)
  if (!joins) return []
  const words = text.split(' ')
  const out: string[] = []
  words.forEach((word, at) => {
    if (!joins.place.includes(word.toLowerCase()) && !/[,;:]$/.test(word)) return
    const rest = words.slice(at + 1).join(' ').trim()
    if (rest) out.push(rest.charAt(0).toLocaleUpperCase() + rest.slice(1))
  })
  return out
}

/**
 * A line cut back to a whole word that is not inside a name — a capital
 * before and after the cut — and, in English, not on a word that joins, a
 * word at a time, never under 40% of the room; else the line's plain cut.
 */
function wordCut(text: string, limit: number, language?: string | null): string {
  const words = text.slice(0, limit + 1).split(' ')
  // The word the room cuts through is never kept.
  if (text.length > limit) words.pop()
  const next = text.split(' ')
  const english = !aiLayoutSpeaksOtherThanEnglish(language)
  for (let count = words.length; count > 0; count -= 1) {
    const line = next.slice(0, count).join(' ')
    if (line.length < leastOf(limit)) break
    const before = (next[count - 1] ?? '').replace(/[,;:]+$/, '')
    const after = (next[count] ?? '').replace(/[,;:.!?]+$/, '')
    if (NAME_WORD.test(before) && NAME_WORD.test(after) && !/[,;:]$/.test(next[count - 1] ?? '')) continue
    if (english && EYEBROW_TAIL_EN.has(before.toLowerCase())) continue
    const fitted = withoutDanglingTail(line, language ?? undefined)
    if (fitted && fitted.length <= limit) return fitted
  }
  return spaceCut(text, limit, language ?? undefined)
}

/**
 * An eyebrow fitted to its 40 characters whole (AGL-4065): a label over a
 * hero says what and where, and the 2026-10-25 booth-kit heroes printed
 * "Lawn care and landscaping in New" and "San Marcos motorcycle and dirt
 * bike" — the town cut in half, the head noun lost.
 *
 * An eyebrow that holds one of the site's own names (`keep`: its town, its
 * service area, its own name, `aiLayoutPlaceWords`) is, over its room, the
 * first of these that fits and still holds the first such name it held:
 *
 *  1. the line without one coordinated part — its first ("Lawn care and
 *     landscaping in New Braunfels" → "Landscaping in New Braunfels"), or
 *     one inside it that shares its head with the next ("San Marcos
 *     motorcycle and dirt bike repair" → "San Marcos dirt bike repair") —
 *     the longest that keeps every name;
 *  2. the line ended at its last sentence or clause boundary;
 *  3. the line cut back to a whole word (below);
 *  4. the line read from after a leading clause, up to "in", "for" or a
 *     comma ("Homeowners in New Braunfels");
 *  5. else the cut of step 3, whatever it holds.
 *
 * One that holds none is ended at its last sentence or clause boundary, as
 * any line is, else cut back to a whole word that is neither inside a name
 * (a capital on both sides of the cut: "New | Braunfels") nor, in English,
 * a word that joins ("…in", "…and", "…for"). A line that fits is returned as
 * `aiLayoutFitText` returns one. The words are always the model's,
 * re-capitalized only after a cut at the front.
 */
export function aiLayoutFitEyebrow(value: unknown, language?: string | null, keep: readonly string[] = []): string {
  const text = aiLayoutArticles(aiLayoutCleanText(value), language ?? undefined)
  const limit = AI_LAYOUT_TEXT_LIMITS.eyebrow
  if (text.length <= limit) return withoutDanglingTail(text, language ?? undefined)
  const kept = keptSpans(text, keep)
  const boundary = boundaryCut(text, limit, language ?? undefined)
  const cut = () => wordCut(text, limit, language)
  if (!kept.length) return boundary ?? cut()
  const firstKept = text.slice((kept[0] as { start: number }).start, (kept[0] as { end: number }).end)
  const holds = (line: string | null): line is string => !!line && line.length <= limit && !!aiLayoutCleanText(line) && stillHolds(line, firstKept)
  const keepsAll = (line: string) => kept.every((span) => stillHolds(line, text.slice(span.start, span.end)))
  const parts = withoutAPart(text, kept, language)
    .map((line) => withoutDanglingTail(line, language ?? undefined))
    .filter((line) => holds(line) && keepsAll(line))
  const longest = parts.reduce<string | null>((best, line) => (best === null || line.length > best.length ? line : best), null)
  if (longest) return longest
  if (holds(boundary)) return boundary
  const words = cut()
  if (holds(words)) return words
  const after = fromAPreposition(text, language)
    .map((line) => withoutDanglingTail(line, language ?? undefined))
    .find((line) => holds(line))
  return after ?? words
}

/** A line of the job's words that is a name: one to four words, each opening on a capital, no digits. */
const NAME_LINE = /^(?:\p{Lu}[\p{L}\p{M}'’.-]*)(?:\s+\p{Lu}[\p{L}\p{M}'’.-]*){0,3}$/u

let placeWordsCache: { facts: string; words: string[] } | null = null

/**
 * The names among the words a job was given (AGL-4065): each line, or each
 * part of a line between commas, that is a name of one to four capitalized
 * words — the city ("New Braunfels"), each town of its service area, its
 * region ("TX"), its own name — which an eyebrow is fitted around, never
 * through.
 */
export function aiLayoutPlaceWords(facts: string): string[] {
  if (placeWordsCache?.facts === facts) return placeWordsCache.words
  const words = [
    ...new Set(
      facts
        .split(/\n|[,;·|]/)
        .map((part) => part.trim().replace(/[.:]+$/, ''))
        .filter((part) => part.length >= 2 && !/\d/.test(part) && NAME_LINE.test(part)),
    ),
  ]
  placeWordsCache = { facts, words }
  return words
}

/** A phone number as people write one: seven or more digits with the usual separators. */
const PHONE = /\(?\+?\d[\d\s().-]{6,}\d/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** The digits of a phone number, which is what two spellings of one number share. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * The line with every phone number and email address the brief did not give
 * written as the gap (rule 14): a site's contact details are facts, and a
 * model that writes one the brief lacks is inventing it. `facts` is every
 * word the job was given — the brief, the site's answers and its profile.
 */
export function aiLayoutGuardContacts(line: string, facts: string): string {
  const known = facts.toLowerCase()
  const knownDigits = new Set((facts.match(PHONE) ?? []).map(digitsOf))
  return line
    .replace(EMAIL, (email) =>
      known.includes(email.toLowerCase()) ? email : '[email address]',
    )
    .replace(PHONE, (phone) => {
      const digits = digitsOf(phone)
      // A year, a price or a count is not a phone number.
      if (digits.length < 7) return phone
      // One number with and without its country code is one number (AGL-3979):
      // "+1 512 555 0142" given admits "(512) 555-0142" written.
      const known = [...knownDigits].some(
        (given) => given === digits || (Math.min(given.length, digits.length) >= 7 && (given.endsWith(digits) || digits.endsWith(given)) && Math.abs(given.length - digits.length) <= 3),
      )
      return known ? phone : '[phone number]'
    })
}

/**
 * A line fitted to its place with invented contact details written as gaps;
 * `language` is the site's (see `aiLayoutFitText`).
 */
export function aiLayoutWords(
  value: unknown,
  place: AiLayoutTextPlace,
  facts: string,
  language?: string,
): string {
  const guarded = aiLayoutGuardContacts(aiLayoutCleanText(value), facts)
  // An eyebrow is fitted around the site's own names (AGL-4065).
  if (place === 'eyebrow') {
    const text = aiLayoutFitEyebrow(guarded, language, aiLayoutPlaceWords(facts))
    return aiLayoutIsFiller(text) ? '' : text
  }
  return aiLayoutFitText(guarded, place, language)
}

/**
 * A line held to the characters its place holds (see `fitText`), and none at
 * all where what is left is filler. `language` is the site's language code,
 * which says what a dangling word is (AGL-3828); absent, English.
 */
export function aiLayoutFitText(
  value: unknown,
  place: AiLayoutTextPlace,
  language?: string,
): string {
  const text = fitText(value, place, language)
  return aiLayoutIsFiller(text) ? '' : text
}

/**
 * Whether a line is filler rule 14 refuses ("lorem ipsum", "your text here"):
 * such a line is no copy, and the compiler leaves it out rather than ship it.
 */
export function aiLayoutIsFiller(text: string): boolean {
  return detectOffVoiceCopy([{ at: 'line', text }]).length > 0
}

/** A quote that cannot be a real customer's, written as the gap the owner fills with one (rule 14). */
export function aiLayoutQuoteGap(value: unknown, language?: string): string {
  const text = aiLayoutFitText(value, 'quote', language)
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .trim()
  if (!text) return ''
  if (/^\[.*\]$/.test(text)) return text
  return `[${text.replace(/^\[|\]$/g, '')}]`
}
