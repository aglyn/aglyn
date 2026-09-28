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

import { NAME_TOKEN_MAX_PREFIX, nameSearchKey } from './name-search'

/*
 * THE SEARCH KEYS OF A MESSAGE A VISITOR SENT (AGL-3321).
 *
 * A message is a free-form map of the fields its author declared — `name`,
 * `Email Address`, `message`, `Company size` — with no guaranteed shape. A
 * list of them is searched on its Firestore query, which cannot look inside
 * a string, so every writer stamps the words as word-prefix token arrays the
 * query asks with `array-contains`:
 *
 *   senderTokens   the sender's name and address — who wrote in. What the
 *                  list's From filter asks.
 *   searchTokens   the sender's tokens, then the words of every value the
 *                  message carries. What the list's search box asks.
 *
 * The words are the platform's search keys (`nameSearchKey`, prefixes up to
 * `NAME_TOKEN_MAX_PREFIX`), so a typed word becomes the token the query asks
 * through the same `nameSearchNormalizers` every list uses. A word that joins
 * parts with `@ . + _ -` — an address, a domain, a hyphenated name — is also
 * its parts, so `acme` finds `dana@acme.com` and `dana` does too.
 *
 * ## What is capped
 *
 * A message is free text, so the arrays are bounded rather than complete:
 * the first {@link MESSAGE_SEARCH_WORDS_MAX} distinct words of the values
 * contribute, and each array stops at its own ceiling
 * ({@link MESSAGE_SENDER_TOKENS_MAX}, {@link MESSAGE_SEARCH_TOKENS_MAX}) —
 * the sender first, so a long message loses the tail of its text before it
 * loses who sent it. A word past the cap is still in the message; the search
 * box just does not find it.
 *
 * ## Deterministic whatever the map's key order
 *
 * A map's keys come back in a different order from different readers (the
 * Admin SDK sorts them), and a cap makes the result order-sensitive. So the
 * values are read in SORTED key order, and a backfill that re-derives the
 * arrays from a stored message computes exactly what the writer stamped.
 *
 * `tools/scripts/backfill-form-submission-filters.mjs` restates this for the
 * rows written before it, held to `tools/scripts/lib/message-search.fixtures.json`
 * with the spec beside this file.
 */

/** The most tokens the sender contributes. A name and an address are a few dozen. */
export const MESSAGE_SENDER_TOKENS_MAX = 60

/** The most tokens one message's search array holds, the sender's included. */
export const MESSAGE_SEARCH_TOKENS_MAX = 200

/** The most distinct words of the message's values that contribute prefixes. */
export const MESSAGE_SEARCH_WORDS_MAX = 40

/**
 * Field names that mean "this is who wrote in", most specific first,
 * compared against a key REDUCED to lowercase letters and digits — the same
 * field arrives as `Full Name`, `full_name` and `fullname`.
 */
const SENDER_NAME_KEYS = ['name', 'fullname', 'yourname', 'firstname', 'contactname']
const SENDER_EMAIL_KEYS = ['email', 'emailaddress']

/** The joins a word is also split on, so an address is also its parts. */
const WORD_JOINS = /[@.+_-]/
const WORD_PARTS = /[@.+_-]+/
/** Punctuation around a word — `cake?`, `(june)` — is not part of it. */
const WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

/** A value as the text it reads as, or '' for anything that is not text. */
const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ')
  return ''
}

/** Who wrote in, from the message's entries in the order given. */
function senderOf(entries: ReadonlyArray<readonly [string, unknown]>): {
  name?: string
  email?: string
} {
  const reduced = new Map<string, string>()
  for (const [key, value] of entries) {
    const text = textOf(value).trim()
    if (!text) continue
    const at = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!reduced.has(at)) reduced.set(at, text)
  }
  const name = SENDER_NAME_KEYS.map((key) => reduced.get(key)).find(Boolean)
  const email = SENDER_EMAIL_KEYS.map((key) => reduced.get(key)).find(Boolean)
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) }
}

/**
 * Who wrote in, by the field-name convention: the first non-empty value of
 * a name-like field and of an address-like field. Reads the map in the
 * order it is handed, so the first spelling of a reduced key wins.
 */
export function messageSender(
  fields: Record<string, unknown> | null | undefined,
): { name?: string; email?: string } {
  return senderOf(Object.entries(fields ?? {}))
}

/** The words of a text: its key's words without edge punctuation, and their parts. */
function wordsOf(text: string): string[] {
  const words: string[] = []
  for (const raw of nameSearchKey(text).split(' ')) {
    const word = raw.replace(WORD_EDGES, '')
    if (!word) continue
    words.push(word)
    if (WORD_JOINS.test(word)) {
      for (const part of word.split(WORD_PARTS)) if (part && part !== word) words.push(part)
    }
  }
  return words
}

/**
 * Every prefix of each word, up to the prefix cap, into `tokens` until `max`
 * — cut exactly as `nameSearchTokens` cuts, so the one token a typed word
 * becomes (`nameSearchToken`) is one of these.
 */
function addPrefixes(tokens: Set<string>, words: readonly string[], max: number): void {
  for (const word of words) {
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      if (tokens.size >= max) return
      tokens.add(capped.slice(0, end))
    }
  }
}

/**
 * The two search arrays a message is stamped with — see the block above.
 * Spread onto every write that creates one; a message's values never change
 * after it arrives, so no other write touches them.
 */
export function messageSearchFields(fields: Record<string, unknown> | null | undefined): {
  senderTokens: string[]
  searchTokens: string[]
} {
  // Sorted entries, never an object rebuilt from them: an object puts
  // integer-like keys first whatever order they were added in.
  const sorted = Object.entries(fields ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  const sender = senderOf(sorted)
  const senderSet = new Set<string>()
  addPrefixes(
    senderSet,
    [...wordsOf(sender.name ?? ''), ...wordsOf(sender.email ?? '')],
    MESSAGE_SENDER_TOKENS_MAX,
  )
  const words = new Set<string>()
  for (const word of sorted.flatMap(([, value]) => wordsOf(textOf(value)))) {
    if (words.size >= MESSAGE_SEARCH_WORDS_MAX) break
    words.add(word)
  }
  const search = new Set<string>(senderSet)
  addPrefixes(search, [...words], MESSAGE_SEARCH_TOKENS_MAX)
  return { senderTokens: [...senderSet], searchTokens: [...search] }
}
