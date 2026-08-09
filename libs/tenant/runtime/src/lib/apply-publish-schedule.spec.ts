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
 * AGL-1185 — a due schedule refused for lack of entitlement must be RECORDED,
 * not left pending.
 *
 * The refusal was always correct; what was missing is that it left no trace, so
 * the schedule stayed permanently due and the next beat published it the moment
 * the org upgraded to Business.
 *
 * The case that would be worst to get wrong is the opposite one: marking a
 * schedule that is not due yet. That would cancel a legitimate future publish
 * on any org that happens to be unentitled at the moment a beat runs, and it
 * would look like the feature quietly not working.
 */

// Declares the update payload it is called with, so the cases below can read
// `call[0]` — a zero-arg stub types `mock.calls` as `[][]` (AGL-1323).
const updateMock = jest.fn(async (_data?: Record<string, unknown>) => undefined)
let entitled = true

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({ doc: () => ({ update: updateMock }) }),
            update: updateMock,
            collection_: undefined,
          }),
        }),
      }),
    }),
  },
  getOrgForHost: jest.fn(async () => ({ org: {} })),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: () => entitled,
}))

import { applyDuePublishSchedule } from './apply-publish-schedule'

const schedule = (overrides: Record<string, unknown> = {}) => ({
  versionId: 'v-scheduled',
  action: 'publish' as const,
  // Due an hour ago unless a case says otherwise.
  publishAt: { seconds: Math.floor(Date.now() / 1000) - 3600 },
  status: 'pending' as const,
  ...overrides,
})

const run = (parent: Record<string, unknown>) =>
  applyDuePublishSchedule({
    hostId: 'h1' as never,
    collectionName: 'screens',
    docId: 'screen-1',
    parent: parent as never,
  })

beforeEach(() => {
  updateMock.mockClear()
  entitled = true
})

describe('a due schedule on an unentitled plan (AGL-1185)', () => {
  beforeEach(() => {
    entitled = false
  })

  it('records the refusal instead of leaving it pending', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })
    expect(updateMock).toHaveBeenCalledWith({
      'publishSchedule.status': 'skipped-unentitled',
    })
  })

  it('still refuses to publish', async () => {
    // The entitlement check is the authority and this must not weaken it: the
    // live pointer stays where it was.
    const result = await run({
      versionId: 'v-live',
      publishSchedule: schedule(),
    })
    expect(result).toBe('v-live')
  })

  it('never flips the version pointer as a side effect of marking', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })
    for (const call of updateMock.mock.calls) {
      expect(call[0]).not.toHaveProperty('versionId')
    }
  })

  it('does NOT touch a schedule that is not due yet', async () => {
    // The guard that matters most. Marking a future schedule would cancel a
    // legitimate publish and read as the feature silently not working.
    const future = schedule({
      publishAt: { seconds: Math.floor(Date.now() / 1000) + 3600 },
    })
    const result = await run({ versionId: 'v-live', publishSchedule: future })
    expect(updateMock).not.toHaveBeenCalled()
    expect(result).toBe('v-live')
  })

  it('does not reconsider one it has already skipped', async () => {
    // Terminal by design — upgrading must not resurrect a stale publish.
    await run({
      versionId: 'v-live',
      publishSchedule: schedule({ status: 'skipped-unentitled' }),
    })
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('a due schedule on an entitled plan', () => {
  it('still publishes — the refusal path must not have broken the happy one', async () => {
    const result = await run({
      versionId: 'v-live',
      publishSchedule: schedule(),
    })
    expect(result).toBe('v-scheduled')
    expect(updateMock).toHaveBeenCalledWith({
      versionId: 'v-scheduled',
      'publishSchedule.status': 'applied',
    })
  })

  it('never writes the skipped status', async () => {
    await run({ versionId: 'v-live', publishSchedule: schedule() })
    for (const call of updateMock.mock.calls) {
      expect(call[0]).not.toEqual({
        'publishSchedule.status': 'skipped-unentitled',
      })
    }
  })
})
