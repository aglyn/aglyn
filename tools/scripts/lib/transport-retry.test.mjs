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
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TRANSPORT_RETRY_DELAY_MS,
  fetchOnceMore,
  isTimeout,
} from './transport-retry.mjs'

const transport = (code) =>
  Object.assign(new TypeError('fetch failed'), { cause: { code } })
const timeout = () =>
  Object.assign(new Error('timed out'), { name: 'TimeoutError' })

function scripted(...outcomes) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, signal: init.signal })
    const next = outcomes.shift()
    if (next instanceof Error) throw next
    return next
  }
  return { fetchImpl, calls }
}

test('THE 2026-10-14 18:10Z RED: a DNS miss on the runner is tried once more, and the answer counts', async () => {
  const { fetchImpl, calls } = scripted(transport('ENOTFOUND'), { status: 200 })
  const response = await fetchOnceMore(
    'https://demo.aglyn.app/api/health',
    {},
    15_000,
    {
      fetchImpl,
      delayMs: 0,
    },
  )
  assert.equal(response.status, 200)
  assert.equal(calls.length, 2)
  // A fresh budget per try, never one shared signal.
  assert.notEqual(calls[0].signal, calls[1].signal)
})

test('a connection that fails twice is still DOWN: the second error is thrown', async () => {
  const { fetchImpl, calls } = scripted(
    transport('UND_ERR_CONNECT_TIMEOUT'),
    transport('ECONNREFUSED'),
  )
  await assert.rejects(
    fetchOnceMore('https://x.test', {}, 1_000, { fetchImpl, delayMs: 0 }),
    (error) => error.cause.code === 'ECONNREFUSED',
  )
  assert.equal(calls.length, 2)
})

test('a timeout is never retried: a hang is what the probe exists to catch', async () => {
  const { fetchImpl, calls } = scripted(timeout(), { status: 200 })
  await assert.rejects(
    fetchOnceMore('https://x.test', {}, 1_000, { fetchImpl, delayMs: 0 }),
    (error) => isTimeout(error),
  )
  assert.equal(calls.length, 1)
})

test('any response is graded as given: a 503 is not retried', async () => {
  const { fetchImpl, calls } = scripted({ status: 503 }, { status: 200 })
  const response = await fetchOnceMore('https://x.test', {}, 1_000, {
    fetchImpl,
    delayMs: 0,
  })
  assert.equal(response.status, 503)
  assert.equal(calls.length, 1)
})

test('the pause is short next to the fifteen-minute schedule', () => {
  assert.ok(TRANSPORT_RETRY_DELAY_MS > 0 && TRANSPORT_RETRY_DELAY_MS <= 5_000)
})
