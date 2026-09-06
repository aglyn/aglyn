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
 * THE OLD ADDRESS BOOK REDIRECTS INTO THE ORG-LEVEL CRM (AGL-2630).
 *
 * `/[orgSlug]/contacts` was a read-only, cross-site address book. It is now
 * the contacts section of the organization-level CRM hub, and this page's
 * one job is to send a kept link there — PERMANENTLY, so a browser corrects
 * the bookmark rather than following the hop on every visit, and to the
 * SECTION rather than the bare hub, which would only redirect again.
 *
 * The page is a server component that calls `permanentRedirect`, which in
 * Next throws to unwind the render. The mock records the call and throws
 * the same way, so the assertion is on what was asked for and the spec does
 * not depend on how Next signals it.
 */

// `mock`-prefixed so the hoisted factory below may close over them.
const mockPermanentRedirect = jest.fn((href: string) => {
  throw new Error(`NEXT_REDIRECT:${href}`)
})
const mockRedirect = jest.fn()

jest.mock('next/navigation', () => ({
  permanentRedirect: (href: string) => mockPermanentRedirect(href),
  redirect: (href: string) => mockRedirect(href),
}))

import OrgContactsRedirect from '../app/(app)/[orgSlug]/contacts/page'

const mountAt = (orgSlug: string) =>
  OrgContactsRedirect({ params: Promise.resolve({ orgSlug }) })

describe('/[orgSlug]/contacts', () => {
  beforeEach(() => {
    mockPermanentRedirect.mockClear()
    mockRedirect.mockClear()
  })

  it("sends a kept link to the org CRM hub's contacts section", async () => {
    await expect(mountAt('test-org')).rejects.toThrow('NEXT_REDIRECT')
    expect(mockPermanentRedirect).toHaveBeenCalledWith('/test-org/crm/contacts')
  })

  it('is PERMANENT — a temporary redirect would be followed on every visit', async () => {
    await expect(mountAt('test-org')).rejects.toThrow()
    expect(mockPermanentRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('carries the org of the address, not a remembered one', async () => {
    await expect(mountAt('northwind-coffee')).rejects.toThrow()
    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      '/northwind-coffee/crm/contacts',
    )
  })
})
