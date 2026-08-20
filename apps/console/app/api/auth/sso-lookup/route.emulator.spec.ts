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
 * The consumer half of the SSO publish gate (AGL-1912).
 *
 * `unpublishSsoDomains` DEACTIVATES a routing doc — `{ active: false }` —
 * rather than deleting it, deliberately, because deleting is `revokeDomain`'s
 * job. That makes the disabled doc exactly as safe as whoever reads it, and
 * this route is the reader: `/api/auth/sso-lookup` is the pre-auth discovery
 * the sign-in page asks before deciding whether to run the SAML redirect.
 *
 * AGL-1912 flagged that it had verified the writer and NOT this half. A route
 * that returned `tenantId`/`providerId` for a deactivated doc would send
 * sign-ins to an IdP the org has turned off — for a domain whose claim may
 * since have been revoked and re-verified by somebody else. So the `active`
 * check is pinned here against the real stored shape, written by the real
 * `publishSsoDomains`/`unpublishSsoDomains` rather than hand-seeded, so the
 * writer and reader cannot drift apart in a way both suites call green.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --testPathPatterns sso-lookup/route.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-sso-lookup-org'
const DOMAIN = 'lookup.sso-lookup-fixture.com'
const TENANT_ID = 'tenant-e2e-sso-lookup'
const PROVIDER_ID = 'saml.fixture'

// Before the route is imported, so its module-scope Admin SDK init finds an
// existing default app rather than reaching for the root .env's production key.
if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('sso-lookup honours a deactivated routing doc (AGL-1912)', () => {
  let db: Firestore
  let sso: typeof import('@aglyn/tenant-data-admin')
  let handler: (request: Request) => Promise<Response>

  const lookup = async (email: string) => {
    const response = await handler(
      new Request(
        `https://console.test/api/auth/sso-lookup?email=${encodeURIComponent(email)}`,
        { method: 'GET' },
      ),
    )
    return response.json() as Promise<Record<string, unknown>>
  }

  async function purge(): Promise<void> {
    await db.collection('ssoDomains').doc(DOMAIN).delete()
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
  }

  beforeAll(async () => {
    db = getFirestore()
    sso = await import('@aglyn/tenant-data-admin')
    handler = (await import('./route')).GET as typeof handler
    await purge()

    // Published through the REAL writer, so the doc under test has the shape
    // production actually stores — including whichever fields `publishSsoDomains`
    // sets that a hand-written fixture would forget.
    await db
      .collection('orgs')
      .doc(ORG)
      .collection('ssoDomains')
      .doc(DOMAIN)
      .set({ domain: DOMAIN, token: 'fixture-token', verified: true })
    const published = await sso.publishSsoDomains({
      orgId: ORG,
      tenantId: TENANT_ID,
      providerId: PROVIDER_ID,
      protocol: 'saml',
      displayName: 'Fixture IdP',
      domains: [DOMAIN],
    })
    // Guard the premise: an unpublished fixture would make the "it is off"
    // assertion below pass for the wrong reason.
    expect(published).toEqual([DOMAIN])
  }, 60_000)

  afterAll(async () => {
    if (!EMULATED) return
    await purge()
  }, 60_000)

  it('THE CONTROL: routes a live domain to the org pool', async () => {
    expect(await lookup(`someone@${DOMAIN}`)).toMatchObject({
      ssoEnabled: true,
      tenantId: TENANT_ID,
      providerId: PROVIDER_ID,
    })
  }, 60_000)

  it('THE DEFECT IT PREVENTS: a deactivated doc routes nobody', async () => {
    await sso.unpublishSsoDomains(ORG)
    // Still present — this is the whole reason the reader has to be checked.
    const doc = await db.collection('ssoDomains').doc(DOMAIN).get()
    expect([doc.exists, doc.get('active')]).toEqual([true, false])

    const verdict = await lookup(`someone@${DOMAIN}`)
    expect(verdict).toEqual({ ssoEnabled: false })
    // Named explicitly: the failure that matters is not "ssoEnabled was true",
    // it is the routing facts leaking regardless of the flag.
    expect(verdict['tenantId']).toBeUndefined()
    expect(verdict['providerId']).toBeUndefined()
  }, 60_000)

  it('says nothing about a domain with no routing doc at all', async () => {
    expect(await lookup('someone@never-published-fixture.com')).toEqual({
      ssoEnabled: false,
    })
  }, 60_000)
})
