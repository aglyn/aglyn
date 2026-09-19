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

import { cronJobsHealth, SCHEDULED_JOBS } from '../app-utils/health-report'
import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  listPluginConsoleCrons,
  PLUGIN_CONSOLE_CRON_GRACE_MINUTES,
  PLUGIN_CONSOLE_CRON_SCHEDULE,
  PLUGIN_CONSOLE_CRONS_JOB_ID,
  PLUGIN_CONSOLE_CRONS_ROUTE,
  pluginConsoleCronScheduledJobs,
  registerPluginConsoleCron,
  resetPluginConsoleCronsForTests,
  runPluginConsoleCrons,
  type PluginConsoleCronJob,
} from './plugin-console-crons'

const DRIVES = 'Sends the mail this plugin schedules; if it stops, nothing it schedules is sent.'

function job(id: string, run: PluginConsoleCronJob['run'] = async () => ({ ok: true })): PluginConsoleCronJob {
  return { id, label: `Job ${id}`, drives: DRIVES, run }
}

const NOW = Date.UTC(2026, 8, 18, 12, 0)

beforeEach(() => {
  resetPluginConsoleCronsForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('plugin console jobs (AGL-2981)', () => {
  it('declares a job under the plugin whose register fn is running, or the one named', () => {
    setRegisteringPluginId('acme-mail')
    registerPluginConsoleCron(job('acme-mail-sync'))
    setRegisteringPluginId(undefined)
    registerPluginConsoleCron(job('backups-sweep'), { pluginId: 'backups' })

    expect(listPluginConsoleCrons()).toEqual([
      { pluginId: 'acme-mail', id: 'acme-mail-sync', label: 'Job acme-mail-sync', drives: DRIVES },
      { pluginId: 'backups', id: 'backups-sweep', label: 'Job backups-sweep', drives: DRIVES },
    ])
  })

  it('refuses a job with no owner, an id that is not the plugin’s own, or one that is incomplete', () => {
    expect(() => registerPluginConsoleCron(job('acme-mail-sync'))).toThrow(/no owner/)
    expect(() => registerPluginConsoleCron(job('sync'), { pluginId: 'acme-mail' })).toThrow(/id of its own/)
    expect(() => registerPluginConsoleCron(job('acme-mail-'), { pluginId: 'acme-mail' })).toThrow(/id of its own/)
    expect(() => registerPluginConsoleCron(job('acme-mail-Sync'), { pluginId: 'acme-mail' })).toThrow(/id of its own/)
    expect(() =>
      registerPluginConsoleCron({ ...job('acme-mail-sync'), drives: ' ' }, { pluginId: 'acme-mail' }),
    ).toThrow(/what it drives/)
  })

  it('refuses a platform job’s id, whichever plugin claims it', () => {
    // `ai-jobs-beat` is on the platform's inventory; the AI plugin may not
    // declare a second job under it.
    expect(SCHEDULED_JOBS.some((row) => row.id === 'ai-jobs-beat')).toBe(true)
    expect(() => registerPluginConsoleCron(job('ai-jobs-beat'), { pluginId: 'ai' })).toThrow(/platform job/)
  })

  it('refuses a second plugin’s job under a taken id and replaces the same plugin’s in place', async () => {
    registerPluginConsoleCron(job('acme-mail-sync', async () => ({ run: 1 })), { pluginId: 'acme-mail' })
    registerPluginConsoleCron(job('acme-other'), { pluginId: 'acme' })
    // `acme` owns the `acme-` prefix, and `acme-mail-sync` starts with it too:
    // the id is still acme-mail's.
    expect(() => registerPluginConsoleCron(job('acme-mail-sync'), { pluginId: 'acme' })).toThrow(
      /already declared by "acme-mail"/,
    )
    registerPluginConsoleCron(job('acme-mail-sync', async () => ({ run: 2 })), { pluginId: 'acme-mail' })

    expect(listPluginConsoleCrons().map((entry) => entry.id)).toEqual(['acme-mail-sync', 'acme-other'])
    const reports = await runPluginConsoleCrons({ nowMs: NOW, deadlineMs: NOW + 1000, beat: async () => true })
    expect(reports['acme-mail-sync']).toEqual({ run: 2 })
  })

  it('stamps each job’s beat BEFORE its work, and hands it the tick and the deadline', async () => {
    const order: string[] = []
    registerPluginConsoleCron(
      job('acme-mail-send', async (context) => {
        order.push(`run:${context.nowMs}:${context.deadlineMs}`)
        return { sent: 3 }
      }),
      { pluginId: 'acme-mail' },
    )
    const reports = await runPluginConsoleCrons({
      nowMs: NOW,
      deadlineMs: NOW + 5000,
      beat: async (jobId, atMs) => {
        order.push(`beat:${jobId}:${atMs}`)
      },
    })
    expect(order).toEqual([`beat:acme-mail-send:${NOW}`, `run:${NOW}:${NOW + 5000}`])
    expect(reports).toEqual({ 'acme-mail-send': { sent: 3 } })
  })

  it('records a job that throws as null, logs it against its plugin, and runs the others', async () => {
    registerPluginConsoleCron(
      job('acme-mail-sync', async () => {
        throw new Error('provider down')
      }),
      { pluginId: 'acme-mail' },
    )
    registerPluginConsoleCron(job('backups-sweep', async () => ({ swept: 0 })), { pluginId: 'backups' })
    const beats: string[] = []

    const reports = await runPluginConsoleCrons({
      nowMs: NOW,
      deadlineMs: NOW + 1000,
      beat: async (jobId) => void beats.push(jobId),
    })

    expect(reports).toEqual({ 'acme-mail-sync': null, 'backups-sweep': { swept: 0 } })
    // A job that throws was still scheduled: its beat is stamped.
    expect(beats.sort()).toEqual(['acme-mail-sync', 'backups-sweep'])
    expect(console.error).toHaveBeenCalledWith(
      '[plugins] acme-mail console job acme-mail-sync failed',
      expect.any(Error),
    )
  })

  it('still runs a job whose beat could not be written', async () => {
    registerPluginConsoleCron(job('acme-mail-sync', async () => ({ ran: true })), { pluginId: 'acme-mail' })
    const reports = await runPluginConsoleCrons({
      nowMs: NOW,
      deadlineMs: NOW + 1000,
      beat: async () => {
        throw new Error('beats unwritable')
      },
    })
    expect(reports).toEqual({ 'acme-mail-sync': { ran: true } })
  })

  it('runs only the jobs named, for a manual re-run of one', async () => {
    const send = jest.fn(async () => ({ sent: 1 }))
    const sync = jest.fn(async () => ({ read: 1 }))
    registerPluginConsoleCron(job('acme-mail-send', send), { pluginId: 'acme-mail' })
    registerPluginConsoleCron(job('acme-mail-sync', sync), { pluginId: 'acme-mail' })

    const reports = await runPluginConsoleCrons({
      nowMs: NOW,
      deadlineMs: NOW + 1000,
      jobIds: ['acme-mail-sync'],
      beat: async () => true,
    })

    expect(reports).toEqual({ 'acme-mail-sync': { read: 1 } })
    expect(send).not.toHaveBeenCalled()
  })

  it('answers every job in declaration order, whichever finished first', async () => {
    registerPluginConsoleCron(
      job('acme-mail-slow', () => new Promise((resolve) => setTimeout(() => resolve({ slow: true }), 20))),
      { pluginId: 'acme-mail' },
    )
    registerPluginConsoleCron(job('acme-mail-fast', async () => ({ fast: true })), { pluginId: 'acme-mail' })
    const reports = await runPluginConsoleCrons({ nowMs: NOW, deadlineMs: NOW + 1000, beat: async () => true })
    expect(Object.keys(reports)).toEqual(['acme-mail-slow', 'acme-mail-fast'])
  })

  describe('on the health board', () => {
    it('gives each job a row on the fifteen-minute tick the runner route is posted on', () => {
      registerPluginConsoleCron(job('acme-mail-sync'), { pluginId: 'acme-mail' })
      expect(pluginConsoleCronScheduledJobs()).toEqual([
        {
          id: 'acme-mail-sync',
          label: 'Job acme-mail-sync',
          cron: PLUGIN_CONSOLE_CRON_SCHEDULE,
          runner: 'cloud-scheduler',
          target: `consoleFastCrons → console ${PLUGIN_CONSOLE_CRONS_ROUTE} (acme-mail)`,
          graceMinutes: PLUGIN_CONSOLE_CRON_GRACE_MINUTES,
          drives: DRIVES,
        },
      ])
      // The same tick and grace as the runner's own platform row.
      const runner = SCHEDULED_JOBS.find((row) => row.id === PLUGIN_CONSOLE_CRONS_JOB_ID)
      expect(runner?.cron).toBe(PLUGIN_CONSOLE_CRON_SCHEDULE)
      expect(runner?.graceMinutes).toBe(PLUGIN_CONSOLE_CRON_GRACE_MINUTES)
      expect(runner?.target).toContain(PLUGIN_CONSOLE_CRONS_ROUTE)
    })

    it('reads a declared job that stopped reporting as silent, and one that reported as healthy', () => {
      registerPluginConsoleCron(job('acme-mail-sync'), { pluginId: 'acme-mail' })
      registerPluginConsoleCron(job('acme-mail-send'), { pluginId: 'acme-mail' })
      const now = Date.UTC(2026, 8, 18, 12, 7)
      const checks = cronJobsHealth(
        [
          { jobId: 'acme-mail-sync', atMs: now - 3 * 60 * 60_000 },
          { jobId: 'acme-mail-send', atMs: now - 5 * 60_000 },
        ],
        now - 30 * 24 * 60 * 60_000,
        1,
        now,
        pluginConsoleCronScheduledJobs(),
      )
      expect(checks['acme-mail-sync']).toMatchObject({ ok: false, code: 'job-silent' })
      expect(checks['acme-mail-send']).toMatchObject({ ok: true })
    })
  })
})
