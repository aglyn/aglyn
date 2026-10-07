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

// Self-test for the local AI jobs beat (AGL-3596): it calls the route the
// scheduler calls, with the secret in the header the route reads, only while
// a job is due, and one call at a time.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AI_JOBS_BEAT_ROUTE,
  startAiJobsBeatPump,
} from './ai-jobs-beat-pump.mjs'

// Each case stops the pump at once: the loop has already begun its first
// tick, which runs to the end, so one tick is what is observed.
const noSleep = async () => undefined

describe('startAiJobsBeatPump', () => {
  it('POSTs the beat route with the cron secret while a job is due', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ held: false }) }
    }
    const pump = startAiJobsBeatPump({
      origin: 'http://localhost:4610',
      secret: 'local',
      due: async () => 1,
      fetchImpl,
      sleep: noSleep,
    })
    await pump.stop()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `http://localhost:4610${AI_JOBS_BEAT_ROUTE}`)
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers['x-cron-secret'], 'local')
    assert.equal(pump.stats.failures, 0)
  })

  it('sends nothing while no job is due', async () => {
    let calls = 0
    const pump = startAiJobsBeatPump({
      origin: 'http://localhost:4610',
      secret: 'local',
      due: async () => 0,
      fetchImpl: async () => {
        calls += 1
        return { ok: true, status: 200, json: async () => ({}) }
      },
      sleep: noSleep,
    })
    await pump.stop()
    assert.equal(calls, 0)
    assert.ok(pump.stats.idleTicks >= 1)
  })

  it('counts a refused beat as a failure', async () => {
    const pump = startAiJobsBeatPump({
      origin: 'http://localhost:4610',
      secret: 'wrong',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthenticated' }),
      }),
      sleep: noSleep,
    })
    await pump.stop()
    assert.ok(pump.stats.failures >= 1)
    assert.equal(pump.stats.lastStatus, 401)
  })

  it('refuses to start without an origin or a secret', () => {
    assert.throws(
      () => startAiJobsBeatPump({ origin: '', secret: 'x' }),
      /origin/,
    )
    assert.throws(
      () => startAiJobsBeatPump({ origin: 'http://localhost:1', secret: '' }),
      /CRON_SECRET/,
    )
  })
})
