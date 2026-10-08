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
 * The jobs machine's listener (AGL-3593): each change it is told about
 * becomes one console notification, to the person who created the job and
 * to nobody else.
 */

jest.mock('@aglyn/tenant-data-admin/server/notifications', () => ({
  __esModule: true,
  notifyUsers: jest.fn(),
}))

jest.mock('@aglyn/tenant-data-admin/server/operator-alerts', () => ({
  __esModule: true,
  raiseOperatorAlert: jest.fn(),
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobTransitionListener: jest.fn(),
}))

import type { AiJob } from '../model/ai-jobs.types'
import { aiJobFailureAlerter, aiJobTransitionNotifier } from './ai-jobs-notify'

const job = (patch: Partial<AiJob> = {}) =>
  ({
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'needs_review',
    brief: 'A roofer',
    inputs: {},
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-creator',
    review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
    ...patch,
  }) as unknown as AiJob

describe('a guided site start (AGL-3594)', () => {
  it('is not asked to confirm a plan that is confirmed for it', async () => {
    const notify = jest.fn().mockResolvedValue(undefined)
    await aiJobTransitionNotifier(notify)({ job: job({ inputs: { autoConfirm: true } }), to: 'needs-review' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('opens the build page from a site job’s notice, and a page job still opens AI jobs', async () => {
    const notify = jest.fn().mockResolvedValue(undefined)
    await aiJobTransitionNotifier(notify)({ job: job({ status: 'done', review: null }), to: 'done' })
    expect(notify.mock.calls[0][1]).toMatchObject({ link: '/host-1/ai-jobs/job-1' })
    await aiJobTransitionNotifier(notify)({ job: job({ kind: 'page' }), to: 'needs-review' })
    expect(notify.mock.calls[1][1]).toMatchObject({ link: '/host-1?aiJob=job-1' })
  })
})

describe('aiJobTransitionNotifier', () => {
  it('tells the job’s creator, once, that the plan waits for them', async () => {
    const notify = jest.fn().mockResolvedValue(undefined)
    await aiJobTransitionNotifier(notify)({ job: job(), to: 'needs-review' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      ['uid-creator'],
      expect.objectContaining({
        type: 'content.aiJobNeedsYou',
        level: 'warning',
        title: 'Your site plan is ready: confirm it to build',
        orgId: 'org-1',
        hostId: 'host-1',
        link: '/host-1/ai-jobs/job-1',
      }),
    )
  })

  it('tells them when it finishes and when it stops', async () => {
    const notify = jest.fn().mockResolvedValue(undefined)
    const notifier = aiJobTransitionNotifier(notify)
    await notifier({ job: job({ status: 'done', review: null }), to: 'done' })
    await notifier({ job: job({ status: 'failed', review: null, error: 'It stopped.' }), to: 'failed' })
    expect(notify.mock.calls.map(([, payload]) => payload.type)).toEqual([
      'content.aiJobDone',
      'content.aiJobFailed',
    ])
  })

  it('tells nobody about a job with no creator', async () => {
    const notify = jest.fn()
    await aiJobTransitionNotifier(notify)({ job: job({ createdBy: '' }), to: 'done' })
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('aiJobFailureAlerter', () => {
  const failed = (patch: Partial<AiJob> = {}) =>
    job({ status: 'failed', review: null, error: 'It stopped.', steps: [{ name: 'plan' }, { name: 'site' }] as never, ...patch })

  it('tells staff when a job fails on our side, deduped per kind, with the runner’s own words', async () => {
    const raise = jest.fn().mockResolvedValue(undefined)
    await aiJobFailureAlerter(raise)({
      job: failed(),
      to: 'failed',
      failure: { ours: true, stepIndex: 1, error: 'upstream 529 overloaded' },
    })
    expect(raise).toHaveBeenCalledTimes(1)
    expect(raise.mock.calls[0][0]).toMatchObject({ type: 'ai.jobFailed' })
    expect(raise.mock.calls[0][1]).toEqual({
      dedupeKey: 'site',
      orgId: 'org-1',
      hostId: 'host-1',
      context: { kind: 'site', jobId: 'job-1', orgId: 'org-1', step: 'site', error: 'upstream 529 overloaded' },
    })
  })

  it('cuts a long error short; the log keeps the rest', async () => {
    const raise = jest.fn().mockResolvedValue(undefined)
    await aiJobFailureAlerter(raise)({
      job: failed(),
      to: 'failed',
      failure: { ours: true, stepIndex: null, error: 'x'.repeat(500) },
    })
    expect(raise.mock.calls[0][1].context).toMatchObject({ step: 'n/a', error: `${'x'.repeat(300)}…` })
  })

  it('raises nothing for a failure that is the customer’s, or for any other change', async () => {
    const raise = jest.fn()
    const alerter = aiJobFailureAlerter(raise)
    await alerter({ job: failed(), to: 'failed', failure: { ours: false, stepIndex: 1, error: 'stop_reason refusal' } })
    await alerter({ job: failed(), to: 'failed' })
    await alerter({ job: job({ status: 'done', review: null }), to: 'done' })
    expect(raise).not.toHaveBeenCalled()
  })
})
