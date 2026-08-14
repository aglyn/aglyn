/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
 *
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
 * A killed plugin's BACKGROUND work stops too (AGL-1689, gap 2).
 *
 * Both API dispatchers subtract a flagged-off plugin. The job runner
 * subtracted nothing and contained no release-flag reference at all, so
 * `release_bookings` off still let `expire-stale-holds` rewrite booking
 * documents every six hours. A job is the one surface with no user to notice
 * it is still running, which is why it should be the first thing a kill switch
 * reaches rather than the last.
 *
 * The assertion is the HANDLER SIDE EFFECT, never the response body: the claim
 * is that the job's writes do not happen, and a runner that reported a job as
 * skipped while still invoking it would satisfy any weaker check.
 *
 * The registry and the flag-filter POLICY are both real — only the flag
 * VERDICT is stubbed. That matters for the `core` case: `filterPluginsByReleaseFlags`
 * passing unknown plugin ids through is what keeps the platform's own
 * publish-schedule job running while a first-party plugin is dark, and a
 * hand-written stub would assert that property against itself.
 */

process.env.PLUGIN_JOBS_SECRET = 'test-secret'

/** What the release-flag verdict should be for every flagged plugin. */
let mockFlagOn: boolean
/** Job handlers that actually executed, by `pluginId:name`. */
let mockRanHandlers: string[]

jest.mock('@aglyn/tenant-data-admin', () => {
  const { filterPluginsByReleaseFlags } = jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  )
  return {
    __esModule: true,
    // The REAL subtraction policy behind a stubbed verdict: unknown ids and
    // always-on ids pass, a flagged first-party id does not.
    filterEnabledPluginsByReleaseFlags: jest.fn(
      async (pluginIds: string[]) =>
        filterPluginsByReleaseFlags(pluginIds, () => mockFlagOn),
    ),
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => ({ data: () => ({}) }),
              set: async () => undefined,
            }),
          }),
        }),
      }),
    },
  }
})

// The REAL job registry — registration, ordering and error isolation all run
// as they do in production; only the route's surroundings are stubbed.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/plugin-jobs',
  ),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: jest.fn(async () => undefined) },
}))

// Imported by the route purely for its registration side effect. Stubbed so
// this suite controls the whole registry rather than inheriting a core job
// that would reach Firestore.
jest.mock('../utils/publish-schedule-job', () => ({ __esModule: true }))

jest.mock('../utils/plugin-job-state', () => ({
  __esModule: true,
  // Every job is due — so a job that does not run was held, not merely early.
  readPluginJobLastRuns: jest.fn(async () => ({})),
  recordPluginJobRuns: jest.fn(),
}))

// Through the BARREL, not the file. The mock above re-exports the real
// plugin-jobs module, so this is the same registry instance the route writes
// into — and an nx boundary rule forbids a static relative import of another
// project regardless.
import { registerPluginJob } from '@aglyn/aglyn/server'
import { POST } from '../app/api/plugins/run-jobs/route'

const runJobs = () =>
  POST(
    new Request('https://site.aglyn.app/api/plugins/run-jobs', {
      method: 'POST',
      headers: { 'x-plugin-jobs-secret': 'test-secret' },
    }),
  )

beforeEach(() => {
  mockFlagOn = false
  mockRanHandlers = []
  // `bookings` carries `release_bookings`; `core` is the namespace the
  // platform's own publish-schedule job registers under and matches no
  // first-party plugin.
  registerPluginJob({
    pluginId: 'bookings',
    name: 'expire-stale-holds',
    intervalMinutes: 360,
    handler: () => {
      mockRanHandlers.push('bookings:expire-stale-holds')
    },
  })
  registerPluginJob({
    pluginId: 'core',
    name: 'apply-publish-schedules',
    intervalMinutes: 1,
    handler: () => {
      mockRanHandlers.push('core:apply-publish-schedules')
    },
  })
})

describe('plugin job runner — release gate', () => {
  it('does not run a flagged-off plugin job', async () => {
    const response = await runJobs()

    expect(response.status).toBe(200)
    // The whole bug: the handler that mutates booking documents.
    expect(mockRanHandlers).not.toContain('bookings:expire-stale-holds')
  })

  it('still runs the platform core job while a plugin is dark', async () => {
    await runJobs()

    // A kill switch for one plugin is not an outage for the scheduler. `core`
    // is not a first-party plugin id, so it is never subtracted.
    expect(mockRanHandlers).toContain('core:apply-publish-schedules')
  })

  it('names the held job rather than silently omitting it', async () => {
    const body = (await runJobs().then((response) => response.json())) as {
      registered: string[]
      ran: Array<{ key: string }>
      heldByReleaseFlag: string[]
    }

    // Without this a flag-held job is indistinguishable from one that was not
    // due: nothing runs, nothing errors, the beat answers 200 forever.
    expect(body.heldByReleaseFlag).toContain('bookings:expire-stale-holds')
    expect(body.ran.map((result) => result.key)).not.toContain(
      'bookings:expire-stale-holds',
    )
    // Still REGISTERED — the registry is what the deployment has loaded, and
    // hiding a held job from it would make the flag look like a missing plugin.
    expect(body.registered).toContain('bookings:expire-stale-holds')
  })

  it('runs the plugin job again once the flag is back on', async () => {
    mockFlagOn = true

    const response = await runJobs()
    const body = (await response.json()) as { heldByReleaseFlag: string[] }

    expect(mockRanHandlers).toContain('bookings:expire-stale-holds')
    expect(body.heldByReleaseFlag).toEqual([])
  })

  it('gates before authentication is bypassed, not after', async () => {
    const response = await POST(
      new Request('https://site.aglyn.app/api/plugins/run-jobs', {
        method: 'POST',
        headers: { 'x-plugin-jobs-secret': 'wrong' },
      }),
    )

    // Guards the ordering the fix relies on: the release gate was added after
    // the secret check, so a wrong secret must still cost nothing and run
    // nothing.
    expect(response.status).toBe(401)
    expect(mockRanHandlers).toEqual([])
  })
})
