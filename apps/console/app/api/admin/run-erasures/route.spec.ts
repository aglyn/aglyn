/**
 * @jest-environment node
 */

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
 * One org's failed erasure must not starve the rest of the batch (AGL-1455).
 *
 * The whole sweep sat inside a single `try`, so a throw from `eraseOrg` — and
 * every step after the export write can throw — exited the loop entirely and
 * answered 500. The orgs after it in the batch were never attempted, and
 * because `erasureRequestedAt` stays set on a failure, the same org led the
 * next run and starved them again. A GDPR erasure that never runs because a
 * different customer's erasure is broken is the amplifier, not the incident.
 *
 * The real handler with the real cron-auth check; only the I/O is faked.
 */

const mockEraseOrg = jest.fn()
const mockSendEmail = jest.fn(async () => undefined)

let mockDue: string[] = []

const mockOrgDoc = (id: string) => ({
  id,
  get: (field: string) => (field === 'name' ? `Workspace ${id}` : undefined),
  data: () => ({}),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  ERASURE_HOLD_MS: 7 * 24 * 60 * 60 * 1000,
  eraseOrg: (orgId: string) => mockEraseOrg(orgId),
  findUserByUidAcrossPools: async () => null,
  meterPlatformEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({}),
      firestore: () => ({
        collection: () => ({
          where: () => ({
            limit: () => ({
              get: async () => ({
                docs: mockDue.map(mockOrgDoc),
                size: mockDue.length,
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: (payload: unknown) => mockSendEmail(payload as never),
}))

jest.mock('../../_lib/render-system-email', () => ({
  renderSystemEmail: async () => null,
}))

const run = async () => {
  const { POST } = await import('./route')
  const response = await POST(
    new Request('https://console.test/api/admin/run-erasures', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret' },
    }),
  )
  return { status: response.status, payload: await response.json() }
}

describe('the erasure runner batch (AGL-1455)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    mockDue = []
  })

  it('THE DEFECT: a throw on one org still erases the rest of the batch', async () => {
    mockDue = ['org-a', 'org-b', 'org-c']
    mockEraseOrg.mockImplementation(async (orgId: string) => {
      if (orgId === 'org-a') throw new Error('recursiveDelete exploded')
      return { ok: true }
    })

    const { status, payload } = await run()

    // Every org attempted, not just the ones before the failure.
    expect(mockEraseOrg).toHaveBeenCalledTimes(3)
    expect(payload.erased).toEqual(['org-b', 'org-c'])
    expect(payload.skipped).toEqual([
      { orgId: 'org-a', reason: 'erase-failed' },
    ])
    // 200, because the run itself completed: the failed org's durable record
    // is the `org.erase-failed` audit row `eraseOrg` writes, not this body.
    expect(status).toBe(200)
  })

  it('reports a skipped org without stopping the batch', async () => {
    mockDue = ['org-a', 'org-b']
    mockEraseOrg.mockImplementation(async (orgId: string) =>
      orgId === 'org-a'
        ? { ok: false, skippedReason: 'export-failed' }
        : { ok: true },
    )

    const { status, payload } = await run()

    expect(status).toBe(200)
    expect(payload.erased).toEqual(['org-b'])
    expect(payload.skipped).toEqual([
      { orgId: 'org-a', reason: 'export-failed' },
    ])
    expect(payload.scanned).toBe(2)
  })
})
