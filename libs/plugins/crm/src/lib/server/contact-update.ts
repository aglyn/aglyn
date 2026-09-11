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
 * `POST /api/crm/contact-update` — one holder's profile fields on one or
 * more contacts (AGL-2804).
 *
 * Body: `{ hostId, contactIds, set }` under a site, or `{ orgId, hostId?,
 * contactIds, set }` at the organization level, where `set` is
 * `ContactUpdateFields`. Answers `{ ok, results }`: one outcome per contact,
 * in the order the ids were sent.
 *
 * ## Why every facet write comes here
 *
 * A contact's fields live in the facet of the holder that keeps them —
 * `facets.{groupId}.*` — and the Firestore rules cannot tell one field of a
 * facet from another: the holder is a map key a rule cannot address, and a
 * write's affected keys name only `facets`. So the rules let a client update
 * change nothing in a facet beyond letting a holder go, and the console's
 * edits arrive here, where the plan is asked about the fields the request
 * actually carries.
 *
 * ## Who may call it
 *
 * The CRM writer the task routes admit (`authorizeCrmWriter`): under a site,
 * a member whose role writes org data, who holds `data.manage` and whose
 * access reaches the site; at the organization level, an org-wide member
 * with the permission. Each contact must then be one the caller may read —
 * the rules' `canReadScoped()` — and, under a site, one the site's hub lists.
 *
 * ## The plan
 *
 * Every field is the CRM suite's (AGL-2790). A plan without the suite reads
 * its Leads and edits no contact: not the owner, company, custom values or
 * files, and not the profile a capture writes (name, phone, job title,
 * address), the tags, the notes or the campaign filing either. A request
 * carrying any field is refused to such a plan once the caller is known, and
 * before a contact is read — staff included, because the plan is a fact
 * about the workspace. Erasing a person is another route, open on every plan.
 *
 * ## One holder, by dotted path
 *
 * Under a site the facet is the site's consent group's; at the organization
 * level it is each contact's own primary holder, the facet the record page
 * shows there. Every field is one dotted path — a nested `facets` object
 * would replace every other holder's map — and a text field sent empty is
 * deleted rather than stored blank, so "no phone" has one shape.
 *
 * ## Many contacts, one commit
 *
 * The contacts are read together and written in one batch. A batch that
 * fails is retried contact by contact, so the one that could not be written
 * is named and the rest still land. A company's contacts count follows the
 * link: summed per company and settled once the contacts are written, so a
 * company deleted in between cannot fail the save of the people at it — the
 * company page's live aggregate is what corrects a count that did not move.
 */

import {
  type AglynPostalAddress,
  consentGroupForHost,
  CONTACT_FIELDS_MAX_PER_ORG,
  type ContactCompanyLinkPlan,
  type ContactCustomValue,
  type ContactFieldDefinition,
  campaignMembershipValue,
  contactCampaignFieldPath,
  contactFacetPath,
  contactPrimaryGroup,
  CRM_COLLECTIONS,
  CRM_MEDIA_IDS_FIELD,
  crmReadTokens,
  isOrgWideMember,
  normalizeAddress,
  normalizeCrmMediaIds,
  normalizePhone,
  type PluginApiHandler,
  planContactCompanyLink,
  readContactCompanyLink,
  readContactFacet,
  readCrmCustomInput,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import {
  companyContactsCountFields,
  contactCompanyLinkFields,
  firebaseAdmin,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  CONTACT_UPDATE_FIELDS,
  type ContactUpdateFields,
  type ContactUpdateOutcome,
  type ContactUpdateResponse,
  CRM_CONTACT_UPDATE_MAX,
} from '../model/contact-update'
import {
  CONTACT_NOTES_MAX,
  CONTACT_PHONE_REFUSAL,
  CONTACT_TAGS_MAX,
  normalizeTags,
  readBulkTag,
  typed,
} from './contact-profile'
import { readCrmRouteScope } from './org-caller'
import { crmSuiteRefusal } from './suite-gate'
import { authorizeCrmWriter, canReach, type Writer } from './task-routes'

/** What the suite gate names for each field a request can carry. */
const SUITE_ACTS: Record<keyof ContactUpdateFields, string> = {
  name: "Editing a contact's profile",
  phone: "Editing a contact's profile",
  jobTitle: "Editing a contact's profile",
  address: "Editing a contact's profile",
  notes: "Editing a contact's notes",
  tags: 'Tagging a contact',
  addTag: 'Tagging a contact',
  removeTag: 'Tagging a contact',
  campaignIds: 'Filing a contact under a campaign',
  ownerUid: "Assigning a contact's owner",
  companyId: 'Filing a contact under a company',
  companyName: 'Filing a contact under a company',
  custom: "Editing a contact's custom fields",
  mediaIds: 'Attaching files to a contact',
}

/** A contact read at the organization level that no site has captured. */
const NO_HOLDER_REFUSAL = 'No site holds this contact yet, so it has no profile to edit.'

/**
 * The act a request is refused for on a plan without the suite: the first
 * field it carries, in the order the route reads them. Every field is the
 * suite's, so whichever field a request names is the act its refusal names.
 */
export function contactUpdateSuiteAct(fields: ContactUpdateFields): string {
  const field = CONTACT_UPDATE_FIELDS.find((key) => fields[key] !== undefined)
  return field ? SUITE_ACTS[field] : "Editing a contact's profile"
}

/**
 * A body's `set`, read into the fields it names, or the sentence refusing
 * it. A key the route does not save is refused rather than dropped: a save
 * that silently lost a field would read as a save that kept it.
 */
export function readContactUpdateFields(
  input: unknown,
): { ok: true; fields: ContactUpdateFields } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Name the fields to save.' }
  }
  const raw = input as Record<string, unknown>
  const unknownKey = Object.keys(raw).find(
    (key) => !(CONTACT_UPDATE_FIELDS as readonly string[]).includes(key),
  )
  if (unknownKey) {
    return { ok: false, error: `"${unknownKey}" is not a field a contact's profile saves.` }
  }
  const fields: ContactUpdateFields = {}
  if ('name' in raw) fields.name = typed(raw['name'], 120)
  if ('phone' in raw) {
    const text = typed(raw['phone'], 40)
    const phone = text ? normalizePhone(text) : ''
    if (phone === null) return { ok: false, error: CONTACT_PHONE_REFUSAL }
    fields.phone = phone
  }
  if ('jobTitle' in raw) fields.jobTitle = typed(raw['jobTitle'], 120)
  if ('address' in raw) {
    const address = raw['address']
    fields.address =
      address && typeof address === 'object' && !Array.isArray(address)
        ? normalizeAddress(address as AglynPostalAddress)
        : null
  }
  if ('notes' in raw) fields.notes = String(raw['notes'] ?? '').slice(0, CONTACT_NOTES_MAX)
  // One write may carry one transform per field, so the tags are replaced,
  // added to or taken from — never two of those at once.
  if (['tags', 'addTag', 'removeTag'].filter((key) => key in raw).length > 1) {
    return { ok: false, error: 'Send the tags, a tag to add or a tag to remove — one of them.' }
  }
  if ('tags' in raw) {
    if (!Array.isArray(raw['tags'])) return { ok: false, error: 'Tags must be a list.' }
    fields.tags = normalizeTags(raw['tags'])
  }
  for (const key of ['addTag', 'removeTag'] as const) {
    if (!(key in raw)) continue
    const tag = readBulkTag(raw[key])
    if (!tag) return { ok: false, error: 'Name the tag.' }
    fields[key] = tag
  }
  if ('campaignIds' in raw) {
    const ids = raw['campaignIds']
    if (!Array.isArray(ids)) return { ok: false, error: 'Campaigns must be a list.' }
    fields.campaignIds = campaignMembershipValue(ids.map((id) => String(id ?? '')))
  }
  if ('ownerUid' in raw) fields.ownerUid = typed(raw['ownerUid'], 128)
  if ('companyId' in raw) {
    const companyId = raw['companyId'] === null ? null : typed(raw['companyId'], 128)
    if (companyId !== null && (!companyId || companyId.includes('/'))) {
      return { ok: false, error: 'The company could not be read.' }
    }
    fields.companyId = companyId
  }
  if ('companyName' in raw) fields.companyName = typed(raw['companyName'], 120)
  if ('custom' in raw) {
    const custom = raw['custom']
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
      return { ok: false, error: 'Custom fields must be values keyed by field key.' }
    }
    fields.custom = custom as Record<string, ContactCustomValue>
  }
  if ('mediaIds' in raw) {
    if (!Array.isArray(raw['mediaIds'])) {
      return { ok: false, error: 'Files must be a list of ids.' }
    }
    fields.mediaIds = normalizeCrmMediaIds(raw['mediaIds'])
  }
  if (!Object.keys(fields).length) return { ok: false, error: 'Name the fields to save.' }
  return { ok: true, fields }
}

/** The ids a body names, deduplicated — or `null` when any is unreadable or there are too many. */
function readContactIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > CRM_CONTACT_UPDATE_MAX) {
    return null
  }
  const ids = value.map((id) => typed(id, 200))
  if (ids.some((id) => !id || id.includes('/'))) return null
  return [...new Set(ids)]
}

/**
 * Under a site, whether the caller's access reaches it. The rules could not
 * ask this of a facet write — they cannot see which holder a write is for —
 * and a collaborator on one site must not write another site's notes on a
 * person both of them hold.
 */
function reachesSite(writer: Writer, hostId: string): boolean {
  return (
    writer.staff ||
    isOrgWideMember(writer.member) ||
    Boolean((writer.member?.hostAccess as Record<string, unknown> | undefined)?.[hostId])
  )
}

const refused = (contactId: string, error: string): ContactUpdateOutcome => ({
  contactId,
  ok: false,
  error,
})

interface ContactWrite {
  contactId: string
  ref: FirebaseFirestore.DocumentReference
  update: Record<string, unknown>
  counts: ContactCompanyLinkPlan['counts']
}

/**
 * One contact's update for one holder, or the sentence refusing the row.
 * `update` is `null` when the document already says everything asked — a tag
 * the row already carries, a link already made.
 */
function contactPatch(
  contact: Record<string, unknown>,
  groupId: string,
  fields: ContactUpdateFields,
  custom: Record<string, ContactCustomValue> | undefined,
  linkedCompanyName: string,
):
  | { update: Record<string, unknown> | null; counts: ContactCompanyLinkPlan['counts'] }
  | { refused: string } {
  const path = (field: string) => contactFacetPath(groupId, field)
  /** A text field as stored: the value, or the field's absence. */
  const text = (value: string) => value || FieldValue.delete()
  const update: Record<string, unknown> = {}
  let counts: ContactCompanyLinkPlan['counts'] = []

  if (fields.name !== undefined) update[path('name')] = text(fields.name)
  if (fields.phone !== undefined) {
    update[path('phone')] = text(fields.phone)
    // The search echo — see `HostContact.phone`.
    update['phone'] = text(fields.phone)
  }
  if (fields.jobTitle !== undefined) update[path('jobTitle')] = text(fields.jobTitle)
  if (fields.address !== undefined) {
    update[path('address')] = fields.address ?? FieldValue.delete()
  }
  if (fields.notes !== undefined) update[path('notes')] = fields.notes
  if (fields.tags !== undefined) update[path('tags')] = fields.tags

  const held = (readContactFacet(contact, groupId).tags ?? []).map((tag) =>
    String(tag).toLowerCase(),
  )
  if (fields.addTag && !held.includes(fields.addTag)) {
    // The record page's cap, which a selection must not slip past.
    if (held.length >= CONTACT_TAGS_MAX) {
      return { refused: `already has ${CONTACT_TAGS_MAX} tags` }
    }
    update[path('tags')] = FieldValue.arrayUnion(fields.addTag)
  }
  if (fields.removeTag && held.includes(fields.removeTag)) {
    update[path('tags')] = FieldValue.arrayRemove(fields.removeTag)
  }
  if (fields.campaignIds !== undefined) {
    update[contactCampaignFieldPath(groupId)] = fields.campaignIds
  }
  if (fields.ownerUid !== undefined) update[path('ownerUid')] = text(fields.ownerUid)

  if (fields.companyId !== undefined) {
    const plan = planContactCompanyLink(
      readContactCompanyLink(contact, groupId),
      fields.companyId,
    )
    if (plan) {
      Object.assign(update, contactCompanyLinkFields(plan, groupId))
      counts = plan.counts
      if (fields.companyName === undefined) {
        // The label follows the link: the company's own name, or nothing.
        const label = plan.companyId ? linkedCompanyName : ''
        update[path('companyName')] = text(label)
        // The search echo — see `HostContact.companyName`.
        update['companyName'] = text(label)
      }
    }
  }
  if (fields.companyName !== undefined) {
    update[path('companyName')] = text(fields.companyName)
    update['companyName'] = text(fields.companyName)
  }
  for (const [key, value] of Object.entries(custom ?? {})) {
    update[path(`custom.${key}`)] = value
  }
  if (fields.mediaIds !== undefined) update[path(CRM_MEDIA_IDS_FIELD)] = fields.mediaIds

  if (!Object.keys(update).length) return { update: null, counts }
  update['updatedAt'] = FieldValue.serverTimestamp()
  return { update, counts }
}

/**
 * Every write in one batch, and — when the batch is refused — each on its
 * own, so the contact that could not be written is the only one reported.
 * Answers the ids that were not written.
 */
async function commitContactWrites(
  firestore: FirebaseFirestore.Firestore,
  writes: readonly ContactWrite[],
): Promise<Set<string>> {
  const failed = new Set<string>()
  if (!writes.length) return failed
  const batch = firestore.batch()
  for (const write of writes) batch.update(write.ref, write.update)
  try {
    await batch.commit()
    return failed
  } catch {
    // A batch names no document; the pass below finds the one it was.
  }
  for (const write of writes) {
    try {
      await write.ref.update(write.update)
    } catch (error) {
      console.error('[crm] contact-update could not write a contact', write.contactId, error)
      failed.add(write.contactId)
    }
  }
  return failed
}

/** Each company's contacts count moved once, by the sum of what the written links moved. */
async function settleCompanyCounts(
  companies: FirebaseFirestore.CollectionReference,
  writes: readonly ContactWrite[],
): Promise<void> {
  const deltas = new Map<string, number>()
  for (const write of writes) {
    for (const count of write.counts) {
      deltas.set(count.companyId, (deltas.get(count.companyId) ?? 0) + count.delta)
    }
  }
  await Promise.all(
    [...deltas]
      .filter(([, delta]) => delta !== 0)
      .map(([companyId, delta]) =>
        companies
          .doc(companyId)
          .update(companyContactsCountFields(delta))
          .catch((error: unknown) => {
            console.error('[crm] company contacts count could not move', companyId, delta, error)
          }),
      ),
  )
}

export const crmContactUpdateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const contactIds = readContactIds(body['contactIds'])
  if (!contactIds) {
    res.status(400).json({ error: `Name between 1 and ${CRM_CONTACT_UPDATE_MAX} contacts.` })
    return
  }
  const read = readContactUpdateFields(body['set'])
  if (read.ok === false) {
    res.status(400).json({ error: read.error })
    return
  }
  const { fields } = read

  try {
    const writer = await authorizeCrmWriter(req, scope, { suiteAct: null })
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    if (scope.level === 'site' && !reachesSite(writer, scope.hostId)) {
      res.status(403).json({ error: 'Your access to this organization does not reach this site.' })
      return
    }
    // The plan after the person, and before any contact is read (AGL-2787).
    const suite = crmSuiteRefusal(writer.org, contactUpdateSuiteAct(fields))
    if (suite) {
      res.status(suite.status).json(suite.body)
      return
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(writer.orgId)
    const siteGroup =
      scope.level === 'site' ? consentGroupForHost(writer.org, scope.hostId) : null
    const siteTokens = siteGroup ? crmReadTokens(siteGroup) : null

    let custom: Record<string, ContactCustomValue> | undefined
    if (fields.custom) {
      const definitions = await orgRef
        .collection(CRM_COLLECTIONS.contactFields)
        .limit(CONTACT_FIELDS_MAX_PER_ORG)
        .get()
      const judged = readCrmCustomInput(
        fields.custom,
        definitions.docs.map((doc) => doc.data() as ContactFieldDefinition),
        'contact',
      )
      if ('errors' in judged) {
        res.status(400).json({
          error: Object.values(judged.errors)[0] ?? 'A custom value could not be saved.',
        })
        return
      }
      custom = judged.values
    }

    if (fields.ownerUid) {
      const owner = await resolveOrgMembership(fields.ownerUid, writer.orgId).catch(() => null)
      if (!owner?.member) {
        res.status(400).json({ error: 'The owner is not a member of this organization.' })
        return
      }
    }

    // The company a link names has to exist and be visible to the caller and
    // the site, or a person could be filed under a record nobody here can open.
    let linkedCompanyName = ''
    if (fields.companyId) {
      const company = await orgRef
        .collection(CRM_COLLECTIONS.companies)
        .doc(fields.companyId)
        .get()
      const tokens = company.exists ? (company.get('visibleTo') as string[] | undefined) : undefined
      const visible =
        company.exists &&
        canReach(writer, tokens) &&
        (!siteTokens || visibleToTokens(tokens, siteTokens))
      if (!visible) {
        res.status(404).json({ error: 'Unknown company' })
        return
      }
      linkedCompanyName = typed(company.get('name'), 120)
    }

    const contacts = orgRef.collection('contacts')
    const snapshots = await firestore.getAll(...contactIds.map((id) => contacts.doc(id)))
    const outcomes = new Map<string, ContactUpdateOutcome>()
    const writes: ContactWrite[] = []
    snapshots.forEach((snapshot, index) => {
      const contactId = contactIds[index]
      if (!snapshot.exists) {
        outcomes.set(contactId, refused(contactId, 'That contact no longer exists.'))
        return
      }
      const data = (snapshot.data() ?? {}) as Record<string, unknown>
      const visibleTo = data['visibleTo'] as string[] | undefined
      if (!canReach(writer, visibleTo)) {
        outcomes.set(contactId, refused(contactId, 'That contact is not visible to you.'))
        return
      }
      if (siteTokens && !visibleToTokens(visibleTo, siteTokens)) {
        outcomes.set(contactId, refused(contactId, 'That contact is not visible to this site.'))
        return
      }
      const group = siteGroup ?? contactPrimaryGroup(data, writer.org)
      if (!group.groupId) {
        outcomes.set(contactId, refused(contactId, NO_HOLDER_REFUSAL))
        return
      }
      const patch = contactPatch(data, group.groupId, fields, custom, linkedCompanyName)
      if ('refused' in patch) {
        outcomes.set(contactId, refused(contactId, patch.refused))
        return
      }
      outcomes.set(contactId, { contactId, ok: true })
      if (patch.update) {
        writes.push({ contactId, ref: snapshot.ref, update: patch.update, counts: patch.counts })
      }
    })

    const failed = await commitContactWrites(firestore, writes)
    for (const contactId of failed) {
      outcomes.set(contactId, refused(contactId, 'The contact could not be saved.'))
    }
    await settleCompanyCounts(
      orgRef.collection(CRM_COLLECTIONS.companies),
      writes.filter((write) => !failed.has(write.contactId)),
    )

    const answer: ContactUpdateResponse = {
      ok: true,
      results: contactIds.map(
        (contactId) => outcomes.get(contactId) ?? refused(contactId, 'The contact could not be saved.'),
      ),
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] contact-update failed', error)
    res.status(500).json({ error: 'The contact could not be saved.' })
  }
}
