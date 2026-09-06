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
 */

import {
  consentGroupScope,
  CRM_COLLECTIONS,
  type CrmDealStage,
  type CrmDealStatus,
  type CrmLeadFields,
  type CrmPipeline,
  crmScopeTokens,
  DEFAULT_DEAL_STAGES,
  nameSearchFields,
  contactFacetPath,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
  readContactFacet,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  crmRecordsQuotaForOrg,
  logHostActivity,
  orgDataCollectionForHost,
  writeContactCompanyLink,
} from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { assignOwnerForCapture, notifyRecordAssigned } from './assign-contact-owner'
import { captureHostContact } from './capture-host-contact'

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
  Pick<CrmLeadFields, 'status' | 'convertedContactId' | 'convertedAtMs'>
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
  const leadRef = firestore
    .collection('hosts')
    .doc(hostId)
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
   *=========================================*/
  await captureHostContact({
    hostId,
    email,
    ...(leadName ? { name: leadName } : {}),
    source: 'manual',
    interaction: { summary: 'Converted from a lead', refId: leadId },
    facet: {
      lifecycleStage: 'sales-qualified',
      ...(chosenOwner ? { ownerUid: chosenOwner } : {}),
    },
  })
  const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
  const found = await contactsRef.where('email', '==', email).limit(1).get()
  if (found.empty) return { ok: false, reason: 'contact-not-created' }
  const contactRef = found.docs[0].ref
  const contactId = found.docs[0].id
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
  let ownerUid =
    readContactFacet(found.docs[0].data(), group.groupId).ownerUid ?? ''
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
  if (requestedCompanyId) {
    const companySnapshot = await orgRef
      .collection(CRM_COLLECTIONS.companies)
      .doc(requestedCompanyId)
      .get()
    if (!companySnapshot.exists) return { ok: false, reason: 'unknown-company' }
    companyId = requestedCompanyId
  } else if (createCompany) {
    if (createCompany.domain) {
      /*
       * FIND BEFORE CREATE. The domain is the key two contacts at one
       * business share, and a second company document for `acme.com`
       * would split the account the key exists to join. Only a company the
       * caller can see counts as found — see `readableTokens`.
       */
      const byDomain = await orgRef
        .collection(CRM_COLLECTIONS.companies)
        .where('domain', '==', createCompany.domain)
        .limit(5)
        .get()
      const visible = byDomain.docs.find((snapshot) => {
        const tokens = snapshot.get('visibleTo')
        return (
          Array.isArray(tokens) &&
          tokens.some((token) => readableTokens.has(String(token)))
        )
      })
      if (visible) companyId = visible.id
    }
    if (!companyId) {
      if (await bandFull()) return { ok: false, reason: 'band-full' }
      const created = await orgRef.collection(CRM_COLLECTIONS.companies).add({
        ...nameSearchFields(createCompany.name),
        ...(createCompany.domain ? { domain: createCompany.domain } : {}),
        ...(ownerUid ? { ownerUid } : {}),
        visibleTo,
        hostId,
        createdByUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      companyId = created.id
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
      contact: found.docs[0].data() as Record<string, unknown>,
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
    const created = await orgRef.collection(CRM_COLLECTIONS.deals).add({
      title: deal.title,
      titleLower: deal.title.toLowerCase(),
      pipelineId,
      stageId: stage.id,
      status: dealStatusForStage(stage),
      ...(deal.amountCents !== null ? { amountCents: deal.amountCents } : {}),
      currency: deal.currency,
      stageChangedAtMs: now,
      ...(ownerUid ? { ownerUid } : {}),
      contactId,
      ...(companyId ? { companyId } : {}),
      visibleTo,
      hostId,
      createdByUid: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    dealId = created.id
  }

  /*==========================================
   * 4. THE LEAD — stamped last, once everything it names exists.
   *=========================================*/
  const stamp: LeadConversionStamp = {
    status: 'qualified',
    convertedContactId: contactId,
    convertedAtMs: now,
    ...(ownerUid ? { ownerUid } : {}),
    ...(companyId ? { companyId } : {}),
    ...(dealId ? { dealId } : {}),
  }
  await leadRef.update({ ...stamp, updatedAt: FieldValue.serverTimestamp() })

  /*
   * The audit line, from the function that did the work (AGL-2622): the
   * conversion is one act however many records it opened, so it is one
   * entry, on the lead, in the feed of the site that holds the lead. A
   * repeat call answered above with the ids it already had wrote nothing
   * and logs nothing.
   */
  await logHostActivity(
    hostId,
    { uid: actor.uid, email: actor.email ?? null },
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
