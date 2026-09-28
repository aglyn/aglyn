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
 * AGL-3330: the submit path's per-form counter write is retried, and a
 * failure is REPORTED rather than swallowed.
 *
 * The write used to sit in a `catch` that logged one line, so a form whose
 * increment failed simply read short forever with nothing saying so. The
 * submission itself must still never fail over it — a 500 is a retry
 * invitation, and the retry would store the submission twice.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}))

import { incrementFormStats } from '../utils/increment-form-stats'

function formRef(failures: unknown[]) {
  const updates: Record<string, unknown>[] = []
  return {
    updates,
    ref: {
      id: 'form-1',
      update: async (patch: Record<string, unknown>) => {
        const failure = failures.shift()
        if (failure) throw failure
        updates.push(patch)
      },
    } as unknown as FirebaseFirestore.DocumentReference,
  }
}

const base = { hostId: 'host-1', monthKey: '2026-09', submittedAtMs: 1_000, backoffMs: 0 }

describe('incrementFormStats (AGL-3330)', () => {
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('writes every counter, the month and the lead, in one update', async () => {
    const { ref, updates } = formRef([])
    const report = jest.fn(async () => undefined)
    await expect(
      incrementFormStats({ ...base, formRef: ref, leadCounted: true, report }),
    ).resolves.toBe('written')
    expect(updates).toEqual([
      {
        'stats.submissions': { __increment: 1 },
        'stats.lastSubmissionAtMs': 1_000,
        'stats.periods.2026-09.submissions': { __increment: 1 },
        'stats.leads': { __increment: 1 },
        'stats.periods.2026-09.leads': { __increment: 1 },
      },
    ])
    expect(report).not.toHaveBeenCalled()
  })

  it('moves no lead counter when the capture filed nobody new', async () => {
    const { ref, updates } = formRef([])
    await incrementFormStats({ ...base, formRef: ref, leadCounted: false })
    expect(updates[0]).not.toHaveProperty('stats.leads')
    expect(updates[0]).not.toHaveProperty('stats.periods.2026-09.leads')
  })

  it('retries a transient failure and lands the write', async () => {
    const { ref, updates } = formRef([Object.assign(new Error('ABORTED'), { code: 10 })])
    const report = jest.fn(async () => undefined)
    await expect(
      incrementFormStats({ ...base, formRef: ref, leadCounted: false, report }),
    ).resolves.toBe('written')
    expect(updates).toHaveLength(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports a write that keeps failing, naming the site and the form, and never throws', async () => {
    const deadline = Object.assign(new Error('DEADLINE_EXCEEDED'), { code: 4 })
    const { ref, updates } = formRef([deadline, deadline, deadline])
    const report = jest.fn(async () => undefined)
    await expect(
      incrementFormStats({ ...base, formRef: ref, leadCounted: true, report }),
    ).resolves.toBe('failed')
    expect(updates).toHaveLength(0)
    expect(report).toHaveBeenCalledTimes(1)
    const [event] = report.mock.calls[0] as unknown as [{ message: string; route: string }]
    expect(event.route).toBe('/api/forms/submit')
    expect(event.message).toContain('host-1')
    expect(event.message).toContain('form-1')
    expect(event.message).toContain('code 4')
  })

  it('treats a deleted form as nothing to count, without a report', async () => {
    const gone = Object.assign(new Error('5 NOT_FOUND: No document to update'), { code: 5 })
    const { ref } = formRef([gone])
    const report = jest.fn(async () => undefined)
    await expect(
      incrementFormStats({ ...base, formRef: ref, leadCounted: true, report }),
    ).resolves.toBe('form-gone')
    expect(report).not.toHaveBeenCalled()
  })

  it('survives a reporter that itself throws', async () => {
    const { ref } = formRef([new Error('x'), new Error('x'), new Error('x')])
    const report = jest.fn(async () => {
      throw new Error('logging down')
    })
    await expect(
      incrementFormStats({ ...base, formRef: ref, leadCounted: false, report }),
    ).resolves.toBe('failed')
  })
})
