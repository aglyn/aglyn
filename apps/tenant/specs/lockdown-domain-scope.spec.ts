/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * The DOMAIN scope's load-bearing read (AGL-1513), driven through the real
 * `/api/lockdown-verdict` route.
 *
 * The precedence and the notice copy are unit-tested in
 * `libs/aglyn/.../lockdown.spec.ts`. What can only be tested HERE is the
 * wiring that decides whether the domain scope is consulted at all: the
 * `cname--` discriminator. It is the only signal the edge can carry — the
 * edge runtime cannot reach Firestore — so if this route reads it wrongly,
 * a domain lock either never engages or engages on the wrong address, and
 * every unit test above it still passes.
 */

const mockGetDomainLockdown = jest.fn(async (): Promise<unknown> => null)
const mockGetPlatformLockdown = jest.fn(async (): Promise<unknown> => null)
const mockGetHost = jest.fn()
const mockGetOrgBilling = jest.fn(async () => ({ org: null }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: (...args: unknown[]) =>
    mockGetPlatformLockdown(...(args as [])),
  getDomainLockdown: (...args: unknown[]) =>
    mockGetDomainLockdown(...(args as [])),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: (...args: unknown[]) => mockGetHost(...(args as [])),
  default: (...args: unknown[]) => mockGetHost(...(args as [])),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  getOrgBilling: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
  default: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
}))

import { GET } from '../app/api/lockdown-verdict/route'

const verdict = async (host: string) => {
  const response = await GET(
    new Request(
      `https://tenant.example/api/lockdown-verdict?host=${encodeURIComponent(host)}`,
    ),
  )
  return (await response.json()) as Record<string, unknown>
}

const attachedHost = { $id: 'host-1', subdomain: 'acme', cname: 'acme.com' }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetDomainLockdown.mockResolvedValue(null)
  mockGetPlatformLockdown.mockResolvedValue(null)
  mockGetHost.mockResolvedValue({ host: attachedHost })
  mockGetOrgBilling.mockResolvedValue({ org: null })
})

describe('the cname-- discriminator decides whether the domain scope is read', () => {
  it('CONTROL — nothing locked means not locked', async () => {
    expect(await verdict('cname--acme.com')).toMatchObject({ locked: false })
  })

  it('reads the domain scope for an attached custom domain, with the bare hostname', async () => {
    await verdict('cname--acme.com')
    expect(mockGetDomainLockdown).toHaveBeenCalledTimes(1)
    // The PREFIX must be stripped: `lockdowns/domain--cname--acme.com` would
    // be a document the writer never writes, i.e. a lock that never engages.
    expect(mockGetDomainLockdown).toHaveBeenCalledWith('acme.com')
  })

  it('does NOT read the domain scope for a platform subdomain', async () => {
    // `{sub}.aglyn.app` arrives as a bare label. That address is ours, and
    // taking it down is the HOST scope's job — reading the domain scope for
    // it would also mean a domain lock on a name could take down a platform
    // subdomain that merely shares its label.
    await verdict('acme')
    expect(mockGetDomainLockdown).not.toHaveBeenCalled()
  })

  it('refuses a locked custom domain', async () => {
    mockGetDomainLockdown.mockResolvedValue({
      scope: 'domain',
      reason: 'security',
    })
    const body = await verdict('cname--acme.com')
    expect(body).toMatchObject({ locked: true, reason: 'security' })
    expect(String(body['title'])).toMatch(/address/i)
  })

  it('leaves the SAME site serving on its platform subdomain', async () => {
    // The whole point of the scope. One `hosts/{id}` doc holds both
    // addresses, so a host lock could not express this.
    mockGetDomainLockdown.mockResolvedValue({
      scope: 'domain',
      reason: 'manual',
    })
    expect(await verdict('cname--acme.com')).toMatchObject({ locked: true })
    expect(await verdict('acme')).toMatchObject({ locked: false })
  })

  it('never hands the visitor the address that still works', async () => {
    mockGetDomainLockdown.mockResolvedValue({
      scope: 'domain',
      reason: 'security',
    })
    const body = await verdict('cname--acme.com')
    const text = `${body['title']} ${body['message']}`
    expect(text).not.toMatch(/aglyn\.app/i)
    expect(text).not.toMatch(/acme/i)
  })
})

describe('a DETACHED name is still refused — the dispute shape', () => {
  it('locks a domain that resolves to no host at all', async () => {
    // A disputed domain is usually parked mid-dispute, and a hijacked one
    // gets detached and re-attached elsewhere. A lock that only answered for
    // currently-attached names would go quiet exactly when the dispute is
    // live, so the domain read happens BEFORE the unknown-host return.
    mockGetHost.mockResolvedValue({ host: null })
    mockGetDomainLockdown.mockResolvedValue({
      scope: 'domain',
      reason: 'manual',
    })
    expect(await verdict('cname--disputed.com')).toMatchObject({
      locked: true,
      reason: 'manual',
    })
  })

  it('still 404s an unknown host when the name is NOT locked', async () => {
    mockGetHost.mockResolvedValue({ host: null })
    expect(await verdict('cname--unknown.com')).toMatchObject({ locked: false })
  })

  it('does not treat an EXPIRED lock on a detached name as active', async () => {
    mockGetHost.mockResolvedValue({ host: null })
    mockGetDomainLockdown.mockResolvedValue({
      scope: 'domain',
      reason: 'manual',
      untilMs: Date.now() - 60_000,
    })
    expect(await verdict('cname--lapsed.com')).toMatchObject({ locked: false })
  })
})

describe('precedence through the real route', () => {
  it('a host takedown outranks a domain lock, so the notice names the real cause', async () => {
    mockGetHost.mockResolvedValue({
      host: { ...attachedHost, suspendedAt: Date.now() - 1000 },
    })
    mockGetDomainLockdown.mockResolvedValue({
      scope: 'domain',
      reason: 'manual',
    })
    const body = await verdict('cname--acme.com')
    expect(body).toMatchObject({ locked: true })
    // The host copy, not the domain copy — a site takedown must not be
    // described to a visitor as a naming problem.
    expect(String(body['title'])).not.toMatch(/address/i)
  })
})
