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
 * Whether the platform serves a name (AGL-4085): from host records and the
 * hosting platform's live view, never from the name's shape. Firestore and
 * the platform status are replaced at their seams; the defaults are never
 * reached, which the two module mocks below make loud if they ever are.
 */

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => {
      throw new Error('the spec reached Firestore; pass findHosts')
    },
  },
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  projectDomainStatus: async () => {
    throw new Error('the spec reached the hosting platform; pass domainStatus')
  },
}))

import type { ProjectDomainStatus } from './domain-provider'
import {
  isPlatformServedDomain,
  platformServedDomain,
  type HostDomainField,
  type HostDomainRecord,
} from './platform-served-domain'

/** The host records: an Aglyn-hosted brand site, a customer with a www twin, one mid-attach. */
const HOSTS: HostDomainRecord[] = [
  { id: 'host-brand', subdomain: 'brand', cname: 'aglyn.com' },
  { id: 'host-bakery', subdomain: 'bakery', cname: 'www.bakery-shop.com', cnameTwin: 'bakery-shop.com' },
  { id: 'host-pending', subdomain: 'pending', cname: 'pending-shop.com', cnameAttachmentPending: true },
  { id: 'host-leaving', subdomain: 'leaving', cname: 'leaving-shop.com', cnameDetachmentPending: true },
  { id: 'host-twin-pending', subdomain: 'twinp', cname: 'twin-shop.com', cnameTwin: 'www.twin-shop.com', cnameTwinPending: true },
  { id: 'host-dup-1', subdomain: 'dup1', cname: 'claimed-twice.com' },
  { id: 'host-dup-2', subdomain: 'dup2', cname: 'claimed-twice.com' },
  { id: 'host-foo', subdomain: 'foo' },
]

const asked: { field: HostDomainField; value: string }[] = []
const findHosts = async (field: HostDomainField, value: string) => {
  asked.push({ field, value })
  return HOSTS.filter((host) => host[field] === value).slice(0, 2)
}

const serving = (domain: string): ProjectDomainStatus => ({ state: 'serving', domain, verification: [], conflicts: [] })
const statusAsked: string[] = []
const allServing = async (domain: string) => {
  statusAsked.push(domain)
  return serving(domain)
}

beforeEach(() => {
  asked.length = 0
  statusAsked.length = 0
})

describe('a name this platform serves', () => {
  it('the Aglyn-hosted brand site, by its host record and a live platform check', async () => {
    await expect(platformServedDomain('aglyn.com', { findHosts, domainStatus: allServing })).resolves.toEqual({
      served: true,
      via: 'cname',
      hostId: 'host-brand',
    })
    expect(statusAsked).toEqual(['aglyn.com'])
  })

  it('a platform subdomain held by one host, without asking the platform (the apex DNS is ours)', async () => {
    await expect(platformServedDomain('foo.aglyn.app', { findHosts, domainStatus: allServing })).resolves.toEqual({
      served: true,
      via: 'subdomain',
      hostId: 'host-foo',
    })
    expect(statusAsked).toEqual([])
  })

  it("a custom domain's twin, which forwards to it from our deployment", async () => {
    await expect(platformServedDomain('bakery-shop.com', { findHosts, domainStatus: allServing })).resolves.toEqual({
      served: true,
      via: 'twin',
      hostId: 'host-bakery',
    })
    await expect(isPlatformServedDomain('www.bakery-shop.com', { findHosts, domainStatus: allServing })).resolves.toBe(true)
  })

  it('reads a request hostname as the tenant does: case and a trailing dot fold away', async () => {
    await expect(isPlatformServedDomain('AGLYN.com.', { findHosts, domainStatus: allServing })).resolves.toBe(true)
    expect(asked[0]).toEqual({ field: 'cname', value: 'aglyn.com' })
  })
})

describe('a name this platform does not serve', () => {
  it('a third-party site no host carries, and the platform is never asked about it', async () => {
    await expect(platformServedDomain('rosies-bakery.com', { findHosts, domainStatus: allServing })).resolves.toEqual({
      served: false,
      reason: 'no-host',
    })
    expect(statusAsked).toEqual([])
  })

  it('the www name of the brand site when no record carries it', async () => {
    await expect(isPlatformServedDomain('www.aglyn.com', { findHosts, domainStatus: allServing })).resolves.toBe(false)
  })

  it('a subdomain under the apex no host holds, a deeper name under it, and the apex itself', async () => {
    for (const name of ['nobody.aglyn.app', 'a.foo.aglyn.app', 'aglyn.app']) {
      await expect(isPlatformServedDomain(name, { findHosts, domainStatus: allServing })).resolves.toBe(false)
    }
  })

  it('a look-alike of a served name: a suffix match is never a match', async () => {
    for (const name of ['evil-aglyn.com', 'aglyn.com.evil.net', 'xaglyn.com', 'foo.aglyn.app.evil.net']) {
      await expect(isPlatformServedDomain(name, { findHosts, domainStatus: allServing })).resolves.toBe(false)
    }
  })

  it('anything that is not a hostname: an address, a port, a path, a scheme, empty', async () => {
    for (const name of ['93.184.216.34', 'aglyn.com:8443', 'aglyn.com/legal', 'https://aglyn.com', '', 'localhost']) {
      await expect(platformServedDomain(name, { findHosts, domainStatus: allServing })).resolves.toEqual({
        served: false,
        reason: 'not-a-hostname',
      })
    }
    expect(asked).toEqual([])
  })

  it('a custom domain whose attach or detach never landed, or whose twin is pending', async () => {
    for (const name of ['pending-shop.com', 'leaving-shop.com', 'www.twin-shop.com']) {
      await expect(platformServedDomain(name, { findHosts, domainStatus: allServing })).resolves.toEqual({
        served: false,
        reason: 'not-live',
      })
    }
    expect(statusAsked).toEqual([])
  })

  it('a name two hosts claim', async () => {
    await expect(platformServedDomain('claimed-twice.com', { findHosts, domainStatus: allServing })).resolves.toEqual({
      served: false,
      reason: 'ambiguous',
    })
  })

  it('a recorded custom domain the platform no longer serves: re-pointed, shadowed, pending, or unknown', async () => {
    const answers: ProjectDomainStatus[] = [
      { state: 'dns-misconfigured', domain: 'aglyn.com', verification: [], conflicts: [] },
      { state: 'serving', domain: 'aglyn.com', verification: [], conflicts: [{ type: 'A', name: '@', value: '203.0.113.9' }] },
      { state: 'certificate-pending', domain: 'aglyn.com', verification: [], conflicts: [] },
      { state: 'ownership-pending', domain: 'aglyn.com', verification: [], conflicts: [] },
      { state: 'not-attached', domain: 'aglyn.com', verification: [], conflicts: [] },
      { state: 'unknown', domain: 'aglyn.com', verification: [], conflicts: [] },
      { state: 'skipped', domain: 'aglyn.com', verification: [], conflicts: [] },
    ]
    for (const answer of answers) {
      await expect(
        platformServedDomain('aglyn.com', { findHosts, domainStatus: async () => answer }),
      ).resolves.toEqual({ served: false, reason: 'not-serving' })
    }
  })

  it('a read that fails is a no, never an exception', async () => {
    const failing = async () => {
      throw new Error('deadline exceeded')
    }
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(platformServedDomain('aglyn.com', { findHosts: failing, domainStatus: allServing })).resolves.toEqual({
        served: false,
        reason: 'error',
      })
      await expect(platformServedDomain('aglyn.com', { findHosts, domainStatus: failing })).resolves.toEqual({
        served: false,
        reason: 'error',
      })
    } finally {
      quiet.mockRestore()
    }
  })
})
