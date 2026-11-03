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
  RUNNER_STALL_MS,
  TRANSPORT_RETRY_DELAY_MS,
  fetchOnceMore,
  isTimeout,
  retryAfterRunnerStall,
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

const up = (name, ms) => ({ name, ms, ok: true, detail: 'healthy' })
const hung = (name, ms = 15_001) => ({
  name,
  ms,
  ok: false,
  noResponse: true,
  detail: 'no response in 15000ms',
})

function reprober(answers) {
  const asked = []
  const reprobe = async (index) => {
    asked.push(index)
    return answers[index]
  }
  return { reprobe, asked }
}

test('THE 2026-11-03 16:53Z RED: every answer took 12.6 s, so the rows with none are tried again and the second try decides', async () => {
  const first = [
    hung('console', 18_859),
    up('console/crons', 12_706),
    hung('console/auth-doors'),
    up('front-door/marketing', 12_687),
  ]
  const { reprobe, asked } = reprober([up('console', 465), null, up('console/auth-doors', 3_573), null])
  const { results, stall } = await retryAfterRunnerStall(first, reprobe)
  assert.deepEqual(asked, [0, 2])
  assert.deepEqual(stall, { fastestMs: 12_687, retried: 2 })
  assert.ok(results.every((r) => r.ok))
  // The rows that answered the first time are kept as they were.
  assert.equal(results[1], first[1])
  assert.equal(results[3], first[3])
  // The log still says what the first try saw.
  assert.match(results[0].detail, /tried again: the runner stalled \(first try 18859ms, no response in 15000ms\)/)
})

test('THE 2026-10-05 HANG: cached pages answered at once, so a hung render is not retried and stays DOWN', async () => {
  const first = [up('front-door/site', 310), up('tenant', 420), hung('render/site/dynamic')]
  const { reprobe, asked } = reprober([])
  const { results, stall } = await retryAfterRunnerStall(first, reprobe)
  assert.equal(stall, null)
  assert.deepEqual(asked, [])
  assert.equal(results, first)
  assert.equal(results[2].ok, false)
})

test('a site that is really down fails the second try too, and the row stays DOWN', async () => {
  const first = [hung('console'), hung('tenant')]
  const { reprobe, asked } = reprober([hung('console'), hung('tenant')])
  const { results, stall } = await retryAfterRunnerStall(first, reprobe)
  assert.deepEqual(asked, [0, 1])
  assert.deepEqual(stall, { fastestMs: null, retried: 2 })
  assert.ok(results.every((r) => !r.ok))
})

test('a run where every row answered is never retried, however slow', async () => {
  const first = [up('console', 12_000), { name: 'tenant', ms: 13_000, ok: false, status: 503, detail: 'HTTP 503' }]
  const { reprobe, asked } = reprober([])
  const { results, stall } = await retryAfterRunnerStall(first, reprobe)
  assert.equal(stall, null)
  assert.deepEqual(asked, [])
  assert.equal(results, first)
})

test('the stall line sits well above every fastest answer the red runs before AGL-4137 saw', () => {
  // The slowest "fastest answer" across the 40 red runs from 2026-10-17 to 2026-11-02 was 664ms.
  assert.ok(RUNNER_STALL_MS >= 5 * 664)
  assert.ok(RUNNER_STALL_MS < 15_000)
})
