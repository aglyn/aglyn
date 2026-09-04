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
 * The uptime notifier's decision and payload (AGL-2586).
 *
 * A notification path whose only test is a real outage cannot be shown to
 * work until the day it matters. These cover the decision — including the two
 * ways a notifier goes wrong, sending nothing during an outage and sending
 * during a healthy day — and the sentence a reader is actually woken by.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  downTargets,
  JOURNEY_MEANING,
  shouldReport,
  slackPayload,
} from './uptime-red-report.mjs'

const UP = { name: 'console', url: 'https://c/api/health', ok: true, detail: 'healthy' }
const DOWN = {
  name: 'console/crons',
  url: 'https://c/api/health/crons',
  ok: false,
  detail: 'HTTP 503 · cronJobs=job-silent',
}
const PENDING = {
  name: 'console/journeys',
  url: 'https://c/api/health/journeys',
  ok: true,
  pending: true,
  status: 404,
  detail: 'PENDING — this deployment does not serve it yet (promote main)',
}
const JOURNEY_DOWN = {
  name: 'tenant/funnel',
  url: 'https://t/api/health/funnel',
  ok: false,
  detail: 'HTTP 503 · routing=lead-forms-below-floor',
}

describe('what the uptime notifier reports', () => {
  it('says nothing when everything is up', () => {
    assert.equal(shouldReport([UP, UP]), false)
    assert.deepEqual(downTargets([UP]), [])
  })

  it('says nothing about a route awaiting promotion', () => {
    // A subsystem 404 while the root is up is a fact about the deploy queue.
    // Paging on it is the false alarm that gets a channel muted.
    assert.equal(shouldReport([UP, PENDING]), false)
  })

  it('reports a target that is really down', () => {
    assert.equal(shouldReport([UP, DOWN]), true)
    assert.deepEqual(downTargets([UP, DOWN, PENDING]), [DOWN])
  })

  it('tolerates an empty or missing result set rather than throwing', () => {
    assert.equal(shouldReport([]), false)
    assert.equal(shouldReport(undefined), false)
  })
})

describe('the message', () => {
  it('names the target, the reason and the URL', () => {
    const payload = slackPayload({ results: [UP, DOWN], runUrl: 'https://run' })
    assert.match(payload.text, /console\/crons/)
    const body = payload.blocks[0].text.text
    assert.match(body, /job-silent/)
    assert.match(body, /https:\/\/c\/api\/health\/crons/)
    assert.match(body, /https:\/\/run/)
  })

  /**
   * The distinction AGL-2586 exists for: a degraded subsystem and "nobody can
   * reach us" must not read the same in the first line.
   */
  it('leads with the journey when a journey is the thing that failed', () => {
    const payload = slackPayload({ results: [JOURNEY_DOWN], runUrl: '' })
    assert.match(payload.text, /USER JOURNEY/)
    assert.match(payload.blocks[0].text.text, new RegExp(JOURNEY_MEANING['tenant/funnel']))
  })

  it('makes no journey claim about an ordinary subsystem', () => {
    const payload = slackPayload({ results: [DOWN], runUrl: '' })
    assert.doesNotMatch(payload.text, /USER JOURNEY/)
  })

  it('every journey endpoint on the watch list has a sentence', async () => {
    // Derived from the watch list rather than listed here, so a journey check
    // added later without a meaning is caught rather than reported bare.
    const { SUBSYSTEM_HEALTH } = await import('./uptime-targets.mjs')
    const journeyPaths = ['/api/health/journeys', '/api/health/funnel']
    for (const [target, paths] of Object.entries(SUBSYSTEM_HEALTH)) {
      for (const path of paths) {
        if (!journeyPaths.includes(path)) continue
        const name = `${target}/${path.slice('/api/health/'.length)}`
        assert.ok(
          JOURNEY_MEANING[name],
          `${name} is on the watch list with no sentence in JOURNEY_MEANING`,
        )
      }
    }
  })

  it('carries no secret', () => {
    const serialized = JSON.stringify(
      slackPayload({ results: [DOWN, JOURNEY_DOWN], runUrl: 'https://run' }),
    )
    assert.doesNotMatch(serialized, /password|secret|token|Bearer|sk_/i)
  })
})
