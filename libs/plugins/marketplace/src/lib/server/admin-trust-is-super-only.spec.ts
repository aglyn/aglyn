/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
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
 * REALM TRUST IS SUPER-ONLY, AND THE CONSOLE SAYS SO BEFORE THE CLICK
 * (AGL-2131, AGL-420; moved here by AGL-3080).
 *
 * This pairing used to be a row in
 * `apps/console/specs/staff-super-only-surface.spec.tsx`, which derives its
 * subjects from `app/api/admin/` and can no longer see either half. It is
 * also a stronger pin here: that row could assert the route refuses and that
 * some UI file contained a matching string; this drives the route and reads
 * the control that calls it.
 *
 * ⛔ AND THE THIRD THING, which is the one with teeth: a grant is only ever
 * written WITH a signature. `trust: 'realm'` on a version with no signature
 * beside it is the state the loaders cannot tell from tampering, and the
 * signing key is the console's — so an unconfigured deployment must refuse
 * the grant rather than write half of one.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockVerifyIdToken = jest.fn()
const written: Record<string, unknown>[] = []
let mockSigned: { signed: boolean; signature?: string; reason?: string }

jest.mock('@aglyn/aglyn/plugin-manager/plugin-trust-signing', () => ({
  __esModule: true,
  signPluginTrust: async () => mockSigned,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request
      .clone()
      .json()
      .catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'verify' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                get: async () => ({
                  get: (field: string) =>
                    ({ sha256: 'abc123', reviewState: 'approved' })[field],
                }),
                set: async (value: Record<string, unknown>) => {
                  written.push(value)
                },
              }),
            }),
          }),
          add: async () => undefined,
        }),
      }),
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'now', delete: () => 'DELETED' },
}))

import { marketplaceAdminTrust } from './admin-trust'

const grant = (role: string) => {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email_verified: true,
    staff: true,
    staffRole: role,
  })
  return marketplaceAdminTrust(
    new Request('https://console.aglyn.com/api/marketplace/admin/trust', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ listingId: 'lst_1', version: '1.0.0' }),
    }),
  )
}

beforeEach(() => {
  written.length = 0
  mockVerifyIdToken.mockReset()
  mockSigned = { signed: true, signature: 'c2ln' }
})

describe('the route admits only super staff', () => {
  it('PREMISE: a super grant is written, with its signature', async () => {
    // The anti-vacuity control. Without it a route that refused EVERYBODY
    // would satisfy both refusals below.
    expect((await grant('super')).status).toBe(200)
    expect(written[0]).toMatchObject({ trust: 'realm', signature: 'c2ln' })
  })

  it('refuses a support engineer', async () => {
    expect((await grant('support')).status).toBe(403)
    expect(written).toHaveLength(0)
  })

  it('refuses a billing engineer', async () => {
    expect((await grant('billing')).status).toBe(403)
    expect(written).toHaveLength(0)
  })
})

describe('⛔ a grant is never written without a signature', () => {
  it('refuses when the deployment holds no key, and writes nothing', async () => {
    mockSigned = {
      signed: false,
      reason: 'Trust signing is not configured (missing PLUGIN_TRUST_PRIVATE_KEY)',
    }
    const response = await grant('super')
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('PLUGIN_TRUST_PRIVATE_KEY'),
    })
    // The half-written state the loaders cannot tell from tampering.
    expect(written).toHaveLength(0)
  })

  it('refuses a signer that claims success with nothing to show', async () => {
    mockSigned = { signed: true }
    expect((await grant('super')).status).toBe(501)
    expect(written).toHaveLength(0)
  })
})

describe('the console says so before the click', () => {
  it('wraps the grant control in the super gate', () => {
    /*
     * Read from source: rendering the detail page needs the shell's staff
     * props, its Firestore instance and the review payload, and a mock deep
     * enough to reach this control would be asserting on the mock. What has
     * to stay true is narrow and textual — the control is wrapped, and the
     * gate it reads is the super one.
     */
    const page = readFileSync(
      join(__dirname, '..', 'components', 'plugin-review-detail.component.tsx'),
      'utf8',
    )
    expect(page).toContain('<BlockedControl')
    expect(page).toMatch(/resolveStaffRoleGate\(staffRole,\s*\['super'\]\)/)
    // And it calls the route this file drove above, not the retired path.
    expect(page).toContain('/api/marketplace/admin/trust')
    expect(page).not.toContain('/api/admin/sign-plugin')
  })
})
