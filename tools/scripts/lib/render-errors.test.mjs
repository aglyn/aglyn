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

// The route-split 5xx grader (AGL-2709).
//
// The fixtures below are REAL entries, copied out of
// `projects/aglyn-main/logs/vercel-runtime` on 2026-09-09 — the outage's own
// record and the noise it arrived in. Nothing here is invented, because the
// claim the grader rests on is a claim about production's actual stream: 251
// drained 5xx over the 48 hours to 2026-09-09, of which 229 were `/api/health/*`
// answering 503 by design and 22 were the incident.
//
// So the suite is written from both sides, and the second side is the one that
// matters. A grader that reddens on any 5xx would pass every "goes red" test
// here and be useless — it would have been red for six hours on 2026-09-07
// while a health check correctly reported a broken cron. The green-with-noise
// case is what makes the red case worth anything.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HANDLER,
  HEALTH_CONTRACT,
  PAGE,
  classifyEntry,
  gradeRenderErrors,
  renderErrorLines,
  renderErrorsFilter,
} from './render-errors.mjs'

/**
 * The outage, as the drain recorded it.
 *
 * `route` is the PATTERN Vercel matched, not the path a visitor typed —
 * `/[host]/[[...slug]]` for both `aglyn.com/` and `demo.aglyn.app/`, which is
 * why one row can name two hosts.
 */
const OUTAGE = [
  {
    timestamp: '2026-09-09T04:02:13.993246471Z',
    jsonPayload: {
      route: '/[host]/[[...slug]]',
      project: 'aglyn-tenant',
      host: 'demo.aglyn.app',
      statusCode: 500,
      proxyStatusCode: 500,
      level: 'error',
      environment: 'production',
    },
  },
  {
    timestamp: '2026-09-09T04:08:42.342383288Z',
    jsonPayload: {
      route: '/[host]/[[...slug]]',
      project: 'aglyn-tenant',
      host: 'aglyn.com',
      statusCode: 500,
      proxyStatusCode: 500,
      level: 'error',
      environment: 'production',
    },
  },
  {
    timestamp: '2026-09-09T04:09:16.412819365Z',
    jsonPayload: {
      route: '/[host]/[[...slug]]',
      project: 'aglyn-tenant',
      host: 'aglyn.com',
      statusCode: 500,
      proxyStatusCode: 500,
      level: 'error',
      environment: 'production',
    },
  },
]

/**
 * The 91%: health contracts reporting degraded, exactly as designed.
 *
 * `/api/health/crons` was RIGHT about a broken job for six hours on
 * 2026-09-07; `/api/health/funnel` was right about the forms; `/api/health/
 * server-errors` was right about the outage above. Every one of them is read
 * by the 15-minute uptime probe, an UptimeRobot monitor and the docs status
 * page — which is what makes excusing them here a removal of a duplicate
 * rather than of a signal.
 */
const HEALTH_503 = [
  {
    timestamp: '2026-09-07T12:58:34.842736863Z',
    jsonPayload: {
      route: '/api/health/crons',
      project: 'aglyn-console',
      host: 'app.aglyn.com',
      statusCode: 503,
      proxyStatusCode: 503,
      level: 'error',
      environment: 'production',
    },
  },
  {
    timestamp: '2026-09-07T19:59:46.495038643Z',
    jsonPayload: {
      route: '/api/health/funnel',
      project: 'aglyn-tenant',
      host: 'aglyn.com',
      statusCode: 503,
      proxyStatusCode: 503,
      level: 'error',
      environment: 'production',
    },
  },
  {
    timestamp: '2026-09-09T04:38:21.614698698Z',
    jsonPayload: {
      route: '/api/health/server-errors',
      project: 'aglyn-console',
      host: 'app.aglyn.com',
      statusCode: 503,
      proxyStatusCode: 503,
      level: 'error',
      environment: 'production',
    },
  },
]

describe('classifyEntry separates a page from a handler from a verdict', () => {
  it('calls the ISR catch-all a PAGE', () => {
    assert.equal(classifyEntry(OUTAGE[0]), PAGE)
  })

  it('calls a health contract 503 what it is, and does not grade it', () => {
    for (const entry of HEALTH_503) {
      assert.equal(classifyEntry(entry), HEALTH_CONTRACT)
    }
  })

  /**
   * The exemption is for the CONTRACT, not for the route. `healthHttpStatus`
   * answers 503 when a check reports degraded and 200 when it does not; a 500
   * from the same path is the handler itself throwing, and excusing that would
   * make the health routes the one part of the platform nothing watches.
   */
  it('does NOT excuse a 500 from a health route', () => {
    assert.equal(
      classifyEntry({
        jsonPayload: { route: '/api/health/crons', statusCode: 500 },
      }),
      HANDLER,
    )
  })

  /** `fatal` is process death. A dead health route is not a health verdict. */
  it('does NOT excuse a fatal line on a health route', () => {
    assert.equal(
      classifyEntry({
        jsonPayload: {
          route: '/api/health/crons',
          statusCode: 503,
          level: 'fatal',
        },
      }),
      HANDLER,
    )
  })

  /**
   * An unattributable line must not trip the strictest arm on the board.
   * Guessing upward is how one malformed entry becomes a page incident.
   */
  it('calls an entry with no route a handler, never a page', () => {
    assert.equal(classifyEntry({ jsonPayload: { statusCode: 500 } }), HANDLER)
  })

  /**
   * A path prefix, not a string prefix — the same rule `isHealthContractEntry`
   * applies on the writing side. `/api/healthcheck` shares six letters with the
   * contract and none of its guarantees.
   */
  it('does not excuse a route that merely starts with the same letters', () => {
    assert.equal(
      classifyEntry({
        jsonPayload: { route: '/api/healthcheck', statusCode: 503 },
      }),
      HANDLER,
    )
    assert.equal(
      classifyEntry({ jsonPayload: { route: '/api/health', statusCode: 503 } }),
      HEALTH_CONTRACT,
    )
  })

  it('reads a bare payload as well as a Cloud Logging entry', () => {
    assert.equal(
      classifyEntry({ route: '/[host]/[[...slug]]', statusCode: 500 }),
      PAGE,
    )
  })
})

describe('the grader goes red on the outage and green on the noise', () => {
  it('reddens on the real 2026-09-09 entries, naming the route', () => {
    const verdict = gradeRenderErrors(OUTAGE)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.pageErrors, 3)
    assert.equal(verdict.byRoute.length, 1)
    assert.deepEqual(
      { route: verdict.byRoute[0].route, project: verdict.byRoute[0].project },
      { route: '/[host]/[[...slug]]', project: 'aglyn-tenant' },
    )
    assert.deepEqual(verdict.byRoute[0].hosts, ['aglyn.com', 'demo.aglyn.app'])
  })

  /**
   * ⚠️ THE CASE THE WHOLE MODULE IS FOR. Three real 5xx entries, from three
   * different days, on three different health routes, in two different
   * deployments — and the verdict is clean. A grader that reddened here would
   * have been red for six of the twenty-four hours of 2026-09-07 with nothing
   * wrong, and an alarm that cries wolf for six hours is worse than the gap it
   * was built to close.
   */
  it('stays green on health-contract 503s and says how many it excused', () => {
    const verdict = gradeRenderErrors(HEALTH_503)
    assert.equal(verdict.ok, true)
    assert.equal(verdict.pageErrors, 0)
    assert.equal(verdict.healthContract, 3)
    assert.match(verdict.detail, /3 health-contract 503/)
  })

  /**
   * The mixed window is the real one: the outage did not arrive in a quiet
   * stream, it arrived beside `/api/health/server-errors` correctly answering
   * 503 about it.
   */
  it('finds the page errors inside a window that is mostly noise', () => {
    const verdict = gradeRenderErrors([...HEALTH_503, ...OUTAGE])
    assert.equal(verdict.ok, false)
    assert.equal(verdict.pageErrors, 3)
    assert.equal(verdict.healthContract, 3)
  })

  /** An empty window is clean, and must not read as an unasked question. */
  it('is green on nothing at all', () => {
    assert.equal(gradeRenderErrors([]).ok, true)
    assert.equal(gradeRenderErrors(null).ok, true)
  })

  /**
   * `tolerated` exists for the day this is wired to something that pages, and
   * the default is 0 for the reason the module docstring measures. Asserting
   * both directions keeps the knob real rather than decorative.
   */
  it('honors a raised tolerance without changing what it counted', () => {
    const verdict = gradeRenderErrors(OUTAGE, { tolerated: 5 })
    assert.equal(verdict.ok, true)
    assert.equal(verdict.pageErrors, 3)
  })
})

describe('the filter and the report', () => {
  it('names the drain log and the window it was asked for', () => {
    const filter = renderErrorsFilter({
      sinceIso: '2026-09-09T04:00:00Z',
      untilIso: '2026-09-09T04:15:00Z',
    })
    assert.match(filter, /logName="projects\/aglyn-main\/logs\/vercel-runtime"/)
    assert.match(filter, /severity>=ERROR/)
    assert.match(filter, /timestamp>="2026-09-09T04:00:00Z"/)
    assert.match(filter, /timestamp<"2026-09-09T04:15:00Z"/)
  })

  it('leaves the upper bound off an open-ended window', () => {
    assert.doesNotMatch(
      renderErrorsFilter({ sinceIso: '2026-09-09T04:00:00Z' }),
      /timestamp</,
    )
  })

  /**
   * The report is asserted rather than eyeballed because it IS the output:
   * a reader who cannot see the route pattern and the first/last stamp has to
   * go back to the console to start triage, which is the trip this exists to
   * save.
   */
  it('prints the route, the count and the span', () => {
    const lines = renderErrorLines(gradeRenderErrors(OUTAGE), {
      since: '2026-09-09T04:00:00Z',
      until: '2026-09-09T04:15:00Z',
    }).join('\n')
    assert.match(lines, /ERRORS/)
    assert.match(
      lines,
      /3x aglyn-tenant \/\[host\]\/\[\[\.\.\.slug\]\] status=500/,
    )
    assert.match(lines, /2026-09-09T04:02:13/)
    assert.match(lines, /2026-09-09T04:09:16/)
  })

  it('says CLEAN, and what it excused, when there is nothing to report', () => {
    const lines = renderErrorLines(gradeRenderErrors(HEALTH_503), {
      since: '2026-09-07T00:00:00Z',
      until: null,
    }).join('\n')
    assert.match(lines, /CLEAN/)
    assert.match(lines, /health-contract 503/)
  })
})
