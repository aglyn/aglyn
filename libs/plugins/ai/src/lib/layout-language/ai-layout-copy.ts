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
  return value.replace(MARKUP, '').replace(/\s+/g, ' ').trim()
}

/** The line with every trailing dangling word taken off, as rule 14 reads one. */
function withoutDanglingTail(line: string): string {
  let text = line.replace(TRAILING_JOINERS, '').trim()
  for (let guard = 0; guard < 6; guard += 1) {
    const word = aiDanglingWord(text)
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
function fitText(value: unknown, place: AiLayoutTextPlace): string {
  const text = aiLayoutCleanText(value)
  const limit = AI_LAYOUT_TEXT_LIMITS[place]
  if (text.length <= limit) return withoutDanglingTail(text)
  const room = text.slice(0, limit + 1)
  const half = Math.floor(limit * 0.4)
  const lastMatch = (pattern: RegExp): number => {
    let at = -1
    for (const match of room.matchAll(pattern)) {
      const end = (match.index ?? 0) + (pattern === SENTENCE_END ? 1 : 0)
      if (end <= limit && end >= half) at = end
    }
    return at
  }
  const sentence = lastMatch(SENTENCE_END)
  if (sentence > 0) return withoutDanglingTail(room.slice(0, sentence))
  const clause = lastMatch(CLAUSE_END)
  if (clause > 0) return withoutDanglingTail(room.slice(0, clause))
  const space = room.lastIndexOf(' ', limit)
  return withoutDanglingTail(
    space > half ? room.slice(0, space) : room.slice(0, limit),
  )
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
      return knownDigits.has(digits) ? phone : '[phone number]'
    })
}

/** A line fitted to its place with invented contact details written as gaps. */
export function aiLayoutWords(
  value: unknown,
  place: AiLayoutTextPlace,
  facts: string,
): string {
  return aiLayoutFitText(
    aiLayoutGuardContacts(aiLayoutCleanText(value), facts),
    place,
  )
}

/**
 * A line held to the characters its place holds (see `fitText`), and none at
 * all where what is left is filler.
 */
export function aiLayoutFitText(
  value: unknown,
  place: AiLayoutTextPlace,
): string {
  const text = fitText(value, place)
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
export function aiLayoutQuoteGap(value: unknown): string {
  const text = aiLayoutFitText(value, 'quote')
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .trim()
  if (!text) return ''
  if (/^\[.*\]$/.test(text)) return text
  return `[${text.replace(/^\[|\]$/g, '')}]`
}
