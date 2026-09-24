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
 *
 * @jest-environment jsdom
 */

/**
 * A site's Consent groups section (AGL-3320): which sender the site is, read
 * from the org document, never changed here — with a link to the
 * organization's page, where it is.
 */

import {
  consentGroupDisclosure,
  consentGroupForHost,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import SiteConsentGroupCard from './site-consent-group-card'

const ORG = {
  slug: 'acme',
  consentGroups: {
    g_home: { name: 'Home goods', hostIds: ['shop', 'blog', 'deals'] },
  },
}

function renderCard(org: Record<string, unknown>, hostId = 'shop') {
  return render(
    <SiteConsentGroupCard
      hostId={hostId}
      consentGroup={consentGroupForHost(org, hostId)}
      org={org}
    />,
  )
}

describe('a site in a group', () => {
  it('says which group, how many other sites, what its forms say and what an unsubscribe does', () => {
    renderCard(ORG)
    const disclosure = consentGroupDisclosure(consentGroupForHost(ORG, 'shop'))
    expect(
      screen.getByText(
        `This site sends as part of Home goods, with 2 other sites. Signup forms here say: “${disclosure}” Someone who unsubscribes from any of them stops getting marketing email from all of them.`,
      ),
    ).toBeTruthy()
  })

  it('says “site” for a group of two', () => {
    const org = { slug: 'acme', consentGroups: { g: { name: 'Pair', hostIds: ['shop', 'blog'] } } }
    renderCard(org)
    expect(screen.getByText(/with 1 other site\./)).toBeTruthy()
  })
})

describe('a site on its own', () => {
  it('says it sends on its own', () => {
    renderCard({ slug: 'acme' })
    expect(
      screen.getByText(
        'This site sends on its own: someone who signs up here hears only from this site, and an unsubscribe here applies to this site alone.',
      ),
    ).toBeTruthy()
  })
})

describe('where it is changed', () => {
  it('links to the organization’s Consent groups section', () => {
    renderCard(ORG)
    expect(screen.getByRole('link', { name: 'Emails page' }).getAttribute('href')).toBe(
      '/acme/emails/consent-groups',
    )
  })

  it('names the page without a link when the org has no slug yet', () => {
    renderCard({ consentGroups: ORG.consentGroups })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Emails page/)).toBeTruthy()
  })

  it('offers nothing that changes the group from here', () => {
    const { container } = renderCard(ORG)
    expect(container.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
  })
})

describe('while the organization changes its groups', () => {
  const running = (phase: string, hostIds = ['shop', 'blog']) => ({
    ...ORG,
    consentGroupsChange: { changeId: 'chg_1', phase, hostIds, startedAtMs: 1 },
  })

  it('says nothing has changed yet before the change takes effect', () => {
    renderCard(running('carry'))
    expect(screen.getByText(/Nothing has changed yet/)).toBeTruthy()
  })

  it('says what is shown is in effect once it has', () => {
    renderCard(running('rehome'))
    expect(screen.getByText(/already in effect; the CRM records it shares are still being combined/)).toBeTruthy()
  })

  it('says nothing to a site the change does not touch', () => {
    renderCard(running('carry', ['blog', 'deals']))
    expect(screen.queryByText(/Your organization is changing/)).toBeNull()
  })
})
