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

// The bounded 429 retry behind `postConsoleCron`, against the compiled module.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RATE_LIMIT_DEFAULT_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
  rateLimitRetryDelayMs,
} from '../lib/rate-limit-retry.js'

test('a 429 is retried after the Retry-After it names', () => {
  assert.equal(rateLimitRetryDelayMs(429, '12', 0), 12_000)
})

test('a 429 with no usable Retry-After waits the default', () => {
  assert.equal(rateLimitRetryDelayMs(429, null, 0), RATE_LIMIT_DEFAULT_DELAY_MS)
  assert.equal(
    rateLimitRetryDelayMs(429, 'Fri, 09 Oct 2026 14:01:00 GMT', 0),
    RATE_LIMIT_DEFAULT_DELAY_MS,
  )
})

test('a long Retry-After is capped so the sweep keeps its budget', () => {
  assert.equal(rateLimitRetryDelayMs(429, '60', 0), RATE_LIMIT_MAX_DELAY_MS)
})

test('the retries are bounded', () => {
  assert.equal(rateLimitRetryDelayMs(429, '1', RATE_LIMIT_MAX_RETRIES), null)
})

test('no other status is retried', () => {
  for (const status of [200, 207, 401, 403, 500, 501, 503]) {
    assert.equal(rateLimitRetryDelayMs(status, '1', 0), null)
  }
})
