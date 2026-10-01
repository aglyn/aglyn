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
 * A site's mail leaves under the site's own name (AGL-3442).
 *
 * `hostSendingIdentity` is the door every site sender resolves its `From:`
 * through, so it is where the name is decided: the business name the site's
 * emails render as `{{host.businessName}}`, else its display name, else the
 * org's branding default. `sendEmail` puts that name where a sender passed
 * the org default. Only the display name moves; the address stays the
 * identity's.
 *
 * Firestore is faked to answer any path, as in
 * `sending-domains-suspension.spec.ts`, so the verdict is the real one.
 */

type Doc = Record<string, unknown>

const hosts = new Map<string, Doc>()
const orgs = new Map<string, Doc>()

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

import { PLATFORM_BRANDING_PROFILE } from '@aglyn/aglyn/server'
import {
  resetEmailDeliverabilityPreflightForTests,
  resetOutboundScreenGateForTests,
  sendEmail,
} from '@aglyn/shared-util-email'
import {
  invalidatePlatformLockdownCache,
  resetTakedownLedger,
} from './lockdown'
import { hostSendingIdentity, siteSenderNames } from './sending-domains'

const HOST = 'host-1'
const ENV = { ...process.env }
const PLATFORM_NAME = PLATFORM_BRANDING_PROFILE.fromName

let requests: Array<Record<string, unknown>> = []
const originalFetch = global.fetch

beforeEach(() => {
  hosts.clear()
  orgs.clear()
  requests = []
  invalidatePlatformLockdownCache()
  resetTakedownLedger()
  resetEmailDeliverabilityPreflightForTests()
  resetOutboundScreenGateForTests()
  process.env = {
    ...ENV,
    RESEND_API_KEY: 're_test',
    USAGE_EMAIL_FROM: 'Aglyn <noreply@aglyn.com>',
  }
  global.fetch = jest.fn(async (url: unknown, init: { body: string }) => {
    if (!String(url).startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${String(url)}`)
    }
    requests.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_test' }),
      text: async () => '',
    }
  }) as unknown as typeof fetch
  hosts.set(HOST, { subdomain: 'lakeside' })
  orgs.set(HOST, { name: 'Lakeside Holdings' })
})

afterEach(() => {
  global.fetch = originalFetch
})

afterAll(() => {
  process.env = ENV
})

describe('the name hostSendingIdentity stamps', () => {
  it('is the business name the site’s emails render', async () => {
    hosts.set(HOST, {
      subdomain: 'lakeside',
      displayName: 'Lakeside site',
      seo: { entity: { name: 'Lakeside Cabins' } },
    })
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.fromName).toBe('Lakeside Cabins')
    expect(verdict.brandFromName).toBe(PLATFORM_NAME)
  })

  it('falls back to the site’s display name', async () => {
    hosts.set(HOST, { subdomain: 'lakeside', displayName: 'Lakeside Cabins' })
    expect((await hostSendingIdentity(HOST)).fromName).toBe('Lakeside Cabins')
  })

  it('falls back to the org’s branding default when the site has no name', async () => {
    expect((await hostSendingIdentity(HOST)).fromName).toBe(PLATFORM_NAME)
  })

  it('falls back to a white-label org’s own brand', async () => {
    orgs.set(HOST, {
      name: 'Northwind',
      plan: 'agency',
      brandingProfile: { fromName: 'Northwind Agency' },
    })
    const verdict = await hostSendingIdentity(HOST)
    expect(verdict.fromName).toBe('Northwind Agency')
    expect(verdict.brandFromName).toBe('Northwind Agency')
  })

  it('flattens a name that would break the From: header', () => {
    expect(
      siteSenderNames({
        org: null,
        host: { displayName: 'Lakeside\r\nBcc: someone@example.com' },
      }).fromName,
    ).toBe('Lakeside Bcc: someone@example.com')
  })
})

describe('a site’s mail as it leaves', () => {
  it('goes out under the site’s name on the identity’s own address', async () => {
    hosts.set(HOST, { subdomain: 'lakeside', displayName: 'Lakeside Cabins' })
    const identity = await hostSendingIdentity(HOST)
    expect(identity.from).toBeTruthy()

    const result = await sendEmail({
      to: 'guest@example.com',
      subject: 'Reservation confirmed',
      text: 'Your stay is confirmed.',
      // What every site sender passes today: the org's branding default.
      fromName: PLATFORM_NAME,
      sendingIdentity: identity,
      audience: 'tenant',
      context: 'reservation confirmation',
    })

    expect(result.sent).toBe(true)
    expect(requests[0]['from']).toBe(`"Lakeside Cabins" <${identity.from}>`)
  })

  it('leaves the platform’s own mail under the platform’s brand', async () => {
    const result = await sendEmail({
      to: 'owner@example.com',
      subject: 'Your usage this month',
      text: 'Usage.',
      fromName: PLATFORM_NAME,
    })

    expect(result.sent).toBe(true)
    expect(requests[0]['from']).toBe(`"${PLATFORM_NAME}" <noreply@aglyn.com>`)
  })
})
