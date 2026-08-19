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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AGL-2134 — a cron is wired in THREE places and any one of them can be
 * forgotten.
 *
 * `campaigns/process-scheduled` had been correct and unreachable since
 * AGL-272: a `schedule` entry, a `case` arm mapping that cron string to a
 * route, and a `workflow_dispatch` option are three separate edits in one
 * file, and it had none of them. The failure is silent in the worst way —
 * the console shows the customer a `Scheduled` chip, and the send never
 * happens.
 *
 * So the assertion is not "campaigns is listed". It is the invariant that
 * every schedule resolves to a route and every route can also be run by
 * hand — which fails on the NEXT half-wired cron too. Removing any one of
 * the three edits AGL-2134 made fails a different test below.
 */
describe('scheduled-crons.yml wiring', () => {
  const workflow = readFileSync(
    join(__dirname, '..', '..', '..', '.github', 'workflows', 'scheduled-crons.yml'),
    'utf8',
  )

  /** Every `- cron: '<expr>'` under `on.schedule`. */
  const scheduled = [...workflow.matchAll(/^\s*- cron: '([^']+)'/gm)].map(
    (match) => match[1],
  )
  /** Every `'<expr>') path=<route> ;;` arm in the resolver. */
  const caseArms = new Map(
    [...workflow.matchAll(/^\s*'([^']+)'\)\s*path=(\S+)\s*;;/gm)].map(
      (match) => [match[1], match[2]] as const,
    ),
  )
  /** Every `- /api/...` line in the `workflow_dispatch` choice list. */
  const dispatchOptions = new Set(
    [...workflow.matchAll(/^\s*- (\/api\/\S+)$/gm)].map((match) => match[1]),
  )

  it('parses the workflow at all', () => {
    // A regex that silently matched nothing would make every assertion
    // below vacuously true — the exact shape this file exists to catch.
    expect(scheduled.length).toBeGreaterThanOrEqual(10)
    expect(caseArms.size).toBeGreaterThanOrEqual(10)
    expect(dispatchOptions.size).toBeGreaterThanOrEqual(10)
  })

  it('resolves EVERY schedule to a route', () => {
    const unresolved = scheduled.filter((cron) => !caseArms.has(cron))
    expect(unresolved).toEqual([])
  })

  it('offers every scheduled route as a manual dispatch too', () => {
    // A cron that cannot be triggered by hand cannot be tested, re-run
    // after an incident, or verified after a deploy.
    const missing = scheduled
      .map((cron) => caseArms.get(cron))
      .filter((route): route is string => Boolean(route))
      .filter((route) => !dispatchOptions.has(route))
    expect(missing).toEqual([])
  })

  it('has no case arm for a schedule that no longer fires', () => {
    // The other direction: a removed `- cron:` line leaves dead routing
    // behind, and the next person reads it as proof the job still runs.
    const orphaned = [...caseArms.keys()].filter(
      (cron) => !scheduled.includes(cron),
    )
    expect(orphaned).toEqual([])
  })

  it('drives the scheduled-campaign processor', () => {
    // The specific regression: the feature `/product/marketing` sells.
    expect(caseArms.get('*/15 * * * *')).toBe(
      '/api/campaigns/process-scheduled',
    )
  })

  it('runs the campaign processor often enough to honour a clock time', () => {
    // The composer takes a `datetime-local` down to the minute. A daily
    // sweep would satisfy every assertion above while turning "9:00 AM"
    // into "some time today" — correct wiring, false promise.
    const cron = [...caseArms.entries()].find(
      ([, route]) => route === '/api/campaigns/process-scheduled',
    )?.[0]
    expect(cron).toBeDefined()
    const minuteField = (cron as string).split(' ')[0]
    const everyNMinutes = /^\*\/(\d+)$/.exec(minuteField)
    expect(everyNMinutes).not.toBeNull()
    expect(Number(everyNMinutes?.[1])).toBeLessThanOrEqual(15)
  })
})
