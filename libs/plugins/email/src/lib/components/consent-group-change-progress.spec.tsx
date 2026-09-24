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
 *
 * @jest-environment jsdom
 */

/**
 * A consent group change while it runs (AGL-3320): each phase says what it
 * means for the reader; the page asks for the next slice whenever nobody else
 * holds the job, never faster than the least gap and never before the sweep
 * may run; only the first phase can be stopped; a stall shows its reason and
 * Retry now instead of retrying on its own; and a reader who may not drive the
 * change opens no read of the job at all.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ConsentGroupChangeMarker } from './consent-groups-api'

const NOW = 1_000_000

/** The job document as the listener delivers it. */
let mockJob: { status: string; data?: Record<string, unknown> } = { status: 'success', data: {} }
/** Every path the component built a document reference for (`null` when none). */
const mockRefs: Array<string | null> = []

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: (buildRef: () => { path: string } | null) => {
    const ref = buildRef()
    mockRefs.push(ref ? ref.path : null)
    return ref ? mockJob : { data: undefined, status: 'loading' }
  },
}))

/** What the route answers, by action. */
let mockAnswers: Record<string, { status: number; body: unknown }> = {}
const mockAuthorizedFetch = jest.fn(async (_user: unknown, _url: string, init: RequestInit) => {
  const action = JSON.parse(String(init.body)).action as string
  const answer = mockAnswers[action] ?? { status: 500, body: {} }
  return {
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    json: async () => answer.body,
  }
})
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: [unknown, string, RequestInit]) => mockAuthorizedFetch(...args),
}))

let mockConfirmAccepts = true
const mockConfirm = jest.fn(() =>
  mockConfirmAccepts ? Promise.resolve(undefined) : Promise.reject(new Error('canceled')),
)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

import ConsentGroupChangeProgress, {
  CONSENT_GROUP_CONTINUE_GAP_MS,
  CONSENT_GROUP_PHASE_TEXT,
} from './consent-group-change-progress'

const onFinished = jest.fn()

const marker = (patch: Partial<ConsentGroupChangeMarker> = {}): ConsentGroupChangeMarker => ({
  changeId: 'chg_1',
  phase: 'carry',
  hostIds: ['shop', 'blog'],
  startedAtMs: NOW - 1_000,
  ...patch,
})

function renderProgress(
  patch: Partial<ConsentGroupChangeMarker> = {},
  canDrive = true,
) {
  return render(
    <ConsentGroupChangeProgress
      orgId="org-1"
      changeId="chg_1"
      marker={marker(patch)}
      canDrive={canDrive}
      onFinished={onFinished}
    />,
  )
}

/** Moves the clock and lets every answer that came due settle. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const continues = () =>
  mockAuthorizedFetch.mock.calls.filter(
    (call) => JSON.parse(String(call[2].body)).action === 'continue',
  )

const RUNNING = { status: 200, body: { ok: true, changeId: 'chg_1', phase: 'carry', done: false } }

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  jest.clearAllMocks()
  mockRefs.length = 0
  mockJob = { status: 'success', data: { phase: 'carry' } }
  mockAnswers = { continue: RUNNING }
  mockConfirmAccepts = true
})

afterEach(() => {
  jest.useRealTimers()
})

describe('what each phase says', () => {
  it('before the flip: nothing has changed yet, and it can be stopped', () => {
    renderProgress({ phase: 'carry' })
    expect(screen.getByText(CONSENT_GROUP_PHASE_TEXT.carry.title)).toBeTruthy()
    expect(screen.getByText('Copying opt-outs — nothing has changed yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop before it takes effect' })).toBeTruthy()
  })

  it('after the flip: in effect, and no longer stoppable', () => {
    renderProgress({ phase: 'rehome', declaredAtMs: NOW })
    expect(screen.getByText('In effect — combining CRM records')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop before it takes effect' })).toBeNull()
  })

  it('the sweep: finishing up', () => {
    renderProgress({ phase: 'sweep', declaredAtMs: NOW })
    expect(screen.getByText('Finishing up')).toBeTruthy()
  })
})

describe('driving the change', () => {
  it('asks for the next slice at once when nobody holds the job', async () => {
    renderProgress()
    expect(mockRefs).toContain('orgs/org-1/consentGroupChanges/chg_1')
    await advance(0)
    expect(continues()).toHaveLength(1)
    expect(mockAuthorizedFetch.mock.calls[0][1]).toBe('/api/orgs/consent-groups')
    expect(JSON.parse(String(mockAuthorizedFetch.mock.calls[0][2].body))).toEqual({
      orgId: 'org-1',
      action: 'continue',
      changeId: 'chg_1',
    })
  })

  it('never asks again sooner than the least gap', async () => {
    renderProgress()
    await advance(0)
    expect(continues()).toHaveLength(1)
    await advance(CONSENT_GROUP_CONTINUE_GAP_MS - 100)
    expect(continues()).toHaveLength(1)
    await advance(200)
    expect(continues()).toHaveLength(2)
  })

  it('waits out a lease another runner holds', async () => {
    mockJob = {
      status: 'success',
      data: { phase: 'carry', lease: { owner: 'cron', untilMs: NOW + 20_000 } },
    }
    renderProgress()
    await advance(15_000)
    expect(continues()).toHaveLength(0)
    await advance(7_000)
    expect(continues()).toHaveLength(1)
  })

  it('does not ask for the sweep before the delay after the flip has passed', async () => {
    renderProgress({ phase: 'sweep', declaredAtMs: NOW })
    await advance(5 * 60_000)
    expect(continues()).toHaveLength(0)
    await advance(60_000 + 10)
    expect(continues()).toHaveLength(1)
  })

  it('waits for the job document before it asks', async () => {
    mockJob = { status: 'loading' }
    renderProgress()
    await advance(10_000)
    expect(continues()).toHaveLength(0)
  })

  it('hands back the end when the route says it is done', async () => {
    mockAnswers.continue = {
      status: 200,
      body: { ok: true, changeId: 'chg_1', phase: 'done', done: true },
    }
    renderProgress()
    await advance(0)
    expect(onFinished).toHaveBeenCalledWith('done')
    await advance(60_000)
    expect(continues()).toHaveLength(1)
  })

  it('notices an end it did not cause — the cron, or another tab', () => {
    mockJob = { status: 'success', data: { phase: 'done', finishedAtMs: NOW } }
    renderProgress()
    expect(onFinished).toHaveBeenCalledWith('done')
  })

  it('reads a job stopped elsewhere as stopped', () => {
    mockJob = { status: 'success', data: { phase: 'canceled' } }
    renderProgress()
    expect(onFinished).toHaveBeenCalledWith('canceled')
  })
})

describe('a stall', () => {
  it('shows its reason and Retry now, and stops asking on its own', async () => {
    mockJob = {
      status: 'success',
      data: { phase: 'rehome', stalled: true, failures: 5, lastError: 'Deadline exceeded' },
    }
    renderProgress({ phase: 'rehome', declaredAtMs: NOW })
    expect(
      screen.getByText(
        'This change stopped after repeated errors: Deadline exceeded It keeps trying on its own every 15 minutes, or you can retry now.',
      ),
    ).toBeTruthy()
    await advance(60_000)
    expect(continues()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await advance(0)
    expect(continues()).toHaveLength(1)
  })

  it('a refused call halts this page and says why', async () => {
    mockAnswers.continue = { status: 423, body: { error: 'locked', title: 'Paused', message: 'Changes are paused.' } }
    renderProgress()
    await advance(0)
    expect(screen.getByText(/Changes are paused\./)).toBeTruthy()
    await advance(60_000)
    expect(continues()).toHaveLength(1)
    mockAnswers.continue = RUNNING
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await advance(0)
    expect(continues()).toHaveLength(2)
  })
})

describe('stopping', () => {
  it('stops before it takes effect, after asking', async () => {
    mockAnswers.cancel = { status: 200, body: { ok: true } }
    renderProgress()
    fireEvent.click(screen.getByRole('button', { name: 'Stop before it takes effect' }))
    await advance(0)
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stop this change?', confirmationText: 'Stop the change' }),
    )
    const cancel = mockAuthorizedFetch.mock.calls
      .map((call) => JSON.parse(String(call[2].body)))
      .find((body) => body.action === 'cancel')
    expect(cancel).toEqual({ orgId: 'org-1', action: 'cancel', changeId: 'chg_1' })
    expect(onFinished).toHaveBeenCalledWith('canceled')
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'Stopped. Your consent groups are unchanged.',
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('does nothing when the admin keeps it going', async () => {
    mockConfirmAccepts = false
    renderProgress()
    fireEvent.click(screen.getByRole('button', { name: 'Stop before it takes effect' }))
    await advance(0)
    expect(
      mockAuthorizedFetch.mock.calls.some(
        (call) => JSON.parse(String(call[2].body)).action === 'cancel',
      ),
    ).toBe(false)
  })

  it('says so when the stop came too late', async () => {
    mockAnswers.cancel = { status: 409, body: { error: 'Already declared', phase: 'rehome' } }
    renderProgress()
    fireEvent.click(screen.getByRole('button', { name: 'Stop before it takes effect' }))
    await advance(0)
    expect(onFinished).not.toHaveBeenCalled()
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'This change already took effect, so it can’t be stopped now. It will finish on its own.',
      expect.objectContaining({ variant: 'info' }),
    )
  })
})

describe('a reader who may not drive it', () => {
  it('sees where it is, reads no job, calls nothing and cannot stop it', async () => {
    renderProgress({ phase: 'carry' }, false)
    expect(mockRefs.every((path) => path === null)).toBe(true)
    await advance(60_000)
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    expect(screen.getByText('Copying opt-outs — nothing has changed yet')).toBeTruthy()
    expect(
      screen.getByText(
        'It finishes on its own. Only members who can change consent groups can stop it.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop before it takes effect' })).toBeNull()
  })
})
