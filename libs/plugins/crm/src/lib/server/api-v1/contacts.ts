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

import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import {
  type AglynPostalAddress,
  CAPTURED_BY_HOST_FIELD,
  CONTACT_COMPANY_IDS_FIELD,
  CONTACT_FACETS_FIELD,
  CONTACT_FIELDS_MAX_PER_ORG,
  CONTACT_LIFECYCLE_STAGES,
  type ConsentGroup,
  consentGroupForHost,
  type ContactCompanyLinkPlan,
  type ContactCustomValue,
  contactFacetPath,
  type ContactFieldDefinition,
  type ContactLifecycleStage,
  createResourceUid,
  CRM_COLLECTIONS,
  CRM_LEAD_SOURCE_PICKLIST,
  CRM_MEDIA_IDS_MAX,
  isContactLifecycleStage,
  MARKETING_CONSENT_BY_HOST_FIELD,
  marketingConsentFieldsForGroup,
  marketingConsentHostIds,
  normalizeAddress,
  normalizeContactEmail,
  normalizeCrmMediaIds,
  normalizePhone,
  ORG_SCOPE_TOKEN,
  planContactCompanyLink,
  readContactCompanyLink,
  readContactCustomInput,
  readContactFacet,
  soloConsentGroup,
} from '@aglyn/aglyn/server'
import {
  ApiErrors,
  apiJson,
  contactCompanyMirrorValue,
  crmRecordsQuotaForOrg,
  listResponse,
  restampCrmListFieldsAt,
  settleCompanyContactsCounts,
} from '@aglyn/tenant-data-admin'
import {
  type ApiV1Context,
  claimWrite,
  orgOwnsHost,
  paginate,
  readJsonBody,
  requireScope,
  serialize,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
// The leaf, so a spec that stands a partial barrel in still reaches it.
import { scheduleCapturedEmailCheck } from '@aglyn/tenant-data-admin/server/capture-email-check'
// The leaf, not the barrel: the console's API specs substitute the barrel
// wholesale, and the lookup must reach the real index logic under them.
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
// The leaf for the same reason: the refusals a deleted contact held must be
// kept by the real store under a spec's barrel (AGL-3338).
import {
  deleteWholeContact,
  removeContactKeepingRefusals,
} from '@aglyn/tenant-data-admin/server/retained-refusals'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { mergeContactRoute } from './contacts-merge'
import {
  CRM_ID_MAX,
  CRM_LABEL_MAX,
  createPayload,
  crmRefErrors,
  memberError,
  readChoice,
  readOptionalText,
  readOrgLeadSourcePicklist,
  readRefId,
  updatePayload,
} from './crm-shared'
import { resolveCrmPicklistWrite } from '../read-picklist'

/**
 * `/v1/contacts` (AGL-618, AGL-2276, AGL-2606): the organization's people —
 * list, read, create, update, delete, and `POST /v1/contacts/{id}/merge` —
 * served by the CRM, which keeps them. The pipeline in front of it (the key,
 * the plan's API access, the quota, the rate limit, the envelope) is the
 * console router's; the CRM suite's plan refusal is declared with the
 * registration (`declarations.console-server.ts`).
 */

// ── Contacts (read) ─────────────────────────────────────────────────────────

/**
 * The contact object as published.
 *
 * `notes` and `marketingConsent` are here because `PATCH` writes them
 * (AGL-2276). A projection that omits a field the same resource accepts is
 * the shape that has shipped broken before: the client writes, reads back,
 * sees nothing, and cannot tell a dropped write from a narrow view. Every
 * writable field appears here, and `contact-writes.spec.ts` asserts that as a
 * property of the pair rather than field by field.
 *
 * `email`, `sources` and `interactions` are read-only and stay that way —
 * `email` is the dedupe key the whole CRM unifies on, and the other two are
 * provenance. `interactions` is not published at all; the console's timeline
 * is not part of the API contract.
 */
/**
 * The CRM profile a contact carries (AGL-2606): the six fields a sales team
 * keeps on a person, read from the FACETS because that is where the console
 * keeps them — per holder, under `facets.{groupId}` (`ContactFacet`), so two
 * unrelated businesses sharing one row never read each other's knowledge of
 * the person.
 *
 * An API key is an organization credential, and every facet on the row is
 * the organization's own; so with no site named the profile is the UNION of
 * the holders — each field from the first holder, in stable id order, that
 * has set it. That is the right read for the caller a key represents (an
 * integration acting for the account) and the only one that does not force
 * every read to name a site. Naming one (`?consentSiteId=`) reads that
 * site's group alone, which is what a per-brand sync wants and what a PATCH
 * that just wrote through that site reads back.
 *
 * `null` for every unset field rather than an absent key, so a client can
 * tell "no phone" from "this API does not publish phones".
 */
const CONTACT_CRM_FIELDS = [
  'phone',
  'jobTitle',
  'companyId',
  'address',
  'ownerUid',
  'lifecycleStage',
  // The holder's Lead source, one of the org's picklist values (AGL-3511).
  'leadSource',
  // Files are a facet field like the rest (AGL-2662): an agency running two
  // client brands has one contact document between them, and a contract one
  // client filed is not the other client's to read.
  'mediaIds',
] as const

type ContactCrmField = (typeof CONTACT_CRM_FIELDS)[number]

/** The groups holding a facet on this row, in stable order. */
function contactFacetHolders(data: FirebaseFirestore.DocumentData): string[] {
  const facets = data[CONTACT_FACETS_FIELD]
  return facets && typeof facets === 'object' && !Array.isArray(facets)
    ? Object.keys(facets).sort()
    : []
}

function contactCrmProfile(
  data: FirebaseFirestore.DocumentData,
  groupId: string | null,
): Record<ContactCrmField, unknown> {
  const profile: Record<ContactCrmField, unknown> = {
    phone: null,
    jobTitle: null,
    companyId: null,
    address: null,
    ownerUid: null,
    lifecycleStage: null,
    leadSource: null,
    // An empty ARRAY rather than null, so a client can index it without a
    // guard — the same shape `custom` publishes for the same reason.
    mediaIds: [],
  }
  for (const holder of groupId ? [groupId] : contactFacetHolders(data)) {
    const facet = readContactFacet(data, holder)
    for (const field of CONTACT_CRM_FIELDS) {
      const value = facet[field]
      if (field === 'mediaIds') {
        // The union of every holder's attachments when no site was named,
        // and one holder's when one was — the same rule the scalar fields
        // follow, spelled apart because a list merges rather than wins.
        const held = profile[field] as string[]
        if (!held.length) profile[field] = normalizeCrmMediaIds(value)
        continue
      }
      if (profile[field] === null && value !== undefined && value !== null) {
        profile[field] = value
      }
    }
  }
  return profile
}

/**
 * @param groupId - the holder whose CRM profile to publish, or `null` for
 *   the union — see {@link contactCrmProfile}.
 */
function contactView(
  doc: FirebaseFirestore.DocumentSnapshot,
  groupId: string | null = null,
) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'contact',
    email: data.email ?? null,
    name: data.name ?? null,
    tags: data.tags ?? [],
    notes: data.notes ?? null,
    ...contactCrmProfile(data, groupId),
    // Every company any holder has filed the person under — the top-level
    // twin of the facets' `companyId`, and what `?companyId=` queries.
    companyIds: Array.isArray(data.companyIds)
      ? data.companyIds.filter((id: unknown) => typeof id === 'string')
      : [],
    // The other addresses a merge folded into this record (AGL-2625) —
    // identity like `email`, and read-only for the same reason.
    alternateEmails: Array.isArray(data.alternateEmails)
      ? data.alternateEmails.filter((email: unknown) => typeof email === 'string')
      : [],
    /*
     * TRUE means "some site may mail this person", and `consentSites` says
     * which. A single boolean is what the org-wide model published, and it is
     * exactly the claim that turned out to be wrong: an agency's key read
     * `true` and could not tell which of its brands the person had agreed to
     * hear from. Both are published so a client can act on either.
     */
    marketingConsent:
      data.marketingConsent === false
        ? false
        : marketingConsentHostIds(data).length > 0,
    consentSites: marketingConsentHostIds(data),
    sources: data.sources ? Object.keys(data.sources) : [],
    /*
     * The org's custom field values, keyed by field key (AGL-2601). The same
     * top-level map `tags` and `notes` beside it are read from — this resource
     * is the ORGANIZATION's view, and its writes land there. An empty object
     * rather than `null`, so a client can index it without a guard.
     */
    custom:
      data.custom && typeof data.custom === 'object' && !Array.isArray(data.custom)
        ? (data.custom as Record<string, ContactCustomValue>)
        : {},
    created: serialize(data.createdAt) ?? null,
    updated: serialize(data.updatedAt) ?? null,
  }
}

/**
 * The org's custom field definitions, retired ones included, for the API's
 * `custom` validation (AGL-2601).
 *
 * One bounded read of a small collection, paid only when a body carries
 * `custom` — the reader is called from the two writers, never from the view.
 * Retired definitions come back too because `readContactCustomInput` refuses
 * a write under one BY NAME, which is a better answer than "no such field"
 * for a key the integration wrote last month.
 */
async function readOrgContactFieldDefinitions(
  ctx: ApiV1Context,
): Promise<ContactFieldDefinition[]> {
  const snapshot = await ctx.firestore
    .collection('orgs')
    .doc(ctx.orgId)
    .collection(CRM_COLLECTIONS.contactFields)
    .orderBy(FieldPath.documentId())
    .limit(CONTACT_FIELDS_MAX_PER_ORG)
    .get()
  return snapshot.docs.map((doc) => doc.data() as ContactFieldDefinition)
}

const CONTACT_NAME_MAX = 120
const CONTACT_NOTES_MAX = 2000
const CONTACT_TAGS_MAX = 50
const CONTACT_TAG_MAX = 60

/** Fields a client may send. Anything else is named, never silently dropped. */
const CONTACT_WRITABLE = [
  'name',
  'tags',
  'notes',
  'marketingConsent',
  'consentSiteId',
  'consentGroupId',
  'custom',
] as const

/**
 * The sites an API opt-in is recorded for (AGL-3320): the named site's whole
 * consent group only when the body ECHOED that group's id, and the site
 * alone otherwise.
 *
 * An integration's own signup form is a capture surface this platform never
 * sees, so it cannot prove which sentence it showed the way a Form block
 * does. Echoing the group's id is the integration saying it showed the
 * group's name; an opt-in that says nothing about the group, or names one
 * the site is no longer in, is the one site's — narrow, which is the safe
 * way to be wrong, and visible in the response's `consentSites`.
 */
function apiGrantGroup(
  ctx: ApiV1Context,
  siteId: string,
  echoedGroupId: string | undefined,
): ConsentGroup {
  const group = consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
  return group.declared && echoedGroupId === group.groupId
    ? group
    : soloConsentGroup(siteId)
}

/**
 * Validate the writable half of a contact (AGL-2276). `partial` separates
 * PATCH from POST exactly as `readDatasetInput` does: a create must carry an
 * `email`, an update may send any one field alone and leaves the rest alone.
 *
 * Unknown keys are REFUSED rather than dropped, following
 * `updateFormSubmission` and not `createRecord`: a record has a dataset model
 * that defines what exists, and a contact does not, so a silent drop would
 * read as "we stored your correction" when nothing was stored. `email` gets
 * its own message on PATCH because sending it is the honest mistake an
 * integrator makes first — it is the field their own system keys on.
 */
/**
 * The CRM profile fields a contact write may carry (AGL-2606), each `null`
 * to clear. A `type` rather than an `interface` so it is a
 * `Record<string, unknown>` to the payload helpers without a cast.
 */
type ContactCrmInput = {
  phone?: string | null
  jobTitle?: string | null
  companyId?: string | null
  address?: AglynPostalAddress | null
  ownerUid?: string | null
  lifecycleStage?: ContactLifecycleStage | null
  /** A value of the org's Lead source picklist, judged by the writer (AGL-3511). */
  leadSource?: string | null
  /** Org-library files attached by this holder (AGL-2662), by media id. */
  mediaIds?: string[]
}

function readContactInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
):
  | {
      values: {
        email?: string
        name?: string
        tags?: string[]
        notes?: string
        marketingConsent?: boolean
        consentSiteId?: string
        /** The consent group the opt-in was disclosed under (AGL-3320). */
        consentGroupId?: string
        /**
         * The `custom` map as SENT, shape-checked only. Its keys and values
         * are judged against the org's definitions by the writer, which is
         * the side holding a Firestore handle (AGL-2601).
         */
        custom?: Record<string, unknown>
        crm: ContactCrmInput
      }
    }
  | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: {
    email?: string
    name?: string
    tags?: string[]
    notes?: string
    marketingConsent?: boolean
    consentSiteId?: string
    consentGroupId?: string
    custom?: Record<string, unknown>
    crm: ContactCrmInput
  } = { crm: {} }

  const allowed = new Set<string>([
    ...CONTACT_WRITABLE,
    ...CONTACT_CRM_FIELDS,
    ...(partial ? [] : ['email']),
  ])
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) continue
    errors[key] =
      key === 'email'
        ? 'Not writable — a contact is identified by its email'
        : key === 'sources' || key === 'interactions'
          ? 'Not writable — set by the capture point that recorded it'
          : 'Not writable on a contact'
  }

  if (!partial) {
    // The SAME normalizer every capture point uses. Re-implementing the
    // check here would let the API accept an address `upsertHostContact`
    // would reject, and the two would then disagree about who is a duplicate.
    const email = normalizeContactEmail(body.email)
    if (!email) errors.email = 'A valid email address is required'
    else values.email = email
  }

  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim().slice(0, CONTACT_NAME_MAX)
    if (name) values.name = name
    else errors.name = 'Must not be empty'
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      errors.tags = 'Must be an array of strings'
    } else {
      // An EMPTY array is legal and means "clear the tags" — the console's
      // own tag editor can empty the field, and an API that could only ever
      // add tags would leave an integration unable to undo its own mistake.
      values.tags = (body.tags as unknown[])
        .map((tag) => String(tag).trim().slice(0, CONTACT_TAG_MAX))
        .filter((tag) => tag.length > 0)
        .slice(0, CONTACT_TAGS_MAX)
    }
  }

  if (body.notes !== undefined) {
    values.notes = String(body.notes ?? '').slice(0, CONTACT_NOTES_MAX)
  }

  if (body.consentSiteId !== undefined) {
    const siteId = String(body.consentSiteId ?? '').trim()
    if (!siteId) errors.consentSiteId = 'Must name a site'
    else values.consentSiteId = siteId
  }

  if (body.consentGroupId !== undefined) {
    const groupId =
      typeof body.consentGroupId === 'string' ? body.consentGroupId.trim() : ''
    if (!groupId) errors.consentGroupId = 'Must name a consent group'
    else values.consentGroupId = groupId
  }

  if (body.marketingConsent !== undefined) {
    if (typeof body.marketingConsent !== 'boolean') {
      errors.marketingConsent = 'Must be true or false'
    } else {
      values.marketingConsent = body.marketingConsent
    }
  }

  if (body.custom !== undefined) {
    if (!body.custom || typeof body.custom !== 'object' || Array.isArray(body.custom)) {
      errors.custom = 'Must be an object of field values keyed by field key'
    } else {
      values.custom = body.custom as Record<string, unknown>
    }
  }

  /*
   * The CRM profile (AGL-2606). Each value runs through the normalizer the
   * console writes with — `normalizePhone`, `normalizeAddress`, the lifecycle
   * list — so the API cannot store a phone the console would refuse, or an
   * address of empty strings the console would read as "has an address". A
   * value that does not survive names the field rather than storing the raw
   * string: a half-normalized phone is the unusable number `normalizePhone`
   * exists to end. The readers are `crm-shared`'s, so a contact and a company
   * bound their text the same way. `ownerUid` and `companyId` are checked for
   * existence by the caller, after this synchronous pass, so a body already
   * refused never spends the reads.
   */
  const crm: ContactCrmInput = {}
  const phone = readOptionalText(body, 'phone', CRM_LABEL_MAX, errors)
  if (phone === null) {
    crm.phone = null
  } else if (phone !== undefined) {
    const normalized = normalizePhone(phone)
    if (normalized) crm.phone = normalized
    else errors.phone = 'Must be a phone number with a country code, like +15125550123'
  }
  const jobTitle = readOptionalText(body, 'jobTitle', CONTACT_NAME_MAX, errors)
  if (jobTitle !== undefined) crm.jobTitle = jobTitle
  const companyId = readRefId(body, 'companyId', errors)
  if (companyId !== undefined) crm.companyId = companyId
  if (body.address !== undefined) {
    if (body.address === null) {
      crm.address = null
    } else if (typeof body.address !== 'object' || Array.isArray(body.address)) {
      errors.address = 'Must be an address object'
    } else {
      // A blank address normalizes to `null`, which clears.
      crm.address = normalizeAddress(body.address as AglynPostalAddress)
    }
  }
  const ownerUid = readOptionalText(body, 'ownerUid', CONTACT_NAME_MAX, errors)
  if (ownerUid !== undefined) crm.ownerUid = ownerUid
  // Shape only here; the org's list judges the value in `contactCrmRefErrors`.
  const leadSource = readOptionalText(body, 'leadSource', CRM_LABEL_MAX, errors)
  if (leadSource !== undefined) crm.leadSource = leadSource
  if (body.mediaIds !== undefined) {
    if (!Array.isArray(body.mediaIds)) {
      errors.mediaIds = 'Must be an array of media ids'
    } else if (body.mediaIds.length > CRM_MEDIA_IDS_MAX) {
      errors.mediaIds = `At most ${CRM_MEDIA_IDS_MAX} files may be attached`
    } else {
      // The SAME normalizer the console card writes through. An empty array
      // is legal and clears this holder's attachments.
      crm.mediaIds = normalizeCrmMediaIds(body.mediaIds)
    }
  }
  if (body.lifecycleStage === null) {
    crm.lifecycleStage = null
  } else {
    const stage = readChoice(body, 'lifecycleStage', CONTACT_LIFECYCLE_STAGES, errors)
    if (stage) crm.lifecycleStage = stage
  }
  values.crm = crm
  // Whether the body MEANT to write a profile — judged by the keys it sent,
  // not by which of them parsed, so a body whose every profile value was
  // refused is told about those values and not also that its site was
  // unwelcome.
  const writesCrm = CONTACT_CRM_FIELDS.some((field) => body[field] !== undefined)

  /*
   * AN OPT-IN MUST NAME THE SITE IT WAS GIVEN TO; A REFUSAL MUST NOT.
   *
   * An API key belongs to an ORGANIZATION, and an organization is not a
   * controller — an agency's key reaches every client brand it runs. So an
   * integration asserting that somebody opted in has to say which brand they
   * opted in to, exactly as a form does by being served from one site. There
   * is no safe default: picking the org's only site works until the org has
   * two, and picking none is the org-wide grant this field exists to stop.
   *
   * A refusal is the mirror image and is refused a site on purpose. It
   * applies to every brand in the account, which is what `readMarketingBasis`
   * does with an unscoped `false`, and accepting a site alongside it would
   * imply a per-brand opt-out this endpoint does not write.
   */
  if (values.marketingConsent === true && !values.consentSiteId) {
    errors.consentSiteId =
      'Required with marketingConsent: true — name the site the person opted in to'
  }
  /*
   * A CRM PROFILE FIELD NAMES THE SITE TOO (AGL-2606), for the facet's
   * reason: the profile is one holder's knowledge of the person and lives
   * under that holder's group, so a write has to say whose. The same
   * parameter, because it is the same question — which of the organization's
   * sites is this write made on behalf of — and an integrator should not
   * learn two names for it. Beside a refusal the site is accepted, since the
   * refusal still applies to every site and the site now names the facet.
   */
  if (writesCrm && !values.consentSiteId) {
    errors.consentSiteId =
      'Required with a CRM profile field — name the site whose profile of this person to write'
  }
  if (values.marketingConsent === false && values.consentSiteId && !writesCrm) {
    errors.consentSiteId =
      'Not accepted with marketingConsent: false — a refusal applies to every site'
  }
  if (values.consentSiteId && values.marketingConsent === undefined && !writesCrm) {
    errors.consentSiteId =
      'Only accepted alongside marketingConsent or a CRM profile field'
  }
  /*
   * THE GROUP IS ECHOED ONLY BESIDE AN OPT-IN (AGL-3320). It says which
   * disclosure the person saw, so it widens a grant to the site's consent
   * group and means nothing anywhere else — least of all beside a refusal,
   * which already stands against every site.
   */
  if (values.consentGroupId && values.marketingConsent !== true) {
    errors.consentGroupId =
      'Only accepted with marketingConsent: true — name the consent group the person was shown'
  }

  return Object.keys(errors).length ? { errors } : { values }
}


/**
 * The two references a contact's CRM profile can carry, checked for
 * existence — the SAME checks a deal or a task makes on its own `ownerUid`
 * and `companyId`, so a contact cannot point at a company `/v1/deals` would
 * refuse. Run after the synchronous grammar, so a body already refused never
 * spends the reads.
 */
async function contactCrmRefErrors(
  ctx: ApiV1Context,
  crm: ContactCrmInput,
  currentLeadSource?: unknown,
): Promise<Record<string, string>> {
  const [owner, refs, leadSource] = await Promise.all([
    memberError(ctx, 'ownerUid', crm.ownerUid),
    crmRefErrors(ctx, { companyId: crm.companyId ?? undefined }),
    contactLeadSourceErrors(ctx, crm, currentLeadSource),
  ])
  return { ...owner, ...refs, ...leadSource }
}

/**
 * The lead source a contact write stores (AGL-3511), judged against the
 * org's Lead source list exactly as a lead's is: an active value stores the
 * list's spelling, the holder's current value is always kept, and anything
 * else is refused naming what the list allows. Rewrites `crm.leadSource` to
 * the label the list spells. A contact takes no default — the list's default
 * is for a new LEAD.
 */
async function contactLeadSourceErrors(
  ctx: ApiV1Context,
  crm: ContactCrmInput,
  current: unknown,
): Promise<Record<string, string>> {
  if (typeof crm.leadSource !== 'string') return {}
  const resolved = resolveCrmPicklistWrite(
    CRM_LEAD_SOURCE_PICKLIST,
    await readOrgLeadSourcePicklist(ctx),
    crm.leadSource,
    { current, created: false },
  )
  if (resolved.ok === false) return { leadSource: resolved.error }
  crm.leadSource = resolved.write ?? null
  return {}
}

/**
 * The facet a create writes when the body carried a CRM profile field, under
 * the group of the site the write named — filed as `upsertHostContact` files
 * a capture — plus the top-level `companyIds` the company filter queries.
 *
 * A NESTED object rather than dotted paths, because this is a `create()` and
 * there is no other holder's facet on the row to clobber yet.
 * {@link contactCrmUpdateFields} writes the same fields as paths for the
 * opposite reason.
 */
function contactCrmCreateFields(
  ctx: ApiV1Context,
  crm: ContactCrmInput,
  siteId: string,
): Record<string, unknown> {
  const stored = createPayload(crm)
  if (Object.keys(stored).length === 0) return {}
  const group = consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
  return {
    [CONTACT_FACETS_FIELD]: {
      [group.groupId]: { sources: { api: true }, interactions: [], ...stored },
    },
    ...(crm.companyId ? { companyIds: [crm.companyId] } : {}),
  }
}

/**
 * The CRM profile as an `update()` payload: one dotted path per field sent,
 * under the facet of the named site's group — `contactFacetPath`, never a
 * nested object, because an `update` REPLACES a map it is handed whole and
 * the nested form would delete every other holder's profile of the person.
 * `null` becomes a field delete, so a PATCH can clear.
 *
 * `companyIds` is the top-level twin of the facets' `companyId`s, kept so
 * `?companyId=` can be one indexed clause. Which ids it keeps is the CRM's
 * one planner's decision (`planContactCompanyLink`, AGL-2613): the old id
 * leaves only when no OTHER holder still files the person under it, an id
 * some other surface put there is left exactly where it was, and the plan
 * also names the companies whose contacts count the write moves — which the
 * caller settles after the contact is written, because they are other
 * documents.
 */
function contactCrmUpdateFields(
  ctx: ApiV1Context,
  data: FirebaseFirestore.DocumentData,
  crm: ContactCrmInput,
  siteId: string,
): { update: Record<string, unknown>; link: ContactCompanyLinkPlan | null } {
  const update: Record<string, unknown> = {}
  const group = consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
  for (const [field, value] of Object.entries(updatePayload(crm))) {
    update[contactFacetPath(group.groupId, field)] = value
  }
  let link: ContactCompanyLinkPlan | null = null
  if (crm.companyId !== undefined) {
    link = planContactCompanyLink(
      readContactCompanyLink(data, group.groupId),
      crm.companyId,
    )
    const mirror = link ? contactCompanyMirrorValue(link) : undefined
    if (mirror !== undefined) update[CONTACT_COMPANY_IDS_FIELD] = mirror
  }
  return { update, link }
}

/**
 * The holder a contact READ is for, from `?consentSiteId=`: that site's
 * consent group, or `null` for the union view. The parameter the writes take,
 * validated the same way, so a client has one name for "which site" on every
 * contact call.
 */
function contactViewGroup(
  ctx: ApiV1Context,
  url: URL,
): { groupId: string | null } | { response: Response } {
  const siteId = (url.searchParams.get('consentSiteId') ?? '').trim()
  if (!siteId) return { groupId: null }
  if (!orgOwnsHost(ctx, siteId)) {
    return {
      response: ApiErrors.badRequest({
        message: 'Contact filter failed validation',
        code: 'validation_failed',
        fields: { consentSiteId: 'No such site in this organization' },
        headers: ctx.headers,
      }),
    }
  }
  return {
    groupId: consentGroupForHost(ctx.org as Record<string, unknown>, siteId)
      .groupId,
  }
}

const contactsCollection = (ctx: ApiV1Context) =>
  ctx.firestore.collection('orgs').doc(ctx.orgId).collection('contacts')

/** The org's companies, beside its contacts — where a link's count lands (AGL-2613). */
const companiesCollection = (ctx: ApiV1Context) =>
  ctx.firestore.collection('orgs').doc(ctx.orgId).collection(CRM_COLLECTIONS.companies)

/**
 * `POST /v1/contacts` (AGL-2276) — the call that lets an integration own the
 * customer list.
 *
 * ## The audience band
 *
 * `checkContactQuota` is the gate, and it is the SAME one `upsertHostContact`
 * applies to a form capture (AGL-890). Metered plans always create and bill
 * the overage through the `report-usage` rollup, which counts
 * `orgs/{orgId}/contacts` without caring who wrote them — so an API-created
 * contact meters exactly like a captured one, and there is no unbilled door.
 * Free hard-bands at its included count; free cannot reach `/v1` at all
 * without a staff `features.apiAccess` override, which is precisely the shape
 * AGL-2163 found running unbounded, so the gate is here rather than assumed
 * unreachable.
 *
 * Where capture DROPS a refused contact (silently, onto a
 * `counters/contactsDropped` the console alerts on), this refuses out loud
 * with a `403`: a form must never fail a visitor's signup because of billing,
 * and an API call has an operator on the other end who needs to be told.
 *
 * ## Duplicates
 *
 * A contact is unified on its normalized email, so a second create for an
 * address already present is a `409 conflict` naming the existing id rather
 * than a second row. Silently upserting instead would hide a real integration
 * bug — two upstream systems both claiming to own the record — and would make
 * `POST` and `PATCH` the same call.
 *
 * ## Why the claim is taken ABOVE both refusals
 *
 * `createRecord` and `createDataset` check their quota FIRST and claim after,
 * so that a plan refusal never burns a key. That ordering has a hole this one
 * deliberately does not copy, and `api-v1-contact-writes.spec.ts` is what
 * found it: **a create that exactly fills the band cannot be retried.** The
 * first call succeeds and consumes the last slot; the retry — same key, lost
 * response — re-counts, is now AT the band, and gets a `403` instead of the
 * replay `conventions.md` promises ("if the original succeeded, the same
 * response comes back"). The integrator is left unable to tell whether the
 * contact exists, which is the exact confusion the key exists to remove. The
 * duplicate check has the same shape, and worse: the retry's own successful
 * write is what makes the email a duplicate, so EVERY retry of a successful
 * create would answer `409 contact_exists`.
 *
 * Claiming first and RELEASING on each refusal gets both properties at once:
 * a settled key replays before any of this is reached, and a refusal gives
 * the key back so the retry that should finally succeed still can. It is the
 * ordering `deleteRecord` already argues for, and it pays the same price —
 * taking-and-releasing on a genuine refusal. AGL-2278 applies it to the two
 * older creates.
 *
 * `visibleTo` is stamped with `ORG_SCOPE_TOKEN`, as capture does. A contact
 * written without it matches no `array-contains-any` and is therefore visible
 * on NO site (AGL-1044) — the API would create data nobody can see, which is
 * worse than refusing.
 */
async function createContact(
  request: Request,
  ctx: ApiV1Context,
): Promise<Response> {
  // Validation stays above the claim, as `createRecord` argues: a
  // deterministic 400 must never take the key at all, so an integrator fixes
  // the payload and retries with the same one.
  const parsed = readContactInput(await readJsonBody(request), {
    partial: false,
  })
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }
  const {
    email,
    name,
    tags,
    notes,
    marketingConsent,
    consentSiteId,
    consentGroupId,
    crm,
  } = parsed.values
  if (consentSiteId && !orgOwnsHost(ctx, consentSiteId)) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: { consentSiteId: 'No such site in this organization' },
      headers: ctx.headers,
    })
  }
  // Judged against the org's definitions, above the claim like every other
  // deterministic 400: an unknown key is named, never dropped (AGL-2601).
  const custom = parsed.values.custom
    ? readContactCustomInput(
        parsed.values.custom,
        await readOrgContactFieldDefinitions(ctx),
      )
    : null
  if (custom && 'errors' in custom) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: custom.errors,
      headers: ctx.headers,
    })
  }
  // Resolved to the map itself here, above the claim, because the create
  // below is reached through a try block the narrowing above does not
  // survive; an empty map writes no `custom` key at all.
  const customValues = custom && 'values' in custom ? custom.values : {}
  // Still validation, still above the claim: a dangling `companyId` is as
  // deterministic a 400 as a malformed one, and must not burn the key.
  const crmErrors = await contactCrmRefErrors(ctx, crm)
  if (Object.keys(crmErrors).length) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: crmErrors,
      headers: ctx.headers,
    })
  }

  const collection = contactsCollection(ctx)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'contacts',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    // Through the org's address index (AGL-2633): an address a merge folded
    // into another record is that record's, and a create on it would mint
    // the duplicate the merge removed.
    const existing = await findContactByEmail(collection, email)
    if (existing) {
      // Released: the conflict clears if that contact is deleted or merged
      // upstream, and the retry that should then succeed must not replay it.
      await claim.release()
      return ApiErrors.conflict({
        message: `A contact with this email already exists (${existing.id}). Update it instead.`,
        code: 'contact_exists',
        headers: ctx.headers,
      })
    }

    // Three aggregate reads, the same ones `upsertHostContact` and the
    // monthly rollup take — the band counts companies and deals beside the
    // contacts (AGL-2611). Unconditional, matching `createDataset` — the
    // alternative is a per-plan shape check like `dataStorageEnforcementShape`,
    // and a `count()` costs one read against a write that costs one anyway.
    const quota = await crmRecordsQuotaForOrg(
      ctx.org as never,
      ctx.firestore.collection('orgs').doc(ctx.orgId),
      collection,
    )
    if (!quota.allowed) {
      await claim.release()
      // `contact_quota` is the code this endpoint has always answered with
      // and integrators match on it; the band behind it widened, the code
      // did not. Companies and deals answer `crm_records_quota`.
      return ApiErrors.planRequired({
        message:
          `CRM records limit reached (${quota.included} records across ` +
          'contacts, companies and deals). Upgrade the plan to add more.',
        code: 'contact_quota',
        headers: ctx.headers,
      })
    }

    const id = createResourceUid()
    await collection.doc(id).create({
      email,
      // The search keys travel with the name — the console's contact list
      // searches the whole collection, not the page it fetched.
      ...(name ? nameSearchFields(name) : {}),
      tags: tags ?? [],
      ...(notes ? { notes } : {}),
      ...(Object.keys(customValues).length ? { custom: customValues } : {}),
      ...(marketingConsent && consentSiteId
        ? {
            // The named site, or its whole declared consent group when the
            // body echoed the group it showed the person (AGL-3320).
            ...marketingConsentFieldsForGroup(
              apiGrantGroup(ctx, consentSiteId, consentGroupId),
              Date.now(),
            ),
          }
        : {}),
      [CAPTURED_BY_HOST_FIELD]: consentSiteId ? [consentSiteId] : [],
      // A refusal carries no site: it stands against every brand in the
      // account — see `readMarketingBasis` for the asymmetry.
      ...(marketingConsent === false ? { marketingConsent: false } : {}),
      // The CRM profile, when the body carried one — under the named site's
      // facet, which `readContactInput` has already required it to name.
      ...(consentSiteId ? contactCrmCreateFields(ctx, crm, consentSiteId) : {}),
      // `sources.api` — a first-class provenance value beside `form`,
      // `member`, `order` and `booking`, so a merchant reading the console
      // can see which people an integration put there.
      sources: { api: true },
      interactions: [],
      // Nothing is scheduled against a new person, which the console's
      // "No next activity" filter asks as `null` (AGL-3321).
      nextTaskAtMs: null,
      // AGL-1044/AGL-1037: without this the contact matches no scoped read.
      visibleTo: [ORG_SCOPE_TOKEN],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    // What the console's Contacts list searches and filters by (AGL-3321),
    // from the row as it was created, nested facet and all.
    await restampCrmListFieldsAt(collection.doc(id), 'contacts')
    // The address's domain, checked after the response (AGL-3328): a domain
    // that takes no mail makes the new contact read "Would bounce".
    scheduleCapturedEmailCheck({ orgId: ctx.orgId, email })
    // The company the body named has one more contact naming it (AGL-2613);
    // a fresh row's plan is the trivial one, and `crmRefErrors` has already
    // required the company to exist.
    if (consentSiteId && crm.companyId) {
      await settleCompanyContactsCounts(
        companiesCollection(ctx),
        planContactCompanyLink(
          { companyId: null, companyIds: [], heldElsewhere: [] },
          crm.companyId,
        ),
      )
    }
    const view = contactView(await collection.doc(id).get())
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * `PATCH /v1/contacts/{id}` — the tag/notes edit the console's Contacts page
 * already makes, plus the name and the marketing flag.
 *
 * No `Idempotency-Key`, for `updateRecord`'s reason: the same body twice
 * lands the same state AND returns the same `200`. No quota either — an edit
 * does not grow the audience, and charging a plan refusal for renaming
 * somebody would make a downgraded org unable to correct its own data.
 */
async function updateContact(
  request: Request,
  ctx: ApiV1Context,
  contactRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const parsed = readContactInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }
  const snap = await contactRef.get()
  if (!snap.exists) {
    return ApiErrors.notFound({
      message: 'No such contact',
      headers: ctx.headers,
    })
  }

  const {
    name,
    tags,
    notes,
    marketingConsent,
    consentSiteId,
    consentGroupId,
    crm,
  } = parsed.values
  if (consentSiteId && !orgOwnsHost(ctx, consentSiteId)) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: { consentSiteId: 'No such site in this organization' },
      headers: ctx.headers,
    })
  }
  // The holder's current lead source is kept even when the list no longer offers it.
  const currentLeadSource = consentSiteId
    ? readContactFacet(
        snap.data() ?? {},
        consentGroupForHost(ctx.org as Record<string, unknown>, consentSiteId).groupId,
      ).leadSource
    : undefined
  const crmErrors = await contactCrmRefErrors(ctx, crm, currentLeadSource)
  if (Object.keys(crmErrors).length) {
    return ApiErrors.badRequest({
      message: 'Contact failed validation',
      code: 'validation_failed',
      fields: crmErrors,
      headers: ctx.headers,
    })
  }
  const update: Record<string, unknown> = {}
  // A rename must move the search keys with it, or the contact stays findable
  // only by the name they no longer have.
  if (name !== undefined) Object.assign(update, nameSearchFields(name))
  if (tags !== undefined) update.tags = tags
  if (notes !== undefined) update.notes = notes
  if (parsed.values.custom !== undefined) {
    const custom = readContactCustomInput(
      parsed.values.custom,
      await readOrgContactFieldDefinitions(ctx),
    )
    if ('errors' in custom) {
      return ApiErrors.badRequest({
        message: 'Contact failed validation',
        code: 'validation_failed',
        fields: custom.errors,
        headers: ctx.headers,
      })
    }
    /*
     * One dotted path per key, because this is an `update` and an `update`
     * REPLACES a map it is handed whole. `custom` on a PATCH means "these
     * keys", the way the console's own save writes only the keys that
     * changed; an integration correcting one value must not have to resend
     * the other nine to keep them (AGL-2601).
     */
    for (const [key, value] of Object.entries(custom.values)) {
      update[`custom.${key}`] = value
    }
  }
  if (marketingConsent === true && consentSiteId) {
    /*
     * A dotted path rather than a nested object, because this is an `update`
     * and an `update` REPLACES a map field it is handed whole. Writing the
     * nested form here would delete every other site's grant — the exact
     * over-application this change exists to end, arriving through the write
     * side instead of the read side.
     */
    // The named site, or its whole declared consent group when the body
    // echoed the group it showed the person (AGL-3320).
    const group = apiGrantGroup(ctx, consentSiteId, consentGroupId)
    for (const hostId of group.hostIds) {
      update[`${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}`] = {
        marketingConsent: true,
        // The consent timestamp is the evidence, so it is stamped when
        // consent is GIVEN and left alone when it is withdrawn — an audit
        // needs to know when the person opted in, and clearing it would
        // destroy that record.
        marketingConsentAtMs: Date.now(),
        ...(group.declared
          ? {
              consentGroupId: group.groupId,
              consentGroupName: group.name ?? '',
            }
          : {}),
      }
    }
  } else if (marketingConsent === false) {
    update.marketingConsent = false
  }
  let link: ContactCompanyLinkPlan | null = null
  if (consentSiteId) {
    const crmFields = contactCrmUpdateFields(ctx, snap.data() ?? {}, crm, consentSiteId)
    Object.assign(update, crmFields.update)
    link = crmFields.link
  }
  // An empty body is a no-op answered with the current contact, matching
  // `updateDataset`: a client re-sending an unchanged object should not have
  // to special-case it.
  if (Object.keys(update).length > 0) {
    await contactRef.update({ ...update, updatedAt: Timestamp.now() })
    // What the console's Contacts list searches and filters by (AGL-3321).
    await restampCrmListFieldsAt(contactRef, 'contacts')
    // The companies the link moved off or onto, counted after the contact
    // is written (AGL-2613); `crmRefErrors` has already required the new
    // company to exist.
    await settleCompanyContactsCounts(companiesCollection(ctx), link)
  }
  // Read back through the site the write named, so what the client sees is
  // the profile it just wrote and not another holder's.
  const groupId = consentSiteId
    ? consentGroupForHost(ctx.org as Record<string, unknown>, consentSiteId)
        .groupId
    : null
  return apiJson(contactView(await contactRef.get(), groupId), {
    headers: ctx.headers,
  })
}

/**
 * `DELETE /v1/contacts/{id}` — the console's own delete, over the API.
 *
 * Deletes the document whoever else holds it, and keeps every refusal it
 * held — each site's and the unscoped one — in the organization's retained
 * store in the same transaction (AGL-3338), so deleting a person over the
 * API is not a way to add somebody who said no to a list.
 *
 * Takes an `Idempotency-Key` with `deleteRecord`'s exact semantics, and for a
 * sharper reason: an erasure request is the operation most likely to be run
 * from a script on somebody else's deadline, and a retry after a lost
 * response must be able to tell "already erased" from "wrong id".
 */
async function deleteContact(
  request: Request,
  ctx: ApiV1Context,
  contactRef: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'contact-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const removed = await removeContactKeepingRefusals({
      contactRef,
      decide: deleteWholeContact,
      nowMs: Date.now(),
    })
    if (removed.outcome === 'missing') {
      await claim.release()
      return ApiErrors.notFound({
        message: 'No such contact',
        headers: ctx.headers,
      })
    }
    const view = { id: contactRef.id, object: 'contact', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * `GET /v1/contacts` filters (AGL-2460) — the lookup a sync starts with.
 *
 * The list was ordered by document id with no filter of any kind, which left
 * the first question every CRM, mailing tool or migration asks — "do I
 * already have this person?" — answerable only by paging the whole audience.
 * That is not a rounding error. Contacts are ORGANIZATION-wide (AGL-237), so
 * the list is the entire audience band; every page is a BILLED request
 * (`recordApiRequest`) against a documented 120/min per-key ceiling. Finding
 * one address in a 50k audience cost ~500 requests and four minutes, and the
 * integration that gave up and called `POST` instead recovered the id by
 * regex over the `409 contact_exists` sentence — parsing a human message for
 * an identifier, which is not a contract this API should have been offering.
 *
 * Both filters REDUCE work rather than adding it: one indexed lookup replaces
 * a full sweep, so this NARROWS the per-request Firestore read amplification
 * AGL-2414 is about rather than widening it. Neither introduces a new metered
 * dimension — a filtered list is the same billed request the unfiltered one
 * always was, and the customer simply needs far fewer of them.
 *
 * ## `email` runs through the writer's own normalizer
 *
 * `normalizeContactEmail` is the SAME function `createContact` stores
 * through. Matching the raw query string instead would make
 * `?email=Avery@Example.com` answer "no such contact" while `POST` with that
 * identical address answers `409 contact_exists` naming its id — two
 * endpoints disagreeing about whether a person exists, which an integrator
 * reasonably reads as our data being corrupt rather than as our having two
 * spellings of one address.
 *
 * A value that cannot normalize is a `400` naming the field, not an empty
 * page. Every stored email is normalized and pattern-valid, so nothing can
 * match a malformed one and an empty page would be perfectly TRUE and
 * perfectly useless: it is indistinguishable from "we don't have them", and
 * it sends the caller hunting a missing person instead of a typo.
 *
 * ## `email` is a lookup, not a clause
 *
 * The address goes through the org's address index (AGL-2633) — the same
 * lookup every capture door makes — so an address a merge folded into a
 * record as an alternate finds that record, which is the answer `POST`
 * gives when it refuses the same address as a duplicate. One address names
 * one document, so the page is that document or nothing and never carries
 * a cursor.
 *
 * ## Why the COMBINATION filters after the read
 *
 * An `array-contains` on `tags` and the `orderBy(FieldPath.documentId())`
 * every list applies is already a two-clause query; a third would need a
 * composite index we would have to ship and wait on. The address selects at
 * most one document, and a company selects a short page — testing those
 * rows' tags in memory costs nothing and needs no index. The page can
 * therefore come back empty with `has_more` false, which is the short-page
 * case `conventions.md` already tells clients to expect and which
 * `?channel=online` on orders already produces.
 */
async function listContacts(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const rawEmail = url.searchParams.get('email')
  let email: string | null = null
  if (rawEmail !== null && rawEmail.trim() !== '') {
    email = normalizeContactEmail(rawEmail)
    if (!email) {
      return ApiErrors.badRequest({
        message: 'Contact filter failed validation',
        code: 'validation_failed',
        fields: { email: 'Must be a valid email address' },
        headers: ctx.headers,
      })
    }
  }
  // Trimmed and capped exactly as `readContactInput` stores a tag, so a
  // filter cannot ask for a string the write path could never have written.
  const rawTag = url.searchParams.get('tag')
  const tag =
    rawTag === null ? null : rawTag.trim().slice(0, CONTACT_TAG_MAX) || null

  /*
   * The CRM filters (AGL-2606). `companyId` can be a clause: it queries the
   * top-level `companyIds` array, the twin every profile write keeps for
   * exactly this. `lifecycleStage` and `ownerUid` cannot — they live on a
   * facet, and a facet field is not queryable without the holder in the
   * path, which the org-wide read does not have — so both are applied to the
   * page, against the SAME profile the view publishes: the named site's, or
   * the union. A filtered page can therefore come back short, as `?email=`
   * with `?tag=` already does. A stage that is not one of the list is a
   * `400`, because `?lifecycleStage=customers` matching nothing is the
   * plausible empty page the conventions refuse to serve.
   */
  const rawStage = (url.searchParams.get('lifecycleStage') ?? '').trim()
  if (rawStage && !isContactLifecycleStage(rawStage)) {
    return ApiErrors.badRequest({
      message: 'Contact filter failed validation',
      code: 'validation_failed',
      fields: {
        lifecycleStage: `Must be one of: ${CONTACT_LIFECYCLE_STAGES.join(', ')}`,
      },
      headers: ctx.headers,
    })
  }
  const lifecycleStage = rawStage || null
  const ownerUid =
    (url.searchParams.get('ownerUid') ?? '').trim().slice(0, CONTACT_NAME_MAX) ||
    null
  const companyId =
    (url.searchParams.get('companyId') ?? '').trim().slice(0, CRM_ID_MAX) || null
  const group = contactViewGroup(ctx, url)
  if ('response' in group) return group.response

  // ONE selector, the most selective that was given: the unique email, then
  // the company, then the tag. Every other filter is checked on the page.
  let docs: FirebaseFirestore.DocumentSnapshot[]
  let nextCursor: string | null = null
  let clause: 'email' | 'companyId' | 'tag' | null = null
  if (email) {
    const found = await findContactByEmail(collection, email)
    docs = found ? [found] : []
    clause = 'email'
  } else {
    let query: FirebaseFirestore.Query = collection
    if (companyId) {
      query = query.where('companyIds', 'array-contains', companyId)
      clause = 'companyId'
    } else if (tag) {
      query = query.where('tags', 'array-contains', tag)
      clause = 'tag'
    }
    ;({ docs, nextCursor } = await paginate(query, url))
  }
  const matched = docs.filter((doc) => {
    const data = doc.data() ?? {}
    if (tag && clause !== 'tag') {
      if (!Array.isArray(data.tags) || !data.tags.includes(tag)) return false
    }
    if (companyId && clause !== 'companyId') {
      if (!Array.isArray(data.companyIds) || !data.companyIds.includes(companyId)) {
        return false
      }
    }
    if (lifecycleStage || ownerUid) {
      const profile = contactCrmProfile(data, group.groupId)
      if (lifecycleStage && profile.lifecycleStage !== lifecycleStage) return false
      if (ownerUid && profile.ownerUid !== ownerUid) return false
    }
    return true
  })
  return listResponse(
    matched.map((doc) => contactView(doc, group.groupId)),
    nextCursor,
    ctx.headers,
  )
}

export async function handleContacts(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = contactsCollection(ctx)
  const [, contactId] = segments

  if (!contactId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'contacts:read')
      if (denied) return denied
      return listContacts(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'contacts:write')
      if (denied) return denied
      return createContact(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const contactRef = collection.doc(contactId)

  // `/v1/contacts/{id}/merge` (AGL-2625): the one action on a contact that
  // is not a verb on the document itself.
  if (segments[2] === 'merge' && segments.length === 3) {
    if (request.method !== 'POST') {
      return ApiErrors.methodNotAllowed({
        headers: { ...ctx.headers, Allow: 'POST' },
      })
    }
    const denied = requireScope(ctx, 'contacts:write')
    if (denied) return denied
    const group = contactViewGroup(ctx, url)
    if ('response' in group) return group.response
    return mergeContactRoute(request, ctx, contactRef, (snap) =>
      contactView(snap, group.groupId),
    )
  }

  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'contacts:read')
    if (denied) return denied
    const group = contactViewGroup(ctx, url)
    if ('response' in group) return group.response
    const snap = await contactRef.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such contact', headers: ctx.headers })
    }
    return apiJson(contactView(snap, group.groupId), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'contacts:write')
    if (denied) return denied
    return updateContact(request, ctx, contactRef)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'contacts:write')
    if (denied) return denied
    return deleteContact(request, ctx, contactRef)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}
