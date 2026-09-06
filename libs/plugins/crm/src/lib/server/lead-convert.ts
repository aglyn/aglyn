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
 * This is the console's door onto `convertHostLead` (the tenancy runtime),
 * which owns the four writes, their order, and the idempotency on the lead;
 * the REST API's `POST /v1/leads/{id}/convert` is the other door onto the
 * same function (AGL-2627). What lives here is what only this door knows:
 * the ID token, the body the convert dialog posts, and the statuses and
 * sentences the dialog shows.
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
  CONTACT_ERASED_MESSAGE,
  CRM_RECORDS_BAND_FULL_MESSAGE,
  normalizeCompanyDomain,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  type ConvertHostLeadRefusal,
  convertHostLead,
} from '@aglyn/tenant-runtime/convert-host-lead'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

// The stage picker moved to the runtime with the writes; re-exported so the
// pipeline code that imports it from here keeps its import.
export { stageForNewDeal } from '@aglyn/tenant-runtime/convert-host-lead'

/** The body the console's convert dialog posts. */
export interface LeadConvertRequest {
  hostId: string
  /** `hosts/{hostId}/leads/{leadId}` — the document id, which is the person key. */
  leadId: string
  /**
   * Who owns the resulting contact (and deal). Defaults to the lead's own
   * owner; failing that the org's assignment rules and the site's default
   * owner decide (AGL-2618), and failing those the caller — somebody
   * converted this person, and a record with no owner is one nobody
   * follows up.
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

const COMPANY_NAME_MAX = 120
const DEAL_TITLE_MAX = 200
const CURRENCY_PATTERN = /^[a-z]{3}$/

/**
 * How each refusal the writes can answer reads at this door — the status
 * and the sentence the convert dialog has always shown for it.
 */
const REFUSALS: Record<
  ConvertHostLeadRefusal,
  { status: number; body: Record<string, unknown> }
> = {
  'unknown-lead': { status: 404, body: { error: 'Unknown lead' } },
  'no-email': {
    status: 422,
    body: { error: 'This lead has no usable email address to convert' },
  },
  'contact-not-created': {
    status: 409,
    body: {
      error:
        'The contact could not be created — the audience band may be ' +
        'full. Nothing was changed.',
    },
  },
  'band-full': {
    status: 409,
    body: { error: CRM_RECORDS_BAND_FULL_MESSAGE, reason: 'band' },
  },
  // The contact create route's own answer for an erased address (AGL-2623),
  // so the convert dialog and the add-contact drawer say one thing about
  // one person.
  erased: {
    status: 409,
    body: { error: CONTACT_ERASED_MESSAGE, reason: 'erased' },
  },
  'unknown-company': { status: 404, body: { error: 'Unknown company' } },
  'no-stages': {
    status: 409,
    body: { error: 'The default pipeline has no stages to open a deal in' },
  },
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
    const result = await convertHostLead({
      firestore: firebaseAdmin.app().firestore(),
      hostId,
      orgId,
      org: org as Record<string, unknown>,
      leadId,
      actor: { uid: decoded.uid, email: decoded.email ?? null, kind: 'member' },
      ...(body.ownerUid ? { ownerUid: String(body.ownerUid) } : {}),
      ...(requestedCompanyId ? { companyId: requestedCompanyId } : {}),
      createCompany,
      deal,
    })
    if (result.ok === false) {
      const refusal = REFUSALS[result.reason]
      res.status(refusal.status).json(refusal.body)
      return
    }
    const answer: LeadConvertResponse = {
      ok: true,
      contactId: result.contactId,
      ...(result.companyId ? { companyId: result.companyId } : {}),
      ...(result.dealId ? { dealId: result.dealId } : {}),
      alreadyConverted: result.alreadyConverted,
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('lead-convert failed', error)
    res.status(500).json({ error: 'The lead could not be converted.' })
  }
}

export default leadConvertHandler
