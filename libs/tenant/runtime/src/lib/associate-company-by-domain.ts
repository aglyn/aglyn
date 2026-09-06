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
  companyDomainForEmail,
  companyNameForDomain,
  CRM_COLLECTIONS,
  crmReadTokens,
  crmScopeTokens,
  nameSearchFields,
  orgAutoCreatesCompanies,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  contactCompanyLinkFields,
  firebaseAdmin,
  getOrgForHost,
  type HostContactCreated,
  writeContactCompanyLink,
} from '@aglyn/tenant-data-admin'
import { COMPANY_CONTACTS_COUNT_FIELD, planContactCompanyLink } from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'

/** What the association did, for the spec and the log. */
export type CompanyAssociation =
  | { outcome: 'linked' | 'created'; companyId: string }
  | {
      outcome: 'none'
      reason: 'no-domain' | 'no-org' | 'ambiguous' | 'no-match' | 'failed'
    }

/**
 * Link a NEW contact to the company its email domain names (AGL-2613).
 *
 * HubSpot associates a contact with a company on domain the moment the
 * contact exists, and that is the moment this runs: once, from the capture
 * door, for a person the org did not hold before. A repeat visit by somebody
 * already held is not a new person and re-asks nothing; a door that already
 * knew the company — the console's create drawer, an import row naming one
 * — has said so in the facet and this is not called at all.
 *
 * ## Bounded: one query, one commit
 *
 * The query is `companies where domain == d and visibleTo array-contains-any
 * (the capturing scope's read tokens)`, capped at two — the `(visibleTo
 * CONTAINS, domain ASC)` composite serves it. Two rather than one because
 * the answer has to be "exactly one": two companies at one domain visible
 * to this site is an ambiguity a capture must not resolve by picking the
 * first, and the contact waits for a person. The scope predicate is the
 * console's own listener predicate, so a company this site could not open
 * is not a match — an agency's client at `acme.com` is not linked to a
 * sibling client's Acme.
 *
 * The write is one batch: the facet and the mirror on the contact, and the
 * count on the company. The contact is fresh, so the plan is the trivial
 * one — no previous link, nothing held elsewhere — and needs no read of the
 * document.
 *
 * ## Creating is a setting, and off by default
 *
 * With `crm.autoCreateCompanies` on the org document, a domain no visible
 * company carries becomes one, named after the domain and scoped exactly as
 * the contact was — `crmScopeTokens`, the stamp every CRM creator uses —
 * with the count starting at one. Public mailbox domains never reach this
 * branch, because `companyDomainForEmail` answers `null` for them: a
 * workspace's consumer list is not a list of accounts.
 *
 * ## The same posture as the capture
 *
 * Never throws. The capture has already succeeded and a form submission
 * must not fail because the CRM could not file its author; a failure is
 * logged and answered as `none`, and the person is exactly as capturable
 * by hand as they were before this existed.
 */
export async function associateCompanyByDomain(
  created: Pick<HostContactCreated, 'hostId' | 'contactId' | 'email'>,
): Promise<CompanyAssociation> {
  const domain = companyDomainForEmail(created.email)
  if (!domain) return { outcome: 'none', reason: 'no-domain' }
  try {
    const resolved = await getOrgForHost(created.hostId)
    if (!resolved) return { outcome: 'none', reason: 'no-org' }
    const org = resolved.org as Record<string, unknown>
    const group = await consentGroupForSite(created.hostId, org)
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(resolved.orgId)
    const companiesRef = orgRef.collection(CRM_COLLECTIONS.companies)
    const contactRef = orgRef.collection('contacts').doc(created.contactId)

    const matches = await companiesRef
      .where('domain', '==', domain)
      .where('visibleTo', 'array-contains-any', crmReadTokens(group))
      .limit(2)
      .get()
    if (matches.size > 1) return { outcome: 'none', reason: 'ambiguous' }
    if (matches.size === 1) {
      const companyId = matches.docs[0].id
      await writeContactCompanyLink({
        firestore,
        contactRef,
        contact: null,
        companiesRef,
        groupId: group.groupId,
        companyId,
      })
      return { outcome: 'linked', companyId }
    }
    if (!orgAutoCreatesCompanies(org)) {
      return { outcome: 'none', reason: 'no-match' }
    }

    /*
     * The company and the link in one commit, so a company never exists
     * with a count of one and no contact naming it — or the reverse. The
     * count is written as a value rather than an increment because the
     * document is being created in the same batch, and the plan's `+1` is
     * exactly what a fresh company with one contact stores.
     */
    const plan = planContactCompanyLink(
      { companyId: null, companyIds: [], heldElsewhere: [] },
      companiesRef.doc().id,
    )
    if (!plan?.companyId) return { outcome: 'none', reason: 'failed' }
    const companyRef = companiesRef.doc(plan.companyId)
    const batch = firestore.batch()
    batch.set(companyRef, {
      ...nameSearchFields(companyNameForDomain(domain)),
      domain,
      visibleTo: crmScopeTokens(org, group),
      hostId: created.hostId,
      [COMPANY_CONTACTS_COUNT_FIELD]: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    batch.update(contactRef, {
      ...contactCompanyLinkFields(plan, group.groupId),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()
    return { outcome: 'created', companyId: plan.companyId }
  } catch (error) {
    console.error(
      'associateCompanyByDomain failed',
      created.hostId,
      created.contactId,
      error,
    )
    return { outcome: 'none', reason: 'failed' }
  }
}

export default associateCompanyByDomain
