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
 * An optional check needs TWO edits to reach the body (AGL-2720).
 *
 * `probeJourneys` returns the optional checks it was asked for, and the route
 * handler destructures a fixed list and spreads a fixed list. Add a check to
 * the first and forget the second and there is no error anywhere: the probe
 * runs, the marker is read, the verdict is computed, and the handler drops it
 * on the floor.
 *
 * That happened. `edgeAdmission` shipped with the probe wired and the handler
 * untouched — the flag was on, the sampler was running every half hour, the
 * marker was fresh, and `/api/health/journeys` reported five checks with no
 * mention of it. Nothing was red, which is what made it hard to see: the
 * check was not failing, it was ABSENT, and absent is exactly what the same
 * endpoint means when a check is deliberately switched off.
 *
 * So this reads the two files against each other rather than trusting either.
 * Source-level, like `signup-canary-marker-wiring.spec.ts`: importing the
 * route drags `@aglyn/tenant-data-admin` and `next/cache` into a plain jest
 * environment, and the question here is about the text anyway.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTE = join(__dirname, '../app/api/health/journeys/route.ts')
const PROBE = join(__dirname, '../app/api/health/journeys/journeys-probe.ts')

/**
 * The optional members of `JourneysProbeResult` — the ones declared `name?:`.
 * A required check cannot go missing this way, because dropping it from the
 * handler's destructure is a type error.
 */
function optionalChecks(): string[] {
  const source = readFileSync(PROBE, 'utf8')
  const block = source.slice(
    source.indexOf('export interface JourneysProbeResult'),
  )
  const body = block.slice(0, block.indexOf('\n}'))
  return [...body.matchAll(/^\s{2}(\w+)\?:/gm)].map((match) => match[1])
}

describe('the journeys route emits every optional check the probe can return', () => {
  const route = readFileSync(ROUTE, 'utf8')
  const checks = optionalChecks()

  it('finds the optional checks at all', () => {
    // The guard on the guard. Every assertion below iterates this list, so an
    // empty one would turn the whole file green while asserting nothing —
    // the AGL-2402 failure, where a search that had stopped matching read as
    // a clean result.
    expect(checks.length).toBeGreaterThanOrEqual(3)
    expect(checks).toEqual(
      expect.arrayContaining([
        'signupCanary',
        'appCheckAttestation',
        'edgeAdmission',
      ]),
    )
  })

  it.each(optionalChecks())('destructures %s from the probe result', (name) => {
    // Destructured but never spread is the half-wiring that shipped, so both
    // halves are asserted separately rather than as one regex.
    expect(route).toMatch(new RegExp(`\\b${name}\\b[,\\s]*[},]`))
  })

  it.each(optionalChecks())('spreads %s into the body only when present', (name) => {
    // The exact conditional-spread form. An absent check must leave no key at
    // all: `name: undefined` serializes as a check carrying no verdict, which
    // reads to a monitor as a check that answered.
    const spread = new RegExp(
      `\\.\\.\\.\\(\\s*${name}\\s*\\?\\s*\\{\\s*${name}\\s*\\}\\s*:\\s*\\{\\}\\s*\\)`,
    )
    expect(route).toMatch(spread)
  })
})
