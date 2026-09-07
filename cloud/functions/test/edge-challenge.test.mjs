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

// The retry decision behind `postConsoleCron` (AGL-2642), run against the
// compiled module: `npm test` builds first, because this package has no test
// harness of its own and `tsc` is the only transform it carries.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EDGE_CHALLENGE_RETRY_DELAY_MS,
  isEdgeChallenge,
} from '../lib/edge-challenge.js'

/** The opening bytes of the page the Vercel firewall serves. */
const CHECKPOINT_PAGE =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Vercel Security Checkpoint</title></head><body></body></html>'

/** What every cron route answers with when IT refuses. */
const ROUTE_REFUSAL = '{"error":"unauthorized"}'

test('the checkpoint page on a 403 is a challenge', () => {
  assert.equal(isEdgeChallenge(403, 'text/html; charset=utf-8', CHECKPOINT_PAGE), true)
})

test('the checkpoint page on a 429 is a challenge', () => {
  assert.equal(isEdgeChallenge(429, 'text/html; charset=utf-8', CHECKPOINT_PAGE), true)
})

test('an html content type is enough on its own, whatever the body says', () => {
  assert.equal(isEdgeChallenge(403, 'text/html', ''), true)
  assert.equal(isEdgeChallenge(429, 'TEXT/HTML; charset=UTF-8', 'Access denied'), true)
})

test('the body decides when the content type is missing', () => {
  assert.equal(isEdgeChallenge(403, null, CHECKPOINT_PAGE), true)
  assert.equal(isEdgeChallenge(403, undefined, '<html><body>Checking…</body></html>'), true)
  assert.equal(isEdgeChallenge(429, null, '\uFEFF\n  <!doctype html>'), true)
})

test('a route refusal with a JSON body is NOT a challenge, on either status', () => {
  assert.equal(isEdgeChallenge(403, 'application/json', ROUTE_REFUSAL), false)
  assert.equal(isEdgeChallenge(429, 'application/json; charset=utf-8', ROUTE_REFUSAL), false)
})

test('a refusal with nothing to read is NOT a challenge', () => {
  assert.equal(isEdgeChallenge(403, null, ''), false)
  assert.equal(isEdgeChallenge(403, null, null), false)
  assert.equal(isEdgeChallenge(429, undefined, undefined), false)
})

test('the statuses the route itself answers with are never retried, page or not', () => {
  for (const status of [401, 500, 501, 502, 503]) {
    assert.equal(isEdgeChallenge(status, 'text/html', CHECKPOINT_PAGE), false, `status ${status}`)
  }
})

test('a page on a success or a redirect is not a challenge', () => {
  assert.equal(isEdgeChallenge(200, 'text/html', CHECKPOINT_PAGE), false)
  assert.equal(isEdgeChallenge(307, 'text/html', CHECKPOINT_PAGE), false)
})

test('the retry waits between five and ten seconds', () => {
  assert.ok(EDGE_CHALLENGE_RETRY_DELAY_MS >= 5_000)
  assert.ok(EDGE_CHALLENGE_RETRY_DELAY_MS <= 10_000)
})
