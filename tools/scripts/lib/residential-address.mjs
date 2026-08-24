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
 * Detects the pre-move residential address in tracked source (AGL-1491).
 *
 * ## Why this guard is written by HASH, like check-no-tax-identifiers
 *
 * The obvious implementation — `grep -r '<street>' .` — cannot be written
 * down, because writing it down publishes the address into the public
 * repository that this issue exists to remove it from. A guard whose own text
 * is the leak is not a guard. So the needles live here only as SHA-256
 * digests: a digest identifies the value to anyone who already has it and
 * reveals nothing to anyone who does not.
 *
 * ## Why it is n-gram hashing and not a shape match
 *
 * `check-no-tax-identifiers` can match by SHAPE first (`RT` + 6 digits) because
 * its needles have one. A street address has no shape narrow enough to be
 * useful and broad enough to be safe. So this scanner normalises the text to a
 * token stream and hashes WINDOWS of it:
 *
 *   "line1: '123 Example Dr'"  ->  ["line1", "123", "example", "dr"]
 *
 * and every 3-token window is hashed and compared. Punctuation, quoting, casing
 * and the surrounding key name all fall away, so the same address reds whether
 * it arrives as a JS fixture, a JSON blob, a Markdown table row or prose.
 *
 * ## The proximity rule, and why the city alone is not a violation
 *
 * Three tracked files legitimately discuss the move in prose — they name the
 * former city to explain WHY the venue and the registered agent changed. The
 * city on its own is not the leak and must not red, or the guard gets disabled.
 *
 * What reds is the city and the postcode appearing NEAR each other, which is
 * what a pasted address record looks like even when a serialiser puts
 * `state` between them:
 *
 *   { city: '…', state: 'TX', postalCode: '…' }
 *
 * Adjacency would miss that; proximity catches it. PROXIMITY_TOKENS is the
 * window, measured in tokens, not characters.
 *
 * ## What is honestly NOT secret here
 *
 * The postcode is five digits and the city is a place name: both digests are
 * brute-forceable by anyone who wants them, and this file does not pretend
 * otherwise. They are hashed for consistency and to keep the literals out of
 * the diff, not because hashing protects them. The STREET line is the value
 * with real sensitivity, and a 3-token street digest is not brute-forceable.
 *
 * The threat model is accidental REINTRODUCTION — a fixture copied from a live
 * Stripe invoice, which is exactly how all three of the 2026-08-24 findings got
 * in — not an attacker mining the guard.
 */

import { createHash } from 'node:crypto'

/** How near the city and the postcode must be, in tokens, to count as a pair. */
export const PROXIMITY_TOKENS = 12

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/**
 * The pre-move residential address, as digests of normalised token windows.
 *
 * `label` is what a failure prints. It never prints the matched text: CI logs
 * are public artifacts on a public repo, so a guard that echoes the value to
 * prove it found it has re-published it in the log.
 */
export const RESIDENTIAL_NEEDLES = {
  /** The street line — 3 tokens: number, name, type. */
  street: {
    tokens: 3,
    fnv1a: 0xe62f2fe6,
    sha256: '955fefd73c2883c54f91f3a530cb6312d8135af0d746f27fc02d0761745207db',
    label: 'the pre-move residential STREET line',
  },
  /** The city — 1 token. Only a violation when paired with the postcode. */
  city: {
    tokens: 1,
    fnv1a: 0x257a61ff,
    sha256: 'c2cf98bbfccedf33fe689a732f29ec76b6ccdfbc4bb7347ebc820a40c797c185',
    label: 'the pre-move residential city',
  },
  /** The postcode — 1 token. Only a violation when paired with the city. */
  postcode: {
    tokens: 1,
    fnv1a: 0xd6b74019,
    sha256: '8643cbd56c43f867b5045cd8a3717cdfa3049398f7e0a10a67b2671a170430f3',
    label: 'the pre-move residential postcode',
  },
}

/**
 * A 32-bit FNV-1a PREFILTER, and why one is here at all.
 *
 * Hashing every token window of all 17k tracked files with SHA-256 costs ~33s,
 * which is too slow to run on every push — and a guard that gets moved to a
 * nightly cron to stay affordable is a guard that stops blocking the commit it
 * exists to block. FNV-1a is a few instructions and no allocation, so the
 * SHA-256 is computed only for the vanishingly few windows that survive it.
 *
 * It discloses nothing useful: a 32-bit fingerprint has ~2^32 preimages per
 * value, so it identifies no string. SHA-256 remains the only thing that
 * decides a violation — FNV-1a can produce false positives, never a verdict.
 */
export function fnv1a32(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Text to a lowercase alphanumeric token stream.
 *
 * Everything that is not a letter or a digit becomes a separator, so
 * `'125-A'`, `"125 A"` and `125_A` all tokenise identically. That is
 * deliberate: a guard that a different quoting style walks past is a guard
 * that silently passes.
 */
export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Indices in `tokens` where a window of `needle.tokens` matches.
 *
 * FNV-1a gates, SHA-256 decides. A needle with no `fnv1a` — which is how the
 * unit test drives synthetic values — skips the gate entirely and is hashed
 * directly, so the prefilter can never change a verdict, only the cost of
 * reaching it.
 */
function windowHits(tokens, needle) {
  const size = needle.tokens
  const hits = []
  for (let i = 0; i + size <= tokens.length; i += 1) {
    const window = size === 1 ? tokens[i] : tokens.slice(i, i + size).join(' ')
    if (needle.fnv1a !== undefined && fnv1a32(window) !== needle.fnv1a) continue
    if (sha256(window) === needle.sha256) hits.push(i)
  }
  return hits
}

/**
 * Every violation in `text`, by label.
 *
 * `needles` is injectable so the unit test can drive the whole mechanism with
 * SYNTHETIC digests and prove each rule can go both red and green — without
 * the test, or this file, ever holding the real strings.
 */
export function scanText(
  text,
  needles = RESIDENTIAL_NEEDLES,
  proximity = PROXIMITY_TOKENS,
) {
  const tokens = tokenize(text)
  const found = []

  const street = windowHits(tokens, needles.street)
  if (street.length) found.push(needles.street.label)

  // The city and the postcode are a violation only TOGETHER and only NEAR
  // each other — see the proximity note at the top of this file.
  const cities = windowHits(tokens, needles.city)
  const codes = windowHits(tokens, needles.postcode)
  const paired = cities.some((c) =>
    codes.some((p) => Math.abs(c - p) <= proximity),
  )
  if (paired) found.push('the pre-move residential city and postcode together')

  return found
}
