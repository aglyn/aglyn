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
 * A lead becomes a contact, and optionally a company and a deal (AGL-2608,
 * AGL-2627).
 *
 * ## Why one function under two doors
 *
 * The console's convert dialog posts to the CRM plugin's `crm/lead-convert`
 * route, and an integration posts to `POST /v1/leads/{id}/convert`. The two
 * doors authenticate differently — an ID token against the site's role, an
 * API key against its scopes — and answer in different envelopes, but what
 * they DO has to be one thing: a conversion that opened a second deal for
 * one person because two callers reached the same lead through two
 * implementations is the bug this file exists to make impossible. The doors
 * own their transport; this owns the writes.
 *
 * It lives here, in the tenancy runtime, rather than beside the plugin
 * route it came from, because the console's REST layer may not import a
 * feature plugin (the app→addons boundary), while both the plugin and the
 * console may import the runtime — which already holds the capture door
 * and the owner assignment this conversion goes through.
 *
 * ## Why a server function and not four client writes
 *
 * The lead is a host document the browser may edit, and a company or a deal
 * is a client-creatable org document. What the browser cannot do is CREATE A
 * CONTACT: the contacts collection is written only by `captureHostContact`
 * (the runtime's wrapper over `upsertHostContact`, so `contactCreated`
 * fires), because that function is the dedupe — one human, one row, found by
 * normalized address across every site in the org — and the audience-band
 * gate. A client that wrote a contact document of its own would mint a
 * second row for a person the org already holds, and would do it past the
 * band.
 *
 * Once the contact has to come from the server, the rest follows it: the
 * conversion is one act with four writes, and a caller that made three of
 * them and lost the connection before the fourth leaves a lead marked
 * qualified with no contact, or a deal pointing at a contact that was never
 * stamped on the lead. Here the order is fixed — contact, then company, then
 * deal, then the lead — and the lead is stamped LAST, so a lead that carries
 * `convertedContactId` names a contact that exists.
 *
 * ## Idempotent on the lead
 *
 * A lead already carrying `convertedContactId` answers with the ids it has
 * and creates nothing more. A double-click on the dialog's button, a retry
 * after a slow response, or a Zapier zap replaying a step must not open a
 * second deal for one person.
 *
 * ## The actor
 *
 * A signed-in member converting from the console owns what nobody else
 * claimed: their uid is the owner of last resort, written directly rather
 * than through the deliberate reassignment, because they may be staff
 * converting on a workspace's behalf and a roster check would refuse the one
 * person who is actually here. An API key is not a person and is on no
 * roster, so for an `api` actor that last step is skipped and a contact
 * nobody chose an owner for — and no rule assigned — stays unowned, which
 * the console renders honestly as unassigned. Either way the caller has
 * already been authorized by its door; nothing here asks again.
 *
 * ## The deal carries the lead's lead source (AGL-3516)
 *
 * As Salesforce's conversion does, the deal opened here takes the lead's
 * `leadSource` — a label of the same picklist, already judged when the lead
 * was written — and its Type as the door judged it, or the org's default
 * Type when the converter named none. Its forecast category is its stage's.
 *
 * ## Every standard field lands where Salesforce's conversion puts it (AGL-3513)
 *
 * The contact's facet takes the salutation, the name's parts, the mobile,
 * the fax and Do not call. The company takes the account fields — industry,
 * rating, revenue and its currency, head count, website, phone, fax, the
 * address as its billing address, and the lead source as its Account
 * Source — whole when the conversion creates it, and only into its BLANK
 * fields when it links one the org already holds: a lead is one person's
 * account of the business, and the account record may know better. The
 * deal's Primary Campaign Source is the lead's most recent campaign — see
 * {@link leadLatestCampaignId}.
 */

import {
  consentGroupDisclosureKey,
  consentGroupScope,
  CRM_COLLECTIONS,
  CRM_LEAD_STATUS_PICKLIST,
  crmLeadStatusLabelFor,
  type CrmDealStage,
  type CrmDealStatus,
  type CrmLeadFields,
  type CrmPipeline,
  CRM_COMPANY_PICKLIST_FIELDS,
  type CrmPicklist,
  type CrmPicklistId,
  crmPicklistDefaultLabel,
  judgeCrmCompanyPicklists,
  readCrmCompanyAccountFields,
  crmScopeTokens,
  dealStageForecastCategory,
  DEFAULT_DEAL_STAGES,
  grantedUnderConsentGroup,
  nameSearchFields,
  contactFacetPath,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
  readContactFacet,
  crmNewRecordListFields,
  readMarketingBasis,
  soloConsentGroup,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  crmRecordsQuotaForOrg,
  findContactByEmail,
  logHostActivity,
  orgDataCollectionForHost,
  restampCrmListFieldsAt,
  writeContactCompanyLink,
} from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { assignOwnerForCapture, notifyRecordAssigned } from './assign-contact-owner'
import { captureHostContact } from './capture-host-contact'
import { readCrmPicklist } from './read-picklist'
import { handOffLeadRecords } from '@aglyn/tenant-runtime/hand-off-lead'
import { readContainerIds } from '@aglyn/aglyn/app-utils/container-membership'

/** Who is converting, as far as the writes need to know. */
export interface LeadConvertActor {
  /**
   * What `createdByUid` records on every record the conversion opens, and
   * who the audit line names. A member's uid, or the literal `'api'` for a
   * key — the same attribution the REST creates stamp.
   */
  uid: string
  email?: string | null
  /**
   * `member`: a signed-in person, who becomes the owner when nobody else
   * does. `api`: a key, which cannot own a record — see the header.
   */
  kind: 'member' | 'api'
  /**
   * For an `api` actor, the key's name — what the audit line attributes the
   * conversion to, since a key has no address to be named by.
   */
  apiKeyName?: string | null
}

/** What a conversion is asked to do. Validated by the door before it gets here. */
export interface ConvertHostLeadInput {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  orgId: string
  /** The org document, as the door resolved it. */
  org: Record<string, unknown>
  /** `hosts/{hostId}/leads/{leadId}` — the document id, which is the person key. */
  leadId: string
  actor: LeadConvertActor
  /**
   * Who owns the resulting contact (and deal). Defaults to the lead's own
   * owner; failing that the org's assignment rules and the site's default
   * owner decide (AGL-2618), and failing those a member actor — somebody
   * converted this person, and a record with no owner is one nobody follows
   * up.
   */
  ownerUid?: string
  /** Link an existing `orgs/{orgId}/companies/{companyId}`. */
  companyId?: string
  /** Or create one. Ignored when `companyId` is given. Already normalized. */
  createCompany?: { name: string; domain: string | null } | null
  /** Open a deal in the org's default pipeline. Already normalized. */
  deal?: {
    title: string
    amountCents: number | null
    /** Lowercase ISO 4217. */
    currency: string
    /** A stage of the default pipeline; its first open stage when absent. */
    stageId?: string
    /**
     * The deal's Type, as the door judged it against the org's
     * `opportunityType` list (AGL-3516); absent takes the list's default.
     */
    type?: string
  } | null
}

/**
 * Why a conversion did not happen. Each is a state of the data, not a fault
 * of the request — the door has already refused a malformed body — and each
 * leaves the lead unconverted so a retry after the remedy finds it where it
 * was.
 */
export type ConvertHostLeadRefusal =
  /** No document at `hosts/{hostId}/leads/{leadId}`. */
  | 'unknown-lead'
  /** The lead's address cannot become a contact. */
  | 'no-email'
  /**
   * The capture door produced no contact — it swallows its own failures and
   * drops a creation past a Free org's audience band. Nothing was written.
   */
  | 'contact-not-created'
  /**
   * The site holds an erasure for the lead's address (AGL-2623): the person
   * asked to be forgotten, and the capture door refuses to rebuild a record
   * for them — by a conversion as by a form. Nothing was written, and the
   * lead stays as it was; the erasure removes it when it runs.
   */
  | 'erased'
  /** The CRM records band is full (AGL-2611); the contact stands, nothing more was opened. */
  | 'band-full'
  /** `companyId` names no company in this organization. The contact stands. */
  | 'unknown-company'
  /** The default pipeline has no stages to open a deal in. The contact stands. */
  | 'no-stages'

export type ConvertHostLeadResult =
  | {
      ok: true
      contactId: string
      companyId?: string
      dealId?: string
      /** The lead was converted before this call; nothing was created now. */
      alreadyConverted: boolean
    }
  | { ok: false; reason: ConvertHostLeadRefusal }

/** The stamp the conversion leaves on the lead — see `CrmLeadFields`. */
type LeadConversionStamp = Required<
  Pick<CrmLeadFields, 'status' | 'statusLabel' | 'convertedContactId' | 'convertedAtMs'>
> &
  Pick<CrmLeadFields, 'dealId' | 'companyId' | 'ownerUid'>

/**
 * The stage a new deal opens in.
 *
 * The caller's choice when the pipeline has it, otherwise the first OPEN
 * stage by order — a deal created by converting a lead is by definition not
 * yet won or lost, so defaulting to a closed stage would record an outcome
 * nobody reached. A pipeline with no open stage at all falls back to its
 * first stage rather than refusing: the merchant edited their pipeline into
 * that shape, and a conversion that failed because of it would read as a bug
 * in the lead.
 */
export function stageForNewDeal(
  pipeline: Pick<CrmPipeline, 'stages'>,
  requestedStageId: string | undefined,
): CrmDealStage | null {
  const stages = [...(pipeline.stages ?? [])].sort((a, b) => a.order - b.order)
  if (!stages.length) return null
  const requested = requestedStageId
    ? stages.find((stage) => stage.id === requestedStageId)
    : undefined
  return requested ?? stages.find((stage) => stage.kind === 'open') ?? stages[0]
}

/**
 * The lead's MOST RECENT campaign, which becomes the deal's Primary
 * Campaign Source as Salesforce's conversion makes it. A lead keeps its
 * campaigns as one `campaignIds` array that every writer extends with
 * `arrayUnion`, which appends — so the last id is the campaign the lead was
 * filed under last. `undefined` for a lead filed under none.
 */
export function leadLatestCampaignId(lead: Readonly<Record<string, unknown>>): string | undefined {
  const ids = readContainerIds(lead as Record<string, unknown>, 'campaign')
  return ids.length ? ids[ids.length - 1] : undefined
}

/** Whether a stored field holds nothing a fill would overwrite. */
const blankField = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && !value.trim()) ||
  (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value as object).length)

/**
 * The account fields a lead hands its company (AGL-3513), normalized and
 * judged as every company door judges them: the lead's industry and rating
 * against the org's lists, its lead source as the Account Source, and its
 * revenue, currency, head count, fax, website, phone and address (as the
 * billing address). With `current` — a company the org already holds —
 * only the fields it leaves blank are answered, and the picklists it does
 * not name keep no default; without it, the company is being created and
 * each picklist the lead leaves empty starts from its list's default. A
 * value a list no longer holds is left behind rather than refusing the
 * conversion.
 */
export function leadCompanyFields(
  lead: Readonly<Record<string, unknown>>,
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>,
  current: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> {
  const fill = (field: string) => !current || blankField(current[field])
  const offered = (value: unknown) => (blankField(value) ? undefined : value)
  const fields: Record<string, unknown> = {}
  const requested: Record<string, unknown> = {}
  const picklistSource: Record<string, unknown> = {
    industry: lead['industry'],
    rating: lead['rating'],
    accountSource: lead['leadSource'],
  }
  for (const { field } of CRM_COMPANY_PICKLIST_FIELDS) {
    const value = offered(picklistSource[field])
    if (value !== undefined && fill(field)) requested[field] = value
  }
  const picklists = judgeCrmCompanyPicklists(lists, requested, {
    current: current ?? {},
    created: !current,
  })
  for (const [field, value] of Object.entries(picklists.values)) {
    if (value && !picklists.errors[field]) fields[field] = value
  }
  const account: Record<string, unknown> = {}
  for (const field of ['annualRevenueCents', 'numberOfEmployees', 'fax'] as const) {
    const value = offered(lead[field])
    if (value !== undefined && fill(field)) account[field] = value
  }
  // The revenue's currency travels with the revenue it describes.
  if (account['annualRevenueCents'] !== undefined && offered(lead['currency']) !== undefined) {
    account['currency'] = lead['currency']
  }
  const read = readCrmCompanyAccountFields(account)
  for (const [field, value] of Object.entries(read.values)) {
    if (value !== null && value !== undefined && !read.errors[field]) fields[field] = value
  }
  // Already in the company's shapes: the lead normalized them as a company does.
  for (const [field, from] of [
    ['website', 'website'],
    ['phone', 'phone'],
    ['address', 'address'],
  ] as const) {
    const value = offered(lead[from])
    if (value !== undefined && fill(field)) fields[field] = value
  }
  return fields
}

/** The org's lists behind every company picklist field, for {@link leadCompanyFields}. */
async function readCompanyPicklists(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<Partial<Record<CrmPicklistId, CrmPicklist>>> {
  const ids = [...new Set(CRM_COMPANY_PICKLIST_FIELDS.map((entry) => entry.picklistId))]
  const lists = await Promise.all(ids.map((id) => readCrmPicklist(firestore, orgId, id)))
  return Object.fromEntries(ids.map((id, at) => [id, lists[at]]))
}

/** A stage's kind as the deal's denormalized status. */
function dealStatusForStage(stage: CrmDealStage): CrmDealStatus {
  return stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'open'
}

/**
 * Convert one lead. Throws only on infrastructure failure; every refusal
 * the data can produce is a `ConvertHostLeadResult`.
 */
export async function convertHostLead(
  input: ConvertHostLeadInput,
): Promise<ConvertHostLeadResult> {
  const { firestore, hostId, orgId, org, leadId, actor, createCompany, deal } = input
  const requestedCompanyId = String(input.companyId ?? '').trim()
  // The lead's one home, on the org (AGL-3275). `orgId` is already resolved
  // by the caller, so this needs no second lookup to find it.
  const leadRef = firestore
    .collection('orgs')
    .doc(orgId)
    .collection('leads')
    .doc(leadId)
  const leadSnapshot = await leadRef.get()
  if (!leadSnapshot.exists) return { ok: false, reason: 'unknown-lead' }
  const lead = (leadSnapshot.data() ?? {}) as Record<string, unknown> & CrmLeadFields
  if (lead.convertedContactId) {
    return {
      ok: true,
      contactId: lead.convertedContactId,
      ...(lead.companyId ? { companyId: lead.companyId } : {}),
      ...(lead.dealId ? { dealId: lead.dealId } : {}),
      alreadyConverted: true,
    }
  }
  const email = normalizeContactEmail(lead['email'])
  if (!email) return { ok: false, reason: 'no-email' }

  const group = await consentGroupForSite(hostId, org)
  const visibleTo = crmScopeTokens(org, group)
  /*
   * What the CALLER may read, for the company-by-domain reuse below: their
   * group's own tokens plus `org`, exactly the set the console's listeners
   * filter on. A company outside it is one they could not open, so linking
   * a contact to it would point at a record the page then 404s on.
   */
  const readableTokens = new Set<string>([
    ORG_SCOPE_TOKEN,
    ...consentGroupScope(group),
  ])
  /*
   * THE OWNER A PERSON CHOSE, when one did: the converter's pick, else
   * whoever was already working the lead. Handed to the capture as the
   * facet's owner, which is what tells the capture's own assignment pass
   * to stand down — a person's choice outranks a rule. When nobody chose,
   * the facet names no owner and the pass runs the org's rules and the
   * site's default for a contact it creates (AGL-2618).
   */
  const pickedOwner = String(input.ownerUid ?? '').trim()
  const chosenOwner =
    pickedOwner || (typeof lead.ownerUid === 'string' ? lead.ownerUid : '')
  const now = Date.now()
  const leadName = typeof lead['name'] === 'string' ? lead['name'] : undefined

  /*==========================================
   * 1. THE CONTACT — through the one door that dedupes and meters.
   *
   * `source: 'manual'` because a person converted this lead by hand, and
   * the source filter should say so; the interaction names the lead so the
   * contact's timeline can be walked back to what was captured. The facet
   * carries the stage and the owner, which is what makes this a sales
   * record rather than another form capture.
   *
   * THE LEAD'S OWN PROFILE TRAVELS WITH IT (AGL-3233), the way Salesforce
   * hands a lead's fields to the contact: phone, title, lead source, address, the
   * company as text (until step 2 links a record, whose own name then
   * replaces it), tags, and the marketing basis the lead recorded — the
   * person ticked the box on the lead, and a conversion must not be the
   * moment they lose it. Only what the lead holds is handed over; a value
   * the contact already carries is the contact's, because the capture door
   * writes a profile field only where the facet has none.
   *=========================================*/
  const leadTags = Array.isArray(lead.tags) ? lead.tags.map(String) : []
  const leadConsent = readMarketingBasis(lead, soloConsentGroup(hostId))
  /*
   * WHICH SITES THE CONTACT'S GRANT COVERS (AGL-3320): the lead's, never
   * more. The capture door records a fresh grant, so it is handed the group's
   * disclosure key only when the lead ALREADY holds a grant given under the
   * group as it stands, at every site it names — a lead captured by one site
   * before the group existed, or before a site joined, converts to a contact
   * that site alone may mail, exactly as the lead was.
   */
  const leadDisclosure = grantedUnderConsentGroup(lead, group)
    ? consentGroupDisclosureKey(group)
    : null
  const captured = await captureHostContact({
    hostId,
    email,
    ...(leadName ? { name: leadName } : {}),
    source: 'manual',
    interaction: { summary: 'Converted from a lead', refId: leadId },
    // Who converted it, for the runs its contactCreated sets off (AGL-3376).
    actor:
      actor.kind === 'member'
        ? { kind: 'member', uid: actor.uid, email: actor.email ?? null }
        : { kind: 'apiKey', apiKeyName: actor.apiKeyName ?? null },
    ...(leadConsent.basis === 'granted' ? { marketingConsent: true } : {}),
    ...(leadConsent.basis === 'granted' && leadDisclosure
      ? { disclosedConsentGroup: leadDisclosure }
      : {}),
    ...(leadTags.length ? { tags: leadTags } : {}),
    facet: {
      lifecycleStage: 'sales-qualified',
      ...(chosenOwner ? { ownerUid: chosenOwner } : {}),
      ...(typeof lead.phone === 'string' && lead.phone ? { phone: lead.phone } : {}),
      ...(typeof lead.jobTitle === 'string' && lead.jobTitle ? { jobTitle: lead.jobTitle } : {}),
      // Salesforce's Lead Source travels to the contact (AGL-3298).
      ...(typeof lead.leadSource === 'string' && lead.leadSource
        ? { leadSource: lead.leadSource }
        : {}),
      ...(lead.address && typeof lead.address === 'object' ? { address: lead.address } : {}),
      ...(typeof lead.company === 'string' && lead.company
        ? { companyName: lead.company }
        : {}),
      // Salesforce's standard lead fields (AGL-3513), as the contact keeps them.
      ...Object.fromEntries(
        (['salutation', 'firstName', 'lastName', 'mobilePhone', 'fax'] as const)
          .filter((key) => typeof lead[key] === 'string' && lead[key])
          .map((key) => [key, lead[key]]),
      ),
      // Only ever `true`: a lead that never said is not a person who asked to be called.
      ...(lead.doNotCall === true ? { doNotCall: true } : {}),
    },
  })
  /*
   * The one verdict of the door's that is named here. Its other refusals —
   * the band, an address it will not take, its own swallowed error — all
   * read the same from this side: no row to find below, answered as
   * `contact-not-created`. An erasure is different in kind: not a limit the
   * org can lift or a fault in the request but a decision the workspace made
   * about this person, and a caller told "the band may be full" would retry
   * against it forever.
   */
  if (captured && 'refused' in captured && captured.refused === 'erased') {
    return { ok: false, reason: 'erased' }
  }
  const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
  /*
   * The same resolution the capture door just made (AGL-2625): the
   * address index first, so a lead whose address is an ALTERNATE on a
   * merged contact converts into the survivor the capture landed on
   * rather than reading as a contact the band dropped.
   */
  const contactSnapshot = await findContactByEmail(contactsRef, email)
  if (!contactSnapshot) return { ok: false, reason: 'contact-not-created' }
  const contactRef = contactSnapshot.ref
  const contactId = contactSnapshot.id
  const contactData = (contactSnapshot.data() ?? {}) as Record<string, unknown>
  const orgRef = firestore.collection('orgs').doc(orgId)
  /*
   * THE RECORDS BAND (AGL-2611), asked before each record this conversion
   * CREATES. The contact went through the capture door, which refuses at
   * the band on its own; a company and a deal are records of the same
   * band, and on a Free org at its hundred the honest answer is the one
   * the drawers give — refuse, write nothing more, and leave the lead
   * unconverted so a retry after the upgrade finds it where it was. The
   * contact step 1 captured stays: it is one person's record, and a second
   * conversion merges onto it rather than making another. Measured fresh
   * each time because the company created in step 2 is itself a record.
   */
  const bandFull = async () => {
    const room = await crmRecordsQuotaForOrg(org as never, orgRef)
    return !room.allowed
  }

  /*
   * WHOSE THE CONTACT IS, now that it exists. The capture wrote the chosen
   * owner, or its pass assigned one to a contact it created; a contact
   * the org already held with no owner has had neither, so the same pass
   * is asked once more — it touches only a record with no owner and
   * answers `unchanged` for one that has — and a member actor is the last
   * resort. A colleague the converter picked is told; the lead's existing
   * owner and the caller are not, having chosen for themselves.
   */
  let ownerUid = readContactFacet(contactData, group.groupId).ownerUid ?? ''
  if (!ownerUid) {
    const assigned = await assignOwnerForCapture({
      hostId,
      contactId,
      email,
      source: 'manual',
      actorUid: actor.kind === 'member' ? actor.uid : null,
    })
    if (assigned.outcome !== 'none') ownerUid = assigned.ownerUid
  }
  if (!ownerUid && actor.kind === 'member') {
    ownerUid = actor.uid
    await contactRef.update({
      [contactFacetPath(group.groupId, 'ownerUid')]: ownerUid,
      updatedAt: FieldValue.serverTimestamp(),
    })
    // The owner is what the Contacts list filters by (AGL-3321).
    await restampCrmListFieldsAt(contactRef, 'contacts')
  } else if (ownerUid && pickedOwner && pickedOwner === ownerUid) {
    await notifyRecordAssigned({
      hostId,
      orgId,
      ownerUid,
      actorUid: actor.kind === 'member' ? actor.uid : null,
      record: { kind: 'contact', id: contactId },
      who: leadName || email,
    })
  }

  /*==========================================
   * 2. THE COMPANY — linked, found by domain, or created.
   *=========================================*/
  let companyId: string | undefined
  /** The company the conversion found rather than made — its blanks are filled below. */
  let existingCompany: FirebaseFirestore.DocumentSnapshot | undefined
  if (requestedCompanyId) {
    const companySnapshot = await orgRef
      .collection(CRM_COLLECTIONS.companies)
      .doc(requestedCompanyId)
      .get()
    if (!companySnapshot.exists) return { ok: false, reason: 'unknown-company' }
    companyId = requestedCompanyId
    existingCompany = companySnapshot
  } else if (createCompany) {
    /*
     * FIND BEFORE CREATE. The NAME first (AGL-3233): a lead names its
     * company as text, and a company the org already files under that
     * name is the account, whatever domain it carries. Then the domain,
     * the key two contacts at one business share — a second company
     * document for `acme.com` would split the account the key exists to
     * join. Only a company the caller can see counts as found — see
     * `readableTokens`.
     */
    const visibleAmong = (
      snapshots: readonly FirebaseFirestore.QueryDocumentSnapshot[],
    ): FirebaseFirestore.QueryDocumentSnapshot | undefined =>
      snapshots.find((snapshot) => {
        const tokens = snapshot.get('visibleTo')
        return (
          Array.isArray(tokens) &&
          tokens.some((token) => readableTokens.has(String(token)))
        )
      })
    const byName = await orgRef
      .collection(CRM_COLLECTIONS.companies)
      .where('nameLower', '==', createCompany.name.toLowerCase())
      .limit(5)
      .get()
    existingCompany = visibleAmong(byName.docs)
    if (!existingCompany && createCompany.domain) {
      const byDomain = await orgRef
        .collection(CRM_COLLECTIONS.companies)
        .where('domain', '==', createCompany.domain)
        .limit(5)
        .get()
      existingCompany = visibleAmong(byDomain.docs)
    }
    companyId = existingCompany?.id
    if (!companyId) {
      if (await bandFull()) return { ok: false, reason: 'band-full' }
      const company: Record<string, unknown> = {
        // The lead's account fields, whole (AGL-3513).
        ...leadCompanyFields(lead, await readCompanyPicklists(firestore, orgId), null),
        ...nameSearchFields(createCompany.name),
        ...(createCompany.domain ? { domain: createCompany.domain } : {}),
        ...(ownerUid ? { ownerUid } : {}),
        visibleTo,
        hostId,
        createdByUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      const created = await orgRef.collection(CRM_COLLECTIONS.companies).add({
        ...company,
        // What the Companies list searches and filters by (AGL-3321).
        ...crmNewRecordListFields('companies', company),
      })
      companyId = created.id
    }
  }
  if (companyId && existingCompany) {
    /*
     * A company the org already held takes the lead's account fields only
     * where it has none (AGL-3513) — and is restamped, because its
     * industry, rating and account source are what its list filters by.
     */
    const filled = leadCompanyFields(
      lead,
      await readCompanyPicklists(firestore, orgId),
      (existingCompany.data() ?? {}) as Record<string, unknown>,
    )
    if (Object.keys(filled).length) {
      await existingCompany.ref.update({ ...filled, updatedAt: FieldValue.serverTimestamp() })
      await restampCrmListFieldsAt(existingCompany.ref, 'companies')
    }
  }
  if (companyId) {
    /*
     * The one link writer (AGL-2613): the holder's facet field the contact
     * record reads, the queryable top-level mirror the company's contacts
     * card filters on, and the company's contacts count — planned from
     * the row as the capture left it, so a person the org already held
     * under another company is MOVED rather than counted twice.
     */
    await writeContactCompanyLink({
      firestore,
      contactRef,
      contact: contactData,
      companiesRef: orgRef.collection(CRM_COLLECTIONS.companies),
      groupId: group.groupId,
      companyId,
    })
  }

  /*==========================================
   * 3. THE DEAL — in the default pipeline, seeded if the org has none.
   *=========================================*/
  let dealId: string | undefined
  if (deal) {
    const pipelinesRef = orgRef.collection(CRM_COLLECTIONS.pipelines)
    let pipelineId: string
    let pipeline: Pick<CrmPipeline, 'stages'>
    const defaults = await pipelinesRef
      .where('isDefault', '==', true)
      .limit(1)
      .get()
    if (!defaults.empty) {
      pipelineId = defaults.docs[0].id
      pipeline = defaults.docs[0].data() as CrmPipeline
    } else {
      /*
       * The deals section's own read shape, so the two agree on which
       * pipeline "the org's pipeline" is when none is flagged default: the
       * first by document id of a bounded window. Seeding a SECOND pipeline
       * here while one exists unflagged would leave the merchant with two
       * boards and their deals split between them.
       */
      const any = await pipelinesRef
        .orderBy(FieldPath.documentId())
        .limit(20)
        .get()
      if (!any.empty) {
        pipelineId = any.docs[0].id
        pipeline = any.docs[0].data() as CrmPipeline
      } else {
        // Exactly what the Deals section seeds: one `Sales` pipeline
        // carrying a COPY of the default stages, flagged default.
        const seeded: Omit<CrmPipeline, 'createdAt' | 'updatedAt'> = {
          name: 'Sales',
          stages: [...DEFAULT_DEAL_STAGES],
          isDefault: true,
          visibleTo,
          hostId,
        }
        const created = await pipelinesRef.add({
          ...seeded,
          createdByUid: actor.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        pipelineId = created.id
        pipeline = seeded
      }
    }
    const stage = stageForNewDeal(pipeline, deal.stageId)
    if (!stage) return { ok: false, reason: 'no-stages' }
    if (await bandFull()) return { ok: false, reason: 'band-full' }
    const type =
      deal.type ??
      crmPicklistDefaultLabel(await readCrmPicklist(firestore, orgId, 'opportunityType')) ??
      undefined
    const leadSource = typeof lead.leadSource === 'string' ? lead.leadSource.trim() : ''
    // The Primary Campaign Source: the lead's most recent campaign (AGL-3513).
    const campaignId = leadLatestCampaignId(lead)
    const dealRecord: Record<string, unknown> = {
      title: deal.title,
      titleLower: deal.title.toLowerCase(),
      pipelineId,
      stageId: stage.id,
      status: dealStatusForStage(stage),
      ...(deal.amountCents !== null ? { amountCents: deal.amountCents } : {}),
      currency: deal.currency,
      stageChangedAtMs: now,
      forecastCategory: dealStageForecastCategory(stage),
      ...(type ? { type } : {}),
      ...(leadSource ? { leadSource } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(ownerUid ? { ownerUid } : {}),
      contactId,
      // The converted person is the deal's Primary contact role, with no
      // role yet, as Salesforce's conversion makes them (AGL-3521).
      contactRoles: [{ contactId, primary: true }],
      ...(companyId ? { companyId } : {}),
      visibleTo,
      hostId,
      createdByUid: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const created = await orgRef.collection(CRM_COLLECTIONS.deals).add({
      ...dealRecord,
      // What the Deals list searches and filters by (AGL-3321).
      ...crmNewRecordListFields('deals', dealRecord),
    })
    dealId = created.id
  }

  /*==========================================
   * 4. THE LEAD — stamped last, once everything it names exists.
   *=========================================*/
  const stamp: LeadConversionStamp = {
    status: 'qualified',
    // The org's label for Qualified, beside the meaning (AGL-3512).
    statusLabel: crmLeadStatusLabelFor(
      await readCrmPicklist(firestore, orgId, CRM_LEAD_STATUS_PICKLIST),
      'qualified',
    ),
    convertedContactId: contactId,
    convertedAtMs: now,
    ...(ownerUid ? { ownerUid } : {}),
    ...(companyId ? { companyId } : {}),
    ...(dealId ? { dealId } : {}),
  }
  await leadRef.update({ ...stamp, updatedAt: FieldValue.serverTimestamp() })

  /*
   * WHAT THE LEAD HANDS OVER (AGL-3233): its activities and tasks gain the
   * contact, and every plugin with a listener — Sequences, for an
   * enrollment naming the lead — re-points its own records. After the
   * stamp, so a listener reading the lead finds the conversion on it; it
   * never throws.
   */
  await handOffLeadRecords({
    firestore,
    orgId,
    hostId,
    leadId,
    contactId,
    email,
    by: actor.kind === 'member' ? 'member' : 'api',
  })

  /*
   * The audit line, from the function that did the work (AGL-2622): the
   * conversion is one act however many records it opened, so it is one
   * entry, on the lead, in the feed of the site that holds the lead. A
   * repeat call answered above with the ids it already had wrote nothing
   * and logs nothing.
   */
  await logHostActivity(
    hostId,
    {
      uid: actor.uid,
      email: actor.email ?? null,
      ...(actor.apiKeyName ? { apiKeyName: actor.apiKeyName } : {}),
    },
    'Converted lead',
    { type: 'lead', id: leadId, name: String(lead['name'] ?? '') || email },
  )

  return {
    ok: true,
    contactId,
    ...(companyId ? { companyId } : {}),
    ...(dealId ? { dealId } : {}),
    alreadyConverted: false,
  }
}
