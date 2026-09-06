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
 * THE "KNOWN BY" CARD SHOWS THE CROSS-SITE FACTS, AND ONLY THOSE (AGL-2630).
 *
 * The organization-level record is the one surface designed to cross the
 * host boundary, which makes it the one place a holder's private notes
 * could leak across brands. So the card is pinned two ways: it names every
 * capturing site with the person's consent FOR THAT SITE — never a bare
 * "consented" — and links each into the site's own hub; and it renders
 * nothing of any holder's facet, and nothing at all under a site.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import ContactKnownByCard from './contact-known-by-card'

const ORG = {
  $id: 'org-1',
  consentGroups: { 'grp-1': { name: 'Brand', hostIds: ['host-b', 'host-c'] } },
}

const ROW = {
  email: 'jo@example.com',
  name: 'Jo',
  capturedByHostIds: ['host-b', 'host-a'],
  // Consent per controller, keyed by site: granted to Site A alone, and
  // declined to the declared group Site B belongs to — recorded on its
  // sibling, host-c, which the group's reading inherits.
  marketingConsentByHost: {
    'host-a': { marketingConsent: true },
    'host-c': { marketingConsent: false },
  },
  facets: {
    'host-a': { notes: 'PRIVATE NOTE A' },
    'grp-1': { notes: 'PRIVATE NOTE B' },
  },
}

function Mount({ children }: { children: ReactNode }) {
  return (
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hostsReady: true,
        hostsPath: '/acme/hosts',
        hosts: [
          { id: 'host-a', name: 'Site A', subdomain: 'a' },
          // Its subdomain never resolved: named, not linked.
          { id: 'host-b', name: 'Site B', subdomain: null },
        ],
      }}
    >
      {children}
    </CrmOrgMountProvider>
  )
}

describe('ContactKnownByCard', () => {
  it('names every capturing site, sorted, with the consent FOR THAT SITE', () => {
    render(<ContactKnownByCard row={ROW} contactId="con-1" org={ORG} />, { wrapper: Mount })
    expect(screen.getByText('Known by')).toBeTruthy()
    // Sorted for a stable render, not in capture order — Site A first even
    // though Site B captured the person first.
    const siteA = screen.getByText('Site A')
    const siteB = screen.getByText('Site B')
    expect(
      siteA.compareDocumentPosition(siteB) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The controller rides on every verdict.
    expect(screen.getByText('Site A · Opted in')).toBeTruthy()
    expect(screen.getByText('Brand · Opted out')).toBeTruthy()
    expect(screen.getByText(/Consent given to Brand, which Site B is part of/)).toBeTruthy()
  })

  it('links a site into its own hub, and leaves an unresolved site named but unlinked', () => {
    render(<ContactKnownByCard row={ROW} contactId="con 1" org={ORG} />, { wrapper: Mount })
    expect(screen.getByRole('link', { name: 'Site A' }).getAttribute('href')).toBe(
      '/acme/hosts/a/crm/contacts/con%201',
    )
    // Named, and NOT a link: an anchor with no destination has no link role.
    expect(screen.queryByRole('link', { name: 'Site B' })).toBeNull()
    expect(screen.getByText('Site B').closest('a')?.getAttribute('href') ?? null).toBeNull()
  })

  it("renders NOTHING of any holder's facet", () => {
    const { container } = render(
      <ContactKnownByCard row={ROW} contactId="con-1" org={ORG} />,
      { wrapper: Mount },
    )
    expect(container.textContent).not.toContain('PRIVATE NOTE')
  })

  it('says when no site recorded the person, rather than reading it as every site', () => {
    render(
      <ContactKnownByCard row={{ email: 'x@example.com' }} contactId="con-2" org={ORG} />,
      { wrapper: Mount },
    )
    expect(screen.getByText('No site recorded')).toBeTruthy()
    // No site is named — the card's docs link is the only anchor left.
    expect(screen.queryByRole('link', { name: /^Site/ })).toBeNull()
    expect(screen.queryByText(/Opted|No record/)).toBeNull()
  })

  it('renders nothing at all under a site', () => {
    const { container } = render(
      <ContactKnownByCard row={ROW} contactId="con-1" org={ORG} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
