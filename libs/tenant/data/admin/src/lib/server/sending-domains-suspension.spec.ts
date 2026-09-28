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
 * A suspended site sends nothing (AGL-3356).
 *
 * `hostSendingIdentity` is the door every tenant sender but the campaign core
 * resolves its `From:` through — workflow steps, the CRM's one-off mail,
 * inbox replies, receipts, reminders. The incident behind this was a locked
 * workspace whose event-triggered workflow could still mail for it, so the
 * statement under test is: a FULL lock on the site, its workspace or the
 * platform turns the identity into a refusal, and `sendEmail` reports that
 * refusal as `suspended` without calling the provider.
 *
 * Firestore is faked to answer any path, so a new read cannot fall through a
 * throwing mock into the verdict's fail-open catch and keep this suite green
 * while the gate stops gating.
 */

type Doc = Record<string, unknown>

const hosts = new Map<string, Doc>()
const orgs = new Map<string, Doc>()
let platformDoc: Doc | undefined

function snapshot(data: Doc | undefined) {
  return {
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      async get() {
        if (name === 'hosts') return snapshot(hosts.get(id))
        if (name === 'lockdowns' && id === 'platform') return snapshot(platformDoc)
        return snapshot(undefined)
      },
      collection: () => ({
        doc: () => ({ get: async () => snapshot(undefined) }),
      }),
    }),
  }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => db }),
    firestore: { FieldValue: { delete: () => '<delete>' } },
  },
}))

jest.mock('./dns-probe', () => ({
  __esModule: true,
  lookupTxt: async () => ({ answered: true, records: [] }),
  lookupMx: async () => ({ answered: true, records: [] }),
  lookupCaa: async () => ({ answered: true, records: [] }),
}))

jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgForHost: async (hostId: string) => {
    const org = orgs.get(hostId)
    return org ? { orgId: `org-${hostId}`, org } : null
  },
  getHostDocAdmin: async (hostId: string) => hosts.get(hostId) ?? null,
}))

import { sendEmail } from '@aglyn/shared-util-email'
import {
  invalidatePlatformLockdownCache,
  resetTakedownLedger,
} from './lockdown'
import { hostSendingIdentity } from './sending-domains'

const HOST = 'host-1'
const ENV = { ...process.env }

beforeEach(() => {
  hosts.clear()
  orgs.clear()
  platformDoc = undefined
  invalidatePlatformLockdownCache()
  resetTakedownLedger()
  process.env = {
    ...ENV,
    RESEND_API_KEY: 're_test',
    USAGE_EMAIL_FROM: 'Aglyn <noreply@aglyn.com>',
  }
  hosts.set(HOST, { subdomain: 'acme' })
  orgs.set(HOST, { name: 'Acme' })
})

afterAll(() => {
  process.env = ENV
})

describe('hostSendingIdentity under a lockdown', () => {
  it('refuses when the WORKSPACE is suspended', async () => {
    orgs.set(HOST, {
      name: 'Acme',
      suspendedAt: { seconds: 1 },
      suspendedReasonCode: 'security',
    })
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.refusal?.code).toBe('workspace-suspended')
    expect(verdict.from).toBeNull()
    expect(verdict.summary).toContain('workspace is suspended')
  })

  it('refuses when the SITE is suspended', async () => {
    hosts.set(HOST, { subdomain: 'acme', suspendedAt: { seconds: 1 } })
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.refusal?.code).toBe('workspace-suspended')
    expect(verdict.summary).toContain('site is suspended')
  })

  it('refuses under a platform-wide lockdown', async () => {
    platformDoc = { active: true, reason: 'security', atMs: 1 }
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.refusal?.code).toBe('workspace-suspended')
  })

  it('keeps sending through a READ-ONLY maintenance lock', async () => {
    orgs.set(HOST, {
      name: 'Acme',
      suspendedAt: { seconds: 1 },
      suspendedReasonCode: 'maintenance',
      suspendedMode: 'read-only',
    })
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.refusal?.code).not.toBe('workspace-suspended')
  })

  it('ignores a suspension that has already expired', async () => {
    hosts.set(HOST, {
      subdomain: 'acme',
      suspendedAt: { seconds: 1 },
      suspendedUntilMs: Date.now() - 1_000,
    })
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.refusal?.code).not.toBe('workspace-suspended')
  })

  it('remembers the refusal in a per-run cache', async () => {
    hosts.set(HOST, { subdomain: 'acme', suspendedAt: { seconds: 1 } })
    const cache = new Map()
    await hostSendingIdentity(HOST, cache)
    expect(cache.get(HOST)?.refusal?.code).toBe('workspace-suspended')
  })
})

describe('sendEmail with a suspended identity', () => {
  it('answers `suspended` and never calls the provider', async () => {
    orgs.set(HOST, { name: 'Acme', suspendedAt: { seconds: 1 } })
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      const result = await sendEmail({
        to: 'guest@example.com',
        subject: 'Poshmark Order',
        text: 'one of the items from your Seller Account has finally sold',
        sendingIdentity: await hostSendingIdentity(HOST),
        audience: 'tenant',
        context: 'event action',
      })
      expect(result).toMatchObject({ sent: false, reason: 'suspended' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
