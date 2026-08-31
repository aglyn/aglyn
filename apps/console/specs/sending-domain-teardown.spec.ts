/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * THE ONE FUNCTION THAT CALLS BOTH VENDORS TO DESTROY SOMETHING.
 *
 * Every teardown path in the platform — the site delete, the erasure, the
 * orphan reaper — ends here, which makes it the last place a wrong name can be
 * stopped. Both vendors are doubles: nothing in this file may reach Resend or
 * a DNS API, and the assertions are about WHICH calls are made, in what order,
 * and above all which are never made at all.
 */

export {}

const mockRelease = jest.fn(async (_id: string) => true)
const mockRemove = jest.fn(async (_names: readonly string[]) => ({
  outcome: 'written' as const,
  created: 0,
  detail: null,
}))
const mockProviderConfigured = jest.fn(() => true)
const mockZoneConfigured = jest.fn(() => true)

jest.mock('../utils/server/sending-domain-provider', () => ({
  __esModule: true,
  sendingDomainProvider: () => ({
    configured: () => mockProviderConfigured(),
    release: (id: string) => mockRelease(id),
    issue: async () => ({ outcome: 'skipped', detail: 'unconfigured' }),
  }),
}))

jest.mock('../utils/server/sending-zone-provider', () => ({
  __esModule: true,
  sendingZoneProvider: () => ({
    configured: () => mockZoneConfigured(),
    write: async () => ({ outcome: 'written', created: 0, detail: null }),
    remove: (names: readonly string[]) => mockRemove(names),
  }),
}))

jest.mock('../utils/server/issue-sending-domain', () => ({
  __esModule: true,
  issueSendingDomainRecords: async () => ({
    outcome: 'skipped',
    detail: 'unconfigured',
    record: null,
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  // The real derivation, not a stub. `sendingDomainLabel` refusing to produce
  // a label for a reserved name is half of the pool protection, and a fake
  // that merely stripped the apex would make the case below vacuous.
  const email = jest.requireActual('@aglyn/shared-util-email')
  return {
    __esModule: true,
    SENDING_DOMAINS_COLLECTION: 'sendingDomains',
    sendingDomainLabel: (domain: string) =>
      email.platformSendingLabel(domain, email.platformSendingApex()),
    listPendingSendingDomains: async () => [],
    readSendingDomainRecord: () => null,
    recordSendingDomainIssueFailure: async () => undefined,
    firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  }
})

import { teardownSendingDomain } from '../utils/server/provision-sending-domain'
import { sharedSendingPool } from '@aglyn/shared-util-email'

const TENANT = {
  hostId: 'HostAbc',
  orgId: 'org123',
  label: 'northwind',
  domain: 'northwind.mail.aglyn.app',
  providerDomainId: 'dom_live_1',
  dkimSelector: 'resend',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockProviderConfigured.mockReturnValue(true)
  mockZoneConfigured.mockReturnValue(true)
  mockRelease.mockResolvedValue(true)
  mockRemove.mockResolvedValue({ outcome: 'written', created: 0, detail: null })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('⛔ a shared pool member', () => {
  /*
   * `shared1.mail.aglyn.app` … `shared4` are verified, live, and belong to no
   * host — every site with no domain of its own sends its receipts and
   * password resets on one. Releasing one at the provider stops a quarter of
   * the platform's transactional mail, silently.
   *
   * The hole this closes is specific. `sendingDomainLabel` correctly refuses
   * to derive a label for a reserved name, so a pool member produced `''` —
   * and the `|| teardown.label` fallback right after it then handed the zone
   * deletion the caller's own spelling of `shared3`, walking straight past the
   * derivation that had just protected it.
   */
  it('is refused, with no call to either vendor', async () => {
    for (const [index, domain] of sharedSendingPool().entries()) {
      const result = await teardownSendingDomain({
        hostId: 'HostAbc',
        orgId: 'org123',
        label: `shared${index + 1}`,
        domain,
        providerDomainId: 'dom_pool_member',
        dkimSelector: 'resend',
      })

      expect(result).toEqual({ outcome: 'skipped', detail: 'shared-pool' })
    }

    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('is refused on the LABEL even when the domain field says otherwise', async () => {
    const result = await teardownSendingDomain({
      hostId: 'HostAbc',
      orgId: 'org123',
      label: 'shared2',
      domain: 'northwind.mail.aglyn.app',
      providerDomainId: 'dom_pool_member',
      dkimSelector: 'resend',
    })

    expect(result.detail).toBe('shared-pool')
    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })
})

describe('an ordinary tenant domain', () => {
  it('frees the provider slot FIRST, then removes the zone records', async () => {
    // The order is the whole design: the slot is the scarce resource, and the
    // other order leaves a live domain at the provider with no records, which
    // still holds a slot.
    const order: string[] = []
    mockRelease.mockImplementation(async () => {
      order.push('provider')
      return true
    })
    mockRemove.mockImplementation(async () => {
      order.push('zone')
      return { outcome: 'written' as const, created: 0, detail: null }
    })

    const result = await teardownSendingDomain(TENANT)

    expect(result).toEqual({ outcome: 'removed', detail: null })
    expect(order).toEqual(['provider', 'zone'])
    expect(mockRelease).toHaveBeenCalledWith('dom_live_1')
  })

  it('removes the DKIM record, which needs the selector the provider chose', async () => {
    await teardownSendingDomain(TENANT)

    const names = mockRemove.mock.calls[0][0]
    expect(names).toContain('northwind.mail')
    expect(names).toContain('send.northwind.mail')
    // Without this one the signing key stays live in the zone for a name a
    // future site can claim.
    expect(names).toContain('resend._domainkey.northwind.mail')
  })

  it('stops before the zone when the provider refuses', async () => {
    // Deleting the records while the provider still holds the domain spends a
    // slot on a name that can never verify again — the expensive half.
    mockRelease.mockResolvedValue(false)

    const result = await teardownSendingDomain(TENANT)

    expect(result).toEqual({ outcome: 'failed', detail: 'provider-release' })
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it("never touches a customer's own zone", async () => {
    const result = await teardownSendingDomain({
      ...TENANT,
      domain: 'acme.com',
      label: 'acme',
    })

    expect(result.detail).toBe('not-our-zone')
    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })
})

describe('running it twice', () => {
  it('reports removed again, because both halves treat absence as success', async () => {
    /*
     * The reaper retries, so this has to be safe. The provider driver counts a
     * 404 as a release, and the zone driver deletes only names it finds in the
     * zone — so a second pass over an already-clean domain makes the same two
     * calls and reports the same outcome rather than erroring.
     */
    await teardownSendingDomain(TENANT)
    const second = await teardownSendingDomain(TENANT)

    expect(second).toEqual({ outcome: 'removed', detail: null })
    expect(mockRelease).toHaveBeenCalledTimes(2)
    expect(mockRemove).toHaveBeenCalledTimes(2)
  })

  it('has nothing to release when no provider domain was ever created', async () => {
    const result = await teardownSendingDomain({
      ...TENANT,
      providerDomainId: null,
    })

    expect(mockRelease).not.toHaveBeenCalled()
    expect(result.outcome).toBe('removed')
  })
})
