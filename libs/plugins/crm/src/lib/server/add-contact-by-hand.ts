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
  CAPTURED_BY_HOST_FIELD,
  checkCrmRecordsQuota,
  composeContactName,
  type ConsentGroup,
  consentGroupForGrant,
  consentGroupForHost,
  consentGroupScope,
  CONTACT_COMPANY_IDS_FIELD,
  CONTACT_FACETS_FIELD,
  type ContactFacet,
  contactFacetPath,
  crmDefaultScopeOf,
  crmDefaultSharingOf,
  crmScopeFields,
  crmNewRecordListFields,
  crmReadTokens,
  createResourceUid,
  MARKETING_CONSENT_BY_HOST_FIELD,
  marketingConsentFieldsForGroup,
  marketingConsentFieldsForHost,
  nameSearchFields,
  ORG_CONTACT_HOLDER_ID,
  ORG_SCOPE_TOKEN,
  planContactCompanyLink,
  readContactCompanyLink,
} from '@aglyn/aglyn/server'
import {
  contactCompanyLinkFields,
  firebaseAdmin,
  restampCrmListFieldsAt,
} from '@aglyn/tenant-data-admin'
import { scheduleCapturedEmailCheck } from '@aglyn/tenant-data-admin/server/capture-email-check'
import { settleCompanyContactsCounts } from '@aglyn/tenant-data-admin/server/contact-company-link'
import {
  emailIndexBeside,
  findContactByEmail,
  writeContactEmailIndex,
} from '@aglyn/tenant-data-admin/server/contact-email-index'
import { countCrmRecords } from '@aglyn/tenant-data-admin/server/crm-records'
import { hostRefusesCaptureForErasure } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  type ContactProfileInput,
  storableProfile,
} from '@aglyn/tenant-data-admin/server/upsert-contact'
import { FieldValue } from 'firebase-admin/firestore'
import { ORG_HOLDER_GROUP, contactPrimaryGroup } from '../model/contact-holder'
import { orgHostIds } from './org-caller'

/**
 * A PERSON THE TEAM ADDS WHO DID NOT COME THROUGH A SITE'S CAPTURE (AGL-4122).
 *
 * `upsertHostContact` is the door for somebody a site met, and it needs what a
 * site's capture always has: a site and an address. A person typed in by the
 * team may have neither. They may be a name and a phone number, added at the
 * organization level, because the team is working a deal with someone whose
 * email comes later. That is this path, and only that: a site AND an address
 * still go through the capture door, which is why the route asks.
 *
 * ## Who the person already is
 *
 * The address when there is one, through the same index the capture reads. With
 * none, the phone number. With neither, nobody: two blank emails are not the
 * same person, and a name is not an identity.
 *
 * The phone lookup is the one narrowing the capture's address lookup refuses,
 * deliberately. An address names one human, so the capture recognizes them
 * across every site. A phone number can be a shared office line, so it only
 * matches somebody this caller's view already holds, and an agency's two
 * clients who share a switchboard stay two records.
 *
 * ## The facet, and what names no site
 *
 * With a Source site the profile lives in that site's group's facet, as a
 * capture's would. With none it lives in `ORG_CONTACT_HOLDER_ID`, and the row
 * has no capturing site: `hostId` is `null`, `capturedByHostIds` is empty, and
 * the record says so instead of guessing a brand that never met the person.
 *
 * ## Consent
 *
 * Only with an address, since a basis for mail needs somewhere to send it. With
 * a site, for that site or the group it disclosed. With none, the person told
 * the organization yes, so the grant is written on every site it has. One entry
 * per site, each a group of one: `byHost[hostId]` stays a lookup, and a site
 * added next month inherits nothing.
 *
 * ## What is not announced
 *
 * A created person with no site or no address fires no `contactCreated`: the
 * event belongs to a site, and what listens for it is mostly mail. The team
 * added them on purpose, so owner rules and domain matching have nothing to add
 * either.
 */

export interface AddContactByHandInput {
  orgId: string
  org: Record<string, unknown> | null | undefined
  /** The site they came from, or `null` for none. */
  sourceHostId: string | null
  /** Normalized, or `null` for a person with no address yet. */
  email: string | null
  name?: string
  facet?: ContactProfileInput
  tags?: readonly string[]
  /** An opt-in the person gave. Ignored with no address. */
  marketingConsent?: boolean
  /** The consent-group sentence shown beside the box, with a Source site. */
  disclosedConsentGroup?: string
}

export type AddContactByHandVerdict =
  | { contactId: string; created: boolean }
  | { refused: 'band' | 'erased' | 'error' }

/** The Consent entries for the opt-in, keyed `byHost[hostId]`. */
function consentEntries(
  input: AddContactByHandInput,
  group: ConsentGroup,
  hostIds: readonly string[],
): Record<string, unknown> {
  if (!input.marketingConsent || !input.email) return {}
  const now = Date.now()
  const fields = input.sourceHostId
    ? marketingConsentFieldsForGroup(
        consentGroupForGrant(group, input.disclosedConsentGroup),
        now,
      )
    : Object.assign(
        {},
        ...hostIds.map(
          (hostId) =>
            marketingConsentFieldsForHost(hostId, now)[MARKETING_CONSENT_BY_HOST_FIELD],
        ),
      )
  return input.sourceHostId
    ? (fields[MARKETING_CONSENT_BY_HOST_FIELD] as Record<string, unknown>)
    : fields
}

/** Who a person with this number already is, among those the caller can see. */
async function findVisibleContactByPhone(
  contacts: FirebaseFirestore.CollectionReference,
  phone: string,
  readable: readonly string[] | null,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const matches = await contacts.where('phone', '==', phone).limit(10).get()
  const visible = matches.docs.find((doc) => {
    if (!readable) return true
    const tokens = doc.get('visibleTo')
    return Array.isArray(tokens) && tokens.some((token) => readable.includes(String(token)))
  })
  return visible ?? null
}

/** The profile written into a holder's existing facet, one dotted path per field. */
function facetUpdate(
  groupId: string,
  profile: ReturnType<typeof storableProfile>,
  name: string,
  tags: readonly string[],
): Record<string, unknown> {
  const { custom, ...fields } = profile
  const update: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined) update[contactFacetPath(groupId, field)] = value
  }
  for (const [key, value] of Object.entries(custom ?? {})) {
    update[contactFacetPath(groupId, `custom.${key}`)] = value
  }
  if (name) update[contactFacetPath(groupId, 'name')] = name
  if (tags.length) update[contactFacetPath(groupId, 'tags')] = FieldValue.arrayUnion(...tags)
  return update
}

/** Adds the person, or merges into who they already are. Never rejects. */
export async function addContactByHand(
  input: AddContactByHandInput,
): Promise<AddContactByHandVerdict> {
  try {
    const { orgId, org, sourceHostId, email } = input
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const contacts = orgRef.collection('contacts')
    const group = sourceHostId ? consentGroupForHost(org, sourceHostId) : ORG_HOLDER_GROUP
    const hostIds = sourceHostId ? [sourceHostId] : await orgHostIds(firestore, orgId)
    const tags = input.tags ?? []

    const profile = storableProfile(input.facet)
    if (profile.address === null) delete profile.address
    if (profile.otherAddress === null) delete profile.otherAddress
    const composedName = composeContactName(profile.firstName, profile.lastName)
    const canonicalName = (input.name || composedName || '').slice(0, 120)
    const holderName = (composedName || input.name || '').slice(0, 120)
    // The one number the record can be found by; a person who gave only a
    // mobile is found by that.
    const phone = profile.phone || profile.mobilePhone || ''
    /*
     * A new person is stamped by the org's CRM default, with the marker under
     * "All sites except…" (AGL-4047). A person the workspace already has
     * gains this site's group as before; under all sites except some only the
     * group, since widening a record that exists is the explicit "Apply to
     * existing records" run's to do, never a capture's.
     */
    const stamped = crmScopeFields(org, group)
    const scope =
      crmDefaultScopeOf(org) === 'org'
        ? [ORG_SCOPE_TOKEN]
        : crmDefaultSharingOf(org) === 'allExcept'
          ? consentGroupScope(group)
          : stamped.visibleTo

    const existing = email
      ? await findContactByEmail(contacts, email)
      : phone
        ? await findVisibleContactByPhone(
            contacts,
            phone,
            sourceHostId && crmDefaultScopeOf(org) !== 'org' ? crmReadTokens(group) : null,
          )
        : null

    if (existing) {
      const data = (existing.data() ?? {}) as Record<string, unknown>
      const groupId = sourceHostId
        ? group.groupId
        : contactPrimaryGroup(data, org).groupId || ORG_CONTACT_HOLDER_ID
      const { companyId, ...withoutCompany } = profile
      const link = companyId
        ? planContactCompanyLink(readContactCompanyLink(data, groupId), companyId)
        : null
      const consent = consentEntries(input, group, hostIds)
      await existing.ref.update({
        ...facetUpdate(groupId, withoutCompany, holderName, tags),
        ...(link ? contactCompanyLinkFields(link, groupId) : {}),
        ...(phone && !data['phone'] ? { phone } : {}),
        ...Object.fromEntries(
          Object.entries(consent).map(([hostId, entry]) => [
            `${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}`,
            entry,
          ]),
        ),
        ...(sourceHostId
          ? {
              [CAPTURED_BY_HOST_FIELD]: FieldValue.arrayUnion(sourceHostId),
              visibleTo: FieldValue.arrayUnion(...scope),
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (link) await settleCompanyContactsCounts(orgRef.collection('companies'), link)
      await restampCrmListFieldsAt(existing.ref, 'contacts')
      return { contactId: existing.id, created: false }
    }

    // An erased person stays erased, whichever door they come back through.
    if (email) {
      for (const hostId of hostIds) {
        if (await hostRefusesCaptureForErasure(hostId, email, firestore)) {
          return { refused: 'erased' }
        }
      }
    }

    const { crmRecordsCount } = await countCrmRecords(orgRef, contacts)
    if (!checkCrmRecordsQuota((org as never) ?? null, crmRecordsCount).allowed) {
      return { refused: 'band' }
    }

    const facet: Partial<ContactFacet> & Record<string, unknown> = {
      sources: { manual: true },
      interactions: [
        {
          type: 'manual',
          atMs: Date.now(),
          ...(sourceHostId ? { hostId: sourceHostId } : {}),
          summary: 'Added by hand',
        },
      ],
      tags: [...tags],
      ...(holderName ? { name: holderName } : {}),
      ...profile,
    }
    const consent = consentEntries(input, group, hostIds)
    const record: Record<string, unknown> = {
      hostId: sourceHostId,
      [CAPTURED_BY_HOST_FIELD]: sourceHostId ? [sourceHostId] : [],
      ...stamped,
      /*
       * BLANK RATHER THAN ABSENT. The Contacts table sorts by every column, and
       * a Firestore `orderBy` drops a document that lacks the field, so a person
       * with no address would vanish from the list the moment someone sorted it
       * by email. Blank sorts first and reads as nothing, and no reader treats
       * it as an address: `normalizeContactEmail` answers `null`.
       */
      email: email ?? '',
      ...(canonicalName ? nameSearchFields(canonicalName) : {}),
      ...(phone ? { phone } : {}),
      ...(profile.companyName ? { companyName: profile.companyName } : {}),
      ...(profile.companyId ? { [CONTACT_COMPANY_IDS_FIELD]: [profile.companyId] } : {}),
      [CONTACT_FACETS_FIELD]: { [group.groupId]: facet },
      ...(Object.keys(consent).length ? { [MARKETING_CONSENT_BY_HOST_FIELD]: consent } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const created = contacts.doc(createResourceUid())
    await created.set({
      ...record,
      ...crmNewRecordListFields('contacts', record),
    })
    if (email) {
      await writeContactEmailIndex(emailIndexBeside(contacts), created.id, [email])
      scheduleCapturedEmailCheck({ orgId, ...(sourceHostId ? { hostId: sourceHostId } : {}), email })
    }
    if (profile.companyId) {
      await settleCompanyContactsCounts(
        orgRef.collection('companies'),
        planContactCompanyLink(
          { companyId: null, companyIds: [], heldElsewhere: [] },
          profile.companyId,
        ),
      )
    }
    return { contactId: created.id, created: true }
  } catch (error) {
    console.error('[crm] addContactByHand failed', error)
    return { refused: 'error' }
  }
}
