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

// The pure half of the rules source-size guard (AGL-3027).
//
// ## The limit that compiling does not check
//
// The Firebase Rules API refuses a ruleset whose source reaches 256 KiB:
// "Rules must be smaller than 256 KiB of UTF-8 encoded text when serialized"
// (https://firebase.google.com/docs/rules/manage-deploy, in the Admin SDK and
// REST API sections, which cover Cloud Firestore and Cloud Storage). The
// refusal is a bare `400 INVALID_ARGUMENT`, "Request contains an invalid
// argument.", which names neither the file nor its size.
//
// Nothing else measures it. `check:rules-parse` and the emulator matrix
// compile the file, and neither enforces the production limit, so the
// v1.0.0-beta.125 Firestore rules were green everywhere and refused at
// deploy: 262,161 bytes, 17 over. The same file less one 74-byte comment line,
// 262,087 bytes, got past the API's argument validation. That pair also
// settles WHAT is counted: the raw UTF-8 bytes of the file, comments
// included. Not its JSON-escaped form, which for that file is 4,614 bytes
// larger and would have refused both.
//
// Firestore's rules reference states a second limit, 250 KB on the COMPILED
// ruleset (https://firebase.google.com/docs/firestore/security/rules-structure).
// No offline tool measures that one and a comment trim does not move it; the
// deploy is the first thing to report it.
//
// ## The Realtime Database is a different service, with its own limit
//
// Its rules are not a Rules API ruleset: `deploy-database-rules.mjs` PUTs the
// file to the instance's `/.settings/rules.json`, and the 256 KiB sentence
// above is scoped to Firestore and Storage. Firebase documents no size limit
// for Realtime Database rules at all
// (https://firebase.google.com/docs/database/usage/limits lists none). The one
// limit on record is in the database server the emulator ships: in
// `firebase-database-emulator-v4.11.2.jar`, `UpdateRules$.create` refuses a
// rules string whose `length()` is 10,485,760 or more ("Rules larger than
// limit of 10485760"). That is the limit used here, and it is an emulator
// reading rather than a documented production promise. Java's `length()`
// counts UTF-16 units, which never exceeds the UTF-8 byte count, so measuring
// bytes errs on the refusing side.

/** 256 KiB: the Rules API's ruleset-source limit (Firestore and Storage). */
export const RULES_API_SOURCE_LIMIT_BYTES = 256 * 1024

/** 10 MiB: the Realtime Database rules limit, read from its emulator. */
export const DATABASE_RULES_LIMIT_BYTES = 10 * 1024 * 1024

/**
 * How close is close enough to warn. About one rule block with its note:
 * AGL-3011's two blocks were 1,615 bytes, and they are what crossed the line.
 */
export const WARN_MARGIN_BYTES = 2 * 1024

const RULES_API_REFUSAL =
  'The deploy refuses a source this size with only `400 INVALID_ARGUMENT`, and neither compiling nor the emulator checks the limit.'
const RULES_REMEDY =
  'Comments count toward the limit: trim them, and prove the trim comment-only with a comment-stripped diff.'

/**
 * The three rules sources this repo deploys, each with the limit its own
 * service applies, where that limit comes from, how a refusal reads, and how
 * to make room.
 */
export const RULES_SOURCES = Object.freeze([
  Object.freeze({
    path: 'cloud/firebase-firestore.rules',
    service: 'Cloud Firestore',
    limitBytes: RULES_API_SOURCE_LIMIT_BYTES,
    limitSource: 'Rules API ruleset source, 256 KiB (docs/rules/manage-deploy; measured in AGL-3027)',
    refusal: RULES_API_REFUSAL,
    remedy: RULES_REMEDY,
  }),
  Object.freeze({
    path: 'cloud/firebase-storage.rules',
    service: 'Cloud Storage',
    limitBytes: RULES_API_SOURCE_LIMIT_BYTES,
    limitSource: 'Rules API ruleset source, 256 KiB (docs/rules/manage-deploy)',
    refusal: RULES_API_REFUSAL,
    remedy: RULES_REMEDY,
  }),
  Object.freeze({
    path: 'cloud/firebase-database.rules.json',
    service: 'Realtime Database',
    limitBytes: DATABASE_RULES_LIMIT_BYTES,
    limitSource: 'Realtime Database rules, 10 MiB (undocumented; read from firebase-database-emulator v4.11.2)',
    refusal: 'Its emulator refuses a source this size ("Rules larger than limit of 10485760"); production documents no limit.',
    remedy: 'The file is strict JSON, so there are no comments to trim: split or simplify the rules.',
  }),
])

/**
 * The size the services count: UTF-8 bytes. A Buffer is measured as read
 * from disk; a string is encoded first, so a multi-byte character counts for
 * every byte it takes and not as one.
 *
 * @param {Buffer | string} content
 * @returns {number}
 */
export function measureRulesSource(content) {
  return Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8')
}

/**
 * The verdict for one source.
 *
 * `over` AT the limit, not one byte past it: the API wants a source SMALLER
 * than 256 KiB. `near` once the bytes left are within the margin.
 *
 * @param {{ bytes: number, limitBytes: number, warnMarginBytes?: number }} input
 * @returns {{ verdict: 'ok' | 'near' | 'over', bytes: number, limitBytes: number, bytesLeft: number }}
 */
export function judgeRulesSize({ bytes, limitBytes, warnMarginBytes = WARN_MARGIN_BYTES }) {
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new TypeError(`bytes must be a non-negative integer, got ${bytes}`)
  }
  if (!Number.isInteger(limitBytes) || limitBytes <= 0) {
    throw new TypeError(`limitBytes must be a positive integer, got ${limitBytes}`)
  }
  const bytesLeft = limitBytes - bytes
  const verdict = bytesLeft <= 0 ? 'over' : bytesLeft <= warnMarginBytes ? 'near' : 'ok'
  return { verdict, bytes, limitBytes, bytesLeft }
}

/** `262144` as `262,144`, without depending on the runtime's ICU data. */
const count = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * The report for one source: a summary line, plus what to do when it is near
 * or over. The first line names the file, the bytes and the limit, so it
 * still says what happened when it is the only line pasted into an issue.
 *
 * @param {{ path: string, limitSource: string, refusal: string, remedy: string }} source
 * @param {ReturnType<typeof judgeRulesSize>} judgement
 * @returns {string[]}
 */
export function formatRulesSize(source, judgement) {
  const { verdict, bytes, limitBytes, bytesLeft } = judgement
  const size = `${count(bytes)} of ${count(limitBytes)} bytes`
  if (verdict === 'ok') {
    return [`ok    ${source.path}: ${size}, ${count(bytesLeft)} left`]
  }
  const limit = `      The limit: ${source.limitSource}.`
  if (verdict === 'near') {
    return [
      `NEAR  ${source.path}: ${size}, only ${count(bytesLeft)} left`,
      limit,
      `      Make room before the next rule lands. ${source.remedy}`,
    ]
  }
  const past = bytesLeft === 0 ? 'exactly at the limit' : `${count(-bytesLeft)} over the limit`
  return [
    `OVER  ${source.path}: ${size}, ${past}`,
    limit,
    `      ${source.refusal}`,
    `      ${source.remedy}`,
  ]
}
