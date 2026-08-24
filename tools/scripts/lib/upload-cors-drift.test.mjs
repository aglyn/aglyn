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
 * The cases here are pinned to LIVE MEASUREMENTS taken against
 * `gs://aglyn-main.appspot.com` and the `aglyn-console` Vercel project on
 * 2026-08-24, by driving real preflights — not to what the CORS spec or the
 * GCS documentation says ought to happen. Where the two could disagree, the
 * measurement wins, because the measurement is what a customer's browser does.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compareUploadCors,
  deriveRequiredOrigins,
  formatReport,
  mergeUploadOrigins,
  permittedUploadOrigins,
  pruneUploadOrigins,
  uploadOriginFor,
} from './upload-cors-drift.mjs'

/** The bucket as it actually stood on 2026-08-24, before this issue's fix. */
const LIVE_RULES = [
  {
    origin: [
      'https://app.aglyn.com',
      'https://agl1514-smoke-smt6qgruj.aglyn.com',
      'https://agl1514-smoke-smt6qpasb.aglyn.com',
    ],
    method: ['PUT'],
    responseHeader: ['Content-Type', 'x-goog-resumable'],
    maxAgeSeconds: 3600,
  },
]

/** The project as it actually stood on 2026-08-24, trimmed to the shapes. */
const LIVE_DOMAINS = [
  { name: 'app.aglyn.com', redirect: null, verified: true },
  { name: 'zgover.aglyn.com', redirect: null, verified: true },
  { name: 'agl1514-smoke-smt6qgruj.aglyn.com', redirect: null, verified: true },
  // Redirects: measured 308/307 to app.aglyn.com, absent from CORS, NOT broken.
  { name: 'console.aglyn.com', redirect: 'app.aglyn.com', verified: true },
  { name: 'app.aglyn.io', redirect: 'app.aglyn.com', verified: true },
  // A Vercel wildcard name. Can never be an exact origin.
  { name: '*.aglyn.io', redirect: 'app.aglyn.com', verified: true },
]

test('an origin is the scheme and host a browser actually sends', () => {
  assert.equal(uploadOriginFor('zgover.aglyn.com'), 'https://zgover.aglyn.com')
  assert.equal(uploadOriginFor('https://zgover.aglyn.com/media'), 'https://zgover.aglyn.com')
  assert.equal(uploadOriginFor('  ZGOVER.Aglyn.COM.  '), 'https://zgover.aglyn.com')
})

test('a wildcard name is never turned into an origin', () => {
  // `*.aglyn.io` is a real attached Vercel name. GCS has no subtree form, so
  // there is nothing this could correctly become.
  assert.equal(uploadOriginFor('*.aglyn.io'), null)
  assert.equal(uploadOriginFor('*'), null)
  assert.equal(uploadOriginFor(''), null)
})

test('a redirect name contributes NOTHING — measured, not assumed', () => {
  const required = deriveRequiredOrigins(LIVE_DOMAINS).map((entry) => entry.origin)
  assert.deepEqual(required, [
    'https://agl1514-smoke-smt6qgruj.aglyn.com',
    'https://app.aglyn.com',
    'https://zgover.aglyn.com',
  ])
  // The three redirect names are absent from the bucket and are not broken.
  assert.ok(!required.includes('https://console.aglyn.com'))
  assert.ok(!required.includes('https://app.aglyn.io'))
})

test('an attached but unverified name still counts, and is flagged', () => {
  const [entry] = deriveRequiredOrigins([
    { name: 'acme.example', redirect: null, verified: false },
  ])
  assert.equal(entry.origin, 'https://acme.example')
  assert.equal(entry.verified, false)
})

test('the live drift is reported as it was measured', () => {
  const result = compareUploadCors({
    domains: LIVE_DOMAINS,
    rules: LIVE_RULES,
    platformOrigin: 'https://app.aglyn.com',
  })
  assert.deepEqual(
    result.missing.map((entry) => entry.origin),
    ['https://zgover.aglyn.com'],
  )
  assert.deepEqual(
    result.stale.map((entry) => entry.origin),
    ['https://agl1514-smoke-smt6qpasb.aglyn.com'],
  )
})

test('an unreadable bucket is NOT an empty one — no verdict at all', () => {
  const result = compareUploadCors({ domains: LIVE_DOMAINS, rules: null })
  assert.equal(result.readable, false)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.stale, [])
  assert.match(formatReport(result, { bucket: 'b' }), /No verdict/)

  // Contrast: an EMPTY configuration is a definite answer, and the answer is
  // "everything is missing". Collapsing the two is how a credential failure
  // gets reported as clean.
  const empty = compareUploadCors({ domains: LIVE_DOMAINS, rules: [] })
  assert.equal(empty.readable, true)
  assert.equal(empty.missing.length, 3)
})

test('the platform origin is marked protected even when nothing serves it', () => {
  const result = compareUploadCors({
    domains: [{ name: 'zgover.aglyn.com', redirect: null }],
    rules: LIVE_RULES,
    platformOrigin: 'https://app.aglyn.com',
  })
  const platform = result.stale.find((e) => e.origin === 'https://app.aglyn.com')
  assert.equal(platform.protected, true)
})

test('a wildcard is reported AS the finding, not laundered into "clean"', () => {
  const result = compareUploadCors({
    domains: LIVE_DOMAINS,
    rules: [{ origin: ['*'], method: ['PUT'] }],
  })
  assert.equal(result.wildcard, true)
  // Truthful: a `*` really does permit every derived origin.
  assert.deepEqual(result.missing, [])
  assert.match(formatReport(result, { bucket: 'b' }), /WIDE OPEN/)
})

test('the merge PRESERVES every origin already there', () => {
  const { rules, added } = mergeUploadOrigins(LIVE_RULES, ['https://zgover.aglyn.com'])
  assert.deepEqual(added, ['https://zgover.aglyn.com'])
  // This is the assertion that fails if the merge ever becomes a replace —
  // the `--cors-file` foot-gun, whose failure mode is a platform-wide outage
  // that lands on somebody else days later.
  for (const origin of LIVE_RULES[0].origin) {
    assert.ok(permittedUploadOrigins(rules).includes(origin), `dropped ${origin}`)
  }
  assert.equal(permittedUploadOrigins(rules).length, 4)
})

test('the merge does not grow a rule per customer', () => {
  const { rules } = mergeUploadOrigins(LIVE_RULES, ['https://a.example', 'https://b.example'])
  assert.equal(rules.length, 1)
})

test('the merge REFUSES a wildcard rather than returning an ignorable error', () => {
  assert.throws(
    () => mergeUploadOrigins(LIVE_RULES, ['*']),
    /wildcard/,
  )
})

test('a merge with nothing missing writes nothing', () => {
  const { rules, added } = mergeUploadOrigins(LIVE_RULES, ['https://app.aglyn.com'])
  assert.deepEqual(added, [])
  assert.equal(rules, LIVE_RULES)
})

test('the prune refuses the platform origin', () => {
  const { rules, removed, refused } = pruneUploadOrigins(
    LIVE_RULES,
    ['https://app.aglyn.com', 'https://agl1514-smoke-smt6qpasb.aglyn.com'],
    { keep: ['https://app.aglyn.com'] },
  )
  assert.deepEqual(removed, ['https://agl1514-smoke-smt6qpasb.aglyn.com'])
  assert.deepEqual(refused, ['https://app.aglyn.com'])
  assert.ok(permittedUploadOrigins(rules).includes('https://app.aglyn.com'))
})

test('a rule pruned empty is dropped, not left permitting nothing', () => {
  const { rules } = pruneUploadOrigins(
    [{ origin: ['https://gone.example'], method: ['PUT'] }],
    ['https://gone.example'],
  )
  assert.deepEqual(rules, [])
})

test('a non-upload rule on the bucket is left alone by both operations', () => {
  const foreign = { origin: ['https://elsewhere.example'], method: ['GET'] }
  const merged = mergeUploadOrigins([foreign, ...LIVE_RULES], ['https://new.example'])
  assert.deepEqual(merged.rules[0], foreign)
  const pruned = pruneUploadOrigins([foreign, ...LIVE_RULES], ['https://elsewhere.example'])
  assert.deepEqual(pruned.rules[0], foreign)
  assert.deepEqual(pruned.removed, [])
})
