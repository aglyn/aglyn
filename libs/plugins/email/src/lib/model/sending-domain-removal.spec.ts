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

import {
  describeOrgSendingDomainRemoval,
  describeSendingDomainRemoval,
} from './sending-domain-status'

/**
 * WHAT REMOVING A DOMAIN DOES, SAID OVER THE ORGANIZATION.
 *
 * On a site's page the confirmation speaks of "this site". On the
 * organization's page there is no such site: a domain can be what several
 * sites send as, and each of them is affected by which KIND of domain it is.
 * The org sentence has to name them, keep the three consequences apart, and
 * say nothing about sites the page never read.
 */
describe('removing a domain from the organization’s page', () => {
  it('names nobody when no site sends as it', () => {
    const { title, description } = describeOrgSendingDomainRemoval({
      domain: 'acme.com',
      sites: [],
    })
    expect(title).toBe('Remove acme.com?')
    expect(description).toBe(
      describeSendingDomainRemoval({ domain: 'acme.com' }).description,
    )
  })

  it('says a site on a domain the customer owns stops sending altogether', () => {
    const { description } = describeOrgSendingDomainRemoval({
      domain: 'acme.com',
      sites: [{ name: 'Store', issued: false }],
    })
    expect(description).toMatch(/^Store is currently sending as acme\.com\./)
    expect(description).toMatch(
      /stops that site sending at all, receipts included/,
    )
    expect(description).not.toMatch(/shared address, whose delivery/)
  })

  it('names every site, in the plural, when several send as it', () => {
    const { description } = describeOrgSendingDomainRemoval({
      domain: 'acme.com',
      sites: [
        { name: 'Store', issued: false },
        { name: 'Blog', issued: false },
        { name: 'Outlet', issued: false },
      ],
    })
    expect(description).toMatch(/^Store, Blog and Outlet are currently sending/)
    expect(description).toMatch(/stops those sites sending at all/)
  })

  it('says the site a domain was issued to falls back to the shared address', () => {
    const { description } = describeOrgSendingDomainRemoval({
      domain: 'store.mail.aglyn.app',
      sites: [{ name: 'Store', issued: true }],
    })
    expect(description).toMatch(/the domain issued to it/)
    expect(description).toMatch(/back to the shared address/)
    expect(description).not.toMatch(/receipts included/)
  })

  it('does not claim anything about sites it did not read', () => {
    const one = describeOrgSendingDomainRemoval({
      domain: 'acme.com',
      sites: [],
      unchecked: 1,
    }).description
    expect(one).toMatch(/One site not shown on this page was not checked/)

    const several = describeOrgSendingDomainRemoval({
      domain: 'acme.com',
      sites: [],
      unchecked: 4,
    }).description
    expect(several).toMatch(/4 sites not shown on this page were not checked/)
  })

  it('THE CONTROL: the site page’s own sentence still speaks of this site', () => {
    expect(
      describeSendingDomainRemoval({ domain: 'acme.com', selected: 'acme.com' })
        .description,
    ).toMatch(/^This site is currently sending as acme\.com\./)
  })
})
