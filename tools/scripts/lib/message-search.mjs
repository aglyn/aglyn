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
 * A visitor's message's search keys, for plain Node scripts (AGL-3321):
 * `messageSearchFields` and `messageSender` in
 * `libs/aglyn/src/lib/app-utils/message-search.ts`, which a script cannot
 * import. The one script-side restatement — the Inbox backfill and the docs
 * seed import it rather than carrying their own.
 *
 * Held to `message-search.fixtures.json` beside this file: the library's
 * `message-search.spec.ts` asserts it against the TypeScript functions, and
 * `backfill-form-submission-filters.mjs --self-test` against these. The word
 * keys come from `name-search-tokens.mjs`, the script-side copy of those.
 */

import { NAME_TOKEN_MAX_PREFIX, nameSearchKey } from './name-search-tokens.mjs'

export const MESSAGE_SENDER_TOKENS_MAX = 60
export const MESSAGE_SEARCH_TOKENS_MAX = 200
export const MESSAGE_SEARCH_WORDS_MAX = 40
const SENDER_NAME_KEYS = ['name', 'fullname', 'yourname', 'firstname', 'contactname']
const SENDER_EMAIL_KEYS = ['email', 'emailaddress']
const WORD_JOINS = /[@.+_-]/
const WORD_PARTS = /[@.+_-]+/
const WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

function textOf(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ')
  return ''
}

function senderOf(entries) {
  const reduced = new Map()
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

/** `messageSender`: who wrote in, reading the map in the order handed. */
export function messageSender(fields) {
  return senderOf(Object.entries(fields && typeof fields === 'object' ? fields : {}))
}

function wordsOf(text) {
  const words = []
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

function addPrefixes(tokens, words, max) {
  for (const word of words) {
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      if (tokens.size >= max) return
      tokens.add(capped.slice(0, end))
    }
  }
}

/** `messageSearchFields`: the sender's tokens and the search tokens. */
export function messageSearchFields(fields) {
  const sorted = Object.entries(fields && typeof fields === 'object' ? fields : {}).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )
  const sender = senderOf(sorted)
  const senderSet = new Set()
  addPrefixes(
    senderSet,
    [...wordsOf(sender.name ?? ''), ...wordsOf(sender.email ?? '')],
    MESSAGE_SENDER_TOKENS_MAX,
  )
  const words = new Set()
  for (const word of sorted.flatMap(([, value]) => wordsOf(textOf(value)))) {
    if (words.size >= MESSAGE_SEARCH_WORDS_MAX) break
    words.add(word)
  }
  const search = new Set(senderSet)
  addPrefixes(search, [...words], MESSAGE_SEARCH_TOKENS_MAX)
  return { senderTokens: [...senderSet], searchTokens: [...search] }
}
