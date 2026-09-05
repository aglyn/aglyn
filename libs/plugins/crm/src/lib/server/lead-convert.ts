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
 * `POST /api/crm/lead-convert` — a lead becomes a contact, and optionally a
 * company and a deal (AGL-2608).
 *
 * ## Why a server route and not four client writes
 *
 * The lead is a host document the browser may edit, and a company or a deal
 * is a client-creatable org document. What the browser cannot do is CREATE A
 * CONTACT: the contacts collection is written only by `upsertHostContact`,
 * because that function is the dedupe — one human, one row, found by
 * normalized address across every site in the org — and the audience-band
 * gate. A client that wrote a contact document of its own would mint a
 * second row for a person the org already holds, and would do it past the
 * band.
 *
 * Once the contact has to come from the server, the rest follows it: the
 * conversion is one act with four writes, and a browser that made three of
 * them and lost the connection before the fourth leaves a lead marked
 * qualified with no contact, or a deal pointing at a contact that was never
 * stamped on the lead. Here the order is fixed — contact, then company, then
 * deal, then the lead — and the lead is stamped LAST, so a lead that carries
 * `convertedContactId` names a contact that exists.
 *
 * ## Idempotent on the lead
 *
 * A lead already carrying `convertedContactId` answers with the ids it has
 * and creates nothing more. A double-click on the dialog's button, or a
 * retry after a slow response, must not open a second deal for one person.
 *
 * ## What the caller has to be
 *
 * A signed-in member of the host's org holding `data.manage` — the same key
 * the console gate on the CRM surface enforces — with a role on this site.
 * Checked here with the Admin SDK rather than trusted from the client,
 * because this route writes into collections the caller's own rules would
 * otherwise decide about.
 */

import {
  consentGroupScope,
  contactFacetPath,
  CRM_COLLECTIONS,
  type CrmDealStage,
  type CrmDealStatus,
  type CrmLeadFields,
  type CrmPipeline,
  crmScopeTokens,
  DEFAULT_DEAL_STAGES,
  nameSearchFields,
  normalizeCompanyDomain,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgForHost,
  orgDataCollectionForHost,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'

/** The body the console's convert dialog posts. */
export interface LeadConvertRequest {
  hostId: string
  /** `hosts/{hostId}/leads/{leadId}` — the document id, which is the person key. */
  leadId: string
  /**
   * Who owns the resulting contact (and deal). Defaults to the lead's own
   * owner, and failing that to the caller — somebody converted this person,
   * and a record with no owner is one nobody follows up.
   */
  ownerUid?: string
  /** Link an existing `orgs/{orgId}/companies/{companyId}`. */
  companyId?: string
  /** Or create one. Ignored when `companyId` is given. */
  createCompany?: { name: string; domain?: string }
  /** Open a deal in the org's default pipeline. */
  deal?: {
    title: string
    amountCents?: number
    /** Lowercase ISO 4217; `usd` when absent or malformed. */
    currency?: string
    /** A stage of the default pipeline; its first open stage when absent. */
    stageId?: string
  }
}

/** What the route answers on success. */
export interface LeadConvertResponse {
  ok: true
  contactId: string
  companyId?: string
  dealId?: string
  /** The lead was converted before this call; nothing was created now. */
  alreadyConverted: boolean
}

/** The stamp the conversion leaves on the lead — see `CrmLeadFields`. */
type LeadConversionStamp = Required<
  Pick<CrmLeadFields, 'status' | 'convertedContactId' | 'convertedAtMs'>
> &
  Pick<CrmLeadFields, 'dealId' | 'companyId' | 'ownerUid'>

const COMPANY_NAME_MAX = 120
const DEAL_TITLE_MAX = 200
const CURRENCY_PATTERN = /^[a-z]{3}$/

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

export const leadConvertHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }
  const body: Partial<LeadConvertRequest> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '').trim()
  const leadId = String(body.leadId ?? '').trim()
  if (!hostId || !leadId) {
    res.status(400).json({ error: 'Missing hostId or leadId' })
    return
  }

  /*
   * Validate the optional parts BEFORE any read, so a malformed request costs
   * nothing and a bad company domain is refused rather than silently dropped
   * — a converter who typed a domain expects the company to carry it.
   */
  const requestedCompanyId = String(body.companyId ?? '').trim()
  let createCompany: { name: string; domain: string | null } | null = null
  if (!requestedCompanyId && body.createCompany) {
    const name = String(body.createCompany.name ?? '')
      .trim()
      .slice(0, COMPANY_NAME_MAX)
    if (!name) {
      res.status(400).json({ error: 'A company needs a name' })
      return
    }
    const rawDomain = String(body.createCompany.domain ?? '').trim()
    const domain = rawDomain ? normalizeCompanyDomain(rawDomain) : null
    if (rawDomain && !domain) {
      res.status(400).json({ error: 'That does not look like a domain' })
      return
    }
    createCompany = { name, domain }
  }
  let deal: {
    title: string
    amountCents: number | null
    currency: string
    stageId: string | undefined
  } | null = null
  if (body.deal) {
    const title = String(body.deal.title ?? '')
      .trim()
      .slice(0, DEAL_TITLE_MAX)
    if (!title) {
      res.status(400).json({ error: 'A deal needs a title' })
      return
    }
    const amount = Number(body.deal.amountCents)
    const currency = String(body.deal.currency ?? '')
      .trim()
      .toLowerCase()
    deal = {
      title,
      amountCents:
        Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null,
      currency: CURRENCY_PATTERN.test(currency) ? currency : 'usd',
      stageId: body.deal.stageId ? String(body.deal.stageId) : undefined,
    }
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const staff = decoded['staff'] === true
    /*
     * The console's own gate on the CRM is `data.manage`; the route asks the
     * same question of the same resolver the shell's server twin uses, and
     * additionally that the caller has a role on THIS site — an org member
     * scoped to a sibling site holds the key but not the host, and a lead is
     * the host's record. `resolveOrgPermissions` fails closed on a lookup
     * error when a host is named, so an absent membership refuses.
     */
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (
      !staff &&
      !(membership.hostRole && membership.permissions['data.manage'] === true)
    ) {
      res
        .status(403)
        .json({ error: 'Converting a lead requires the data permission on this site' })
      return
    }

    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      res.status(404).json({ error: 'Unknown site' })
      return
    }
    const { orgId, org } = resolved
    const firestore = firebaseAdmin.app().firestore()
    const leadRef = firestore
      .collection('hosts')
      .doc(hostId)
      .collection('leads')
      .doc(leadId)
    const leadSnapshot = await leadRef.get()
    if (!leadSnapshot.exists) {
      res.status(404).json({ error: 'Unknown lead' })
      return
    }
    const lead = (leadSnapshot.data() ?? {}) as Record<string, unknown> &
      CrmLeadFields
    if (lead.convertedContactId) {
      const answer: LeadConvertResponse = {
        ok: true,
        contactId: lead.convertedContactId,
        ...(lead.companyId ? { companyId: lead.companyId } : {}),
        ...(lead.dealId ? { dealId: lead.dealId } : {}),
        alreadyConverted: true,
      }
      res.status(200).json(answer)
      return
    }
    const email = normalizeContactEmail(lead['email'])
    if (!email) {
      res
        .status(422)
        .json({ error: 'This lead has no usable email address to convert' })
      return
    }

    const group = await consentGroupForSite(hostId, org as Record<string, unknown>)
    const visibleTo = crmScopeTokens(org as Record<string, unknown>, group)
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
    const ownerUid =
      String(body.ownerUid ?? '').trim() ||
      (typeof lead.ownerUid === 'string' ? lead.ownerUid : '') ||
      decoded.uid
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
    await upsertHostContact({
      hostId,
      email,
      ...(leadName ? { name: leadName } : {}),
      source: 'manual',
      interaction: { summary: 'Converted from a lead', refId: leadId },
      facet: { lifecycleStage: 'sales-qualified', ownerUid },
    })
    const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
    const found = await contactsRef.where('email', '==', email).limit(1).get()
    if (found.empty) {
      /*
       * The upsert swallows its own failures and drops a creation past a Free
       * org's audience band — either way there is no contact to convert
       * into, and saying so is the only honest answer. Nothing has been
       * written to the lead, so the converter can try again once there is
       * room.
       */
      res.status(409).json({
        error:
          'The contact could not be created — the audience band may be ' +
          'full. Nothing was changed.',
      })
      return
    }
    const contactRef = found.docs[0].ref
    const contactId = found.docs[0].id
    const orgRef = firestore.collection('orgs').doc(orgId)

    /*==========================================
     * 2. THE COMPANY — linked, found by domain, or created.
     *=========================================*/
    let companyId: string | undefined
    if (requestedCompanyId) {
      const companySnapshot = await orgRef
        .collection(CRM_COLLECTIONS.companies)
        .doc(requestedCompanyId)
        .get()
      if (!companySnapshot.exists) {
        res.status(404).json({ error: 'Unknown company' })
        return
      }
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
        const created = await orgRef.collection(CRM_COLLECTIONS.companies).add({
          ...nameSearchFields(createCompany.name),
          ...(createCompany.domain ? { domain: createCompany.domain } : {}),
          ownerUid,
          visibleTo,
          hostId,
          createdByUid: decoded.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        companyId = created.id
      }
    }
    if (companyId) {
      /*
       * BOTH shapes, kept in step: the queryable top-level array the
       * company's contacts card filters on, and the holder's facet field the
       * contact record reads. A dotted path on `update()` reaches one
       * holder's facet and leaves every other holder's alone.
       */
      await contactRef.update({
        companyIds: FieldValue.arrayUnion(companyId),
        [contactFacetPath(group.groupId, 'companyId')]: companyId,
        updatedAt: FieldValue.serverTimestamp(),
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
            createdByUid: decoded.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
          pipelineId = created.id
          pipeline = seeded
        }
      }
      const stage = stageForNewDeal(pipeline, deal.stageId)
      if (!stage) {
        res.status(409).json({
          error: 'The default pipeline has no stages to open a deal in',
        })
        return
      }
      const created = await orgRef.collection(CRM_COLLECTIONS.deals).add({
        title: deal.title,
        titleLower: deal.title.toLowerCase(),
        pipelineId,
        stageId: stage.id,
        status: dealStatusForStage(stage),
        ...(deal.amountCents !== null ? { amountCents: deal.amountCents } : {}),
        currency: deal.currency,
        stageChangedAtMs: now,
        ownerUid,
        contactId,
        ...(companyId ? { companyId } : {}),
        visibleTo,
        hostId,
        createdByUid: decoded.uid,
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
      ownerUid,
      ...(companyId ? { companyId } : {}),
      ...(dealId ? { dealId } : {}),
    }
    await leadRef.update({ ...stamp, updatedAt: FieldValue.serverTimestamp() })

    const answer: LeadConvertResponse = {
      ok: true,
      contactId,
      ...(companyId ? { companyId } : {}),
      ...(dealId ? { dealId } : {}),
      alreadyConverted: false,
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('lead-convert failed', error)
    res.status(500).json({ error: 'The lead could not be converted.' })
  }
}

export default leadConvertHandler
