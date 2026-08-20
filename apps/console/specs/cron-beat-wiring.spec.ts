/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored.
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
 * AGL-1955 — is the WRITING half actually wired?
 *
 * `/api/health/crons` reads marks. A job that never leaves one reads as
 * silent, so the endpoint is loud rather than blind if a call site is
 * missing — but it is loud in PRODUCTION, days later, and it looks exactly
 * like the failure it exists to report. That is a bad way to find out you
 * forgot a line.
 *
 * `recordCronBeat` also swallows everything by design (a monitor must not be
 * able to take down the job it describes), which means an absent or broken
 * call site cannot fail any of the route specs. So the wiring is asserted
 * here, twice and from two directions:
 *
 *   1. `recordCronBeat` really writes the document the reader really reads —
 *      the shared server barrel is NOT mocked, so a rename on either side
 *      fails this.
 *   2. Every job in the inventory has a call site somewhere in the tree.
 *      This is the one that fails when a route is added to the workflow and
 *      the beat is forgotten.
 */
import { CRON_BEAT_COLLECTION, SCHEDULED_JOBS } from '@aglyn/aglyn/server'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockSets: Array<{ collection: string; doc: string; data: unknown }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (collection: string) => ({
          doc: (doc: string) => ({
            set: async (data: unknown) => {
              mockSets.push({ collection, doc, data })
            },
          }),
        }),
      }),
    }),
  },
}))

describe('the beat a scheduled run leaves (AGL-1955)', () => {
  beforeEach(() => {
    mockSets.length = 0
  })

  it('writes the document /api/health/crons reads', async () => {
    const { recordCronBeat } = await import('../utils/cron-beat')
    await recordCronBeat('audit-archive')
    expect(mockSets).toHaveLength(1)
    expect(mockSets[0].collection).toBe(CRON_BEAT_COLLECTION)
    expect(mockSets[0].doc).toBe('audit-archive')
    expect(mockSets[0].data).toMatchObject({
      jobId: 'audit-archive',
      atMs: expect.any(Number),
    })
  })

  it('cannot take down the job it is describing', async () => {
    jest.resetModules()
    jest.doMock('@aglyn/tenant-data-admin', () => ({
      __esModule: true,
      firebaseAdmin: {
        app: () => {
          throw new Error('no admin app here')
        },
      },
    }))
    const { recordCronBeat } = await import('../utils/cron-beat')
    await expect(recordCronBeat('audit-archive')).resolves.toBeUndefined()
    jest.dontMock('@aglyn/tenant-data-admin')
    jest.resetModules()
  })

  it('has a call site for EVERY job in the inventory', () => {
    /*==========================================
     * A source scan, because there is nothing else that can catch this.
     *
     * The failure is a route added to `scheduled-crons.yml` and to
     * `SCHEDULED_JOBS` whose handler never stamps. The health check then
     * reports that job as silent forever — an alarm that is right about
     * being unable to see the job and wrong about why, which is the most
     * expensive kind of red there is.
     *=========================================*/
    const repoRoot = join(__dirname, '..', '..', '..')
    // Two passes rather than one regex: the files that call a beat writer,
    // then the job ids quoted inside them. One pass cannot see
    // `report-usage`, whose id is chosen by a ternary on the line after the
    // call — and a scan that quietly misses a job is the same shape of hole
    // as a job that quietly misses its schedule.
    const files = execFileSync(
      'git',
      [
        'grep',
        '-l',
        '-E',
        'recordCronBeat|writeCronBeat',
        '--',
        'apps/console/app',
        'apps/console/utils',
        'apps/tenant/app',
        'libs/plugins',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
    const stamped = new Set<string>()
    for (const file of files) {
      const source = readFileSync(join(repoRoot, file), 'utf8')
      for (const match of source.matchAll(/'([a-z0-9-]+)'/g)) {
        stamped.add(match[1])
      }
    }
    // The scan itself must not be vacuous — a file list that came back empty
    // would make the assertion below pass for an entirely unwired tree.
    expect(files.length).toBeGreaterThanOrEqual(11)
    const unstamped = SCHEDULED_JOBS.map((job) => job.id).filter(
      (id) => !stamped.has(id),
    )
    expect(unstamped).toEqual([])
  })
})
