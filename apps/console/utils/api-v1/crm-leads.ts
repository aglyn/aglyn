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
 * `/v1/leads` (AGL-2627) — the work queue: every person a site captured,
 * with the working state a sales team keeps on them and the door that turns
 * one into a contact.
 *
 * ## A lead belongs to a site, so every request names one
 *
 * The five CRM collections sit under the org and a key reads them whole
 * (`crm-shared.ts`). A lead does not: it lives at
 * `hosts/{siteId}/leads/{id}`, private to the site that captured it, with no
 * `visibleTo` to filter on and an id that is only unique within its site —
 * the person key, so one address is one row per site. There is no org-wide
 * list to read, and `/v1/leads/{id}` alone names a row in every site the org
 * has. So `siteId` is required on every endpoint here, as a query parameter
 * (a `PATCH` or `POST` may carry it in the body instead), and a site the
 * organization does not own is refused the way `consentSiteId` is on a
 * create. That is also what keeps this resource mountable at the org level:
 * the site is a parameter, never an assumption.
 *
 * ## Newest first, and the status filter runs on the page
 *
 * A polling integration asks for what arrived since it last looked, so the
 * list is ordered by `lastSeen` descending — the one field the capture door
 * stamps on every lead, at every capture — with the id as tiebreak, and the
 * cursor carries both. `?status=` is applied to the page rather than sent to
 * Firestore, for a reason a `where` cannot answer: a lead nobody has touched
 * carries no `status` field at all and reads as `new` (`crmLeadStatus`), so
 * `where('status', '==', 'new')` would miss exactly the leads a work queue
 * exists to show. The page can come back short, which the conventions page
 * already documents; no composite index is needed and none is shipped.
 *
 * ## What a PATCH may say about a status
 *
 * The same three moves the console offers: `new`, `working`, and
 * `unqualified` with a reason. `qualified` is the converted state — a lead
 * reaches it through `POST /v1/leads/{id}/convert` and nowhere else, because
 * the status is a claim that a contact exists and the conversion is what
 * makes it true. A converted lead's status is fixed for the same reason.
 * Reopening an unqualified lead drops its reason, as the console does: a
 * lead being worked again is not "unqualified because …".
 */
import {
  CRM_LEAD_STATUSES,
  type CrmLeadFields,
  type CrmLeadStatus,
  crmLeadStatus,
  crmMemberOption,
  findOrgMember,
  normalizeCompanyDomain,
  normalizeContactEmail,
  readMarketingBasis,
  soloConsentGroup,
} from '@aglyn/aglyn/server'
import {
  apiJson,
  ApiErrors,
  decodeCursor,
  encodeCursor,
  listOrgMembers,
  listResponse,
  parseLimit,
} from '@aglyn/tenant-data-admin'
import {
  type ConvertHostLeadInput,
  type ConvertHostLeadRefusal,
  convertHostLead,
} from '@aglyn/tenant-runtime/convert-host-lead'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from '../api-v1'
import {
  type Clearable,
  CRM_ID_MAX,
  CRM_LABEL_MAX,
  CRM_TEXT_MAX,
  CRM_TITLE_MAX,
  crmTimes,
  crmValidationFailed,
  isoFromMs,
  memberError,
  readOptionalText,
  refuseUnknownKeys,
  updatePayload,
} from './crm-shared'
import { claimWrite, orgOwnsHost, readJsonBody } from './shared'

/**
 * The statuses a PATCH may set — every status but the converted one.
 *
 * A literal, checked against the model's union, rather than a filter over
 * `CRM_LEAD_STATUSES`: nothing in this module may dereference the model at
 * load time, for the reason `crm-shared.ts` gives — the `/v1` suites mock
 * `@aglyn/aglyn/server` as a closed world, and a module-level read of a
 * constant they never asked for throws at import in every one of them.
 */
const LEAD_PATCH_STATUSES = [
  'new',
  'working',
  'unqualified',
] as const satisfies readonly Exclude<CrmLeadStatus, 'qualified'>[]

// ── The view ────────────────────────────────────────────────────────────────

/** The lead object as published. Every writable field appears here. */
function leadView(siteId: string, doc: FirebaseFirestore.DocumentSnapshot) {
  const data = (doc.data() ?? {}) as Record<string, unknown> & CrmLeadFields
  // The lead's own silo — a group of one, however the org pools its
  // contacts — which is where `addHostLead` recorded the basis.
  const consent = readMarketingBasis(data, soloConsentGroup(siteId))
  return {
    id: doc.id,
    object: 'lead',
    siteId,
    email: typeof data['email'] === 'string' ? data['email'] : null,
    name: typeof data['name'] === 'string' ? data['name'] : null,
    status: crmLeadStatus(data),
    ownerUid: data.ownerUid ?? null,
    notes: data.notes ?? null,
    unqualifiedReason: data.unqualifiedReason ?? null,
    sources: Array.isArray(data['sources']) ? data['sources'].map(String) : [],
    submissionCount:
      typeof data['submissionCount'] === 'number' ? data['submissionCount'] : 0,
    firstSeen: isoFromMs(data['firstSeenAtMs']),
    lastSeen: isoFromMs(data['lastSeenAtMs']),
    marketingConsent: consent.basis === 'granted',
    marketingConsentAt: consent.basis === 'granted' ? isoFromMs(consent.basisAtMs) : null,
    convertedContactId: data.convertedContactId ?? null,
    convertedAt: isoFromMs(data.convertedAtMs),
    companyId: data.companyId ?? null,
    dealId: data.dealId ?? null,
    ...crmTimes(data as FirebaseFirestore.DocumentData),
  }
}

// ── The site ────────────────────────────────────────────────────────────────

/**
 * The `siteId` a request names, validated — the query parameter first, the
 * body as the fallback a `POST`/`PATCH` may use. Required, and required to
 * be one of the organization's own sites, for the reason the module header
 * gives.
 */
function readLeadSite(
  ctx: ApiV1Context,
  url: URL,
  body: Record<string, unknown> = {},
): { siteId: string } | { response: Response } {
  const refuse = (error: string) => ({
    response: crmValidationFailed(ctx, 'lead', { siteId: error }),
  })
  const raw = url.searchParams.get('siteId') ?? body.siteId
  if (raw === undefined || raw === null) {
    return refuse('Required — name the site the lead belongs to')
  }
  const siteId = String(raw).trim()
  if (!siteId) return refuse('Must name a site')
  if (!orgOwnsHost(ctx, siteId)) return refuse('No such site in this organization')
  return { siteId }
}

function leadsCollection(ctx: ApiV1Context, siteId: string) {
  return ctx.firestore.collection('hosts').doc(siteId).collection('leads')
}

// ── The owner ───────────────────────────────────────────────────────────────

/**
 * The owner a body names, by uid or by address, resolved to a uid on the
 * roster — or `null` to clear, or `undefined` when the body named nobody.
 *
 * `ownerEmail` is what a spreadsheet or a zap has; a uid is what the record
 * stores. The address resolves the way the CRM's own import and automation
 * steps resolve one (AGL-2614): against the roster alone, so an address the
 * project's auth knows but the organization does not names nobody. One
 * roster read, paid only when an address was given.
 */
async function readOwner(
  ctx: ApiV1Context,
  body: Record<string, unknown>,
  errors: Record<string, string>,
): Promise<Clearable<string>> {
  const ownerUid = readOptionalText(body, 'ownerUid', CRM_TITLE_MAX, errors)
  const ownerEmail = readOptionalText(body, 'ownerEmail', CRM_TITLE_MAX, errors)
  if (ownerUid !== undefined && ownerEmail !== undefined) {
    errors.ownerEmail = 'Name the owner once — by ownerUid or by ownerEmail, not both'
    return undefined
  }
  if (ownerEmail === undefined) return ownerUid
  if (ownerEmail === null) return null
  const email = normalizeContactEmail(ownerEmail)
  if (!email) {
    errors.ownerEmail = 'Must be an email address'
    return undefined
  }
  const members = await listOrgMembers(ctx.orgId)
  const roster = members
    .map((member) => crmMemberOption(member as unknown as Record<string, unknown>))
    .filter((option): option is NonNullable<typeof option> => option !== null)
  const found = findOrgMember(roster, email)
  if (!found) {
    errors.ownerEmail = 'No member of this organization has this address'
    return undefined
  }
  return found.uid
}

// ── PATCH ───────────────────────────────────────────────────────────────────

const LEAD_WRITABLE = new Set([
  'siteId',
  'status',
  'ownerUid',
  'ownerEmail',
  'notes',
  'unqualifiedReason',
])

interface LeadInput {
  status?: Exclude<CrmLeadStatus, 'qualified'>
  notes?: Clearable<string>
  unqualifiedReason?: Clearable<string>
}

function readLeadInput(
  body: Record<string, unknown>,
): { values: LeadInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: LeadInput = {}
  refuseUnknownKeys(body, LEAD_WRITABLE, 'lead', errors)

  if (body.status !== undefined) {
    if (body.status === 'qualified') {
      errors.status =
        'Not settable — a lead is qualified by converting it: POST /v1/leads/{id}/convert'
    } else if (
      typeof body.status === 'string' &&
      (LEAD_PATCH_STATUSES as readonly string[]).includes(body.status)
    ) {
      values.status = body.status as LeadInput['status']
    } else {
      errors.status = `Must be one of: ${LEAD_PATCH_STATUSES.join(', ')}`
    }
  }
  const notes = readOptionalText(body, 'notes', CRM_TEXT_MAX, errors)
  if (notes !== undefined) values.notes = notes
  const reason = readOptionalText(body, 'unqualifiedReason', CRM_TEXT_MAX, errors)
  if (reason !== undefined) values.unqualifiedReason = reason

  return Object.keys(errors).length ? { errors } : { values }
}

/** `PATCH /v1/leads/{id}`. */
async function updateLead(
  request: Request,
  ctx: ApiV1Context,
  url: URL,
  leadId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readLeadInput(body)
  if ('errors' in parsed) return crmValidationFailed(ctx, 'lead', parsed.errors)
  const site = readLeadSite(ctx, url, body)
  if ('response' in site) return site.response
  const ref = leadsCollection(ctx, site.siteId).doc(leadId)
  const snap = await ref.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such lead', headers: ctx.headers })
  }
  const stored = (snap.data() ?? {}) as Record<string, unknown> & CrmLeadFields

  const { status, unqualifiedReason, ...rest } = parsed.values
  if (status !== undefined && stored.convertedContactId) {
    return ApiErrors.conflict({
      message: 'This lead was converted; its status is fixed',
      code: 'lead_converted',
      headers: ctx.headers,
    })
  }
  const errors: Record<string, string> = {}
  const ownerUid = await readOwner(ctx, body, errors)
  if (ownerUid) Object.assign(errors, await memberError(ctx, 'ownerUid', ownerUid))
  const current = crmLeadStatus(stored)
  const next = status ?? current
  /*
   * A reason travels with the closed state and only with it. Sent beside
   * `status: "unqualified"` it is required; sent on its own it changes the
   * reason of a lead that is already unqualified; sent with any other
   * status it describes a state the lead is not in.
   */
  if (next === 'unqualified') {
    const reason =
      unqualifiedReason !== undefined ? unqualifiedReason : stored.unqualifiedReason
    if (!reason) {
      errors.unqualifiedReason = 'A reason is required to mark a lead unqualified'
    }
  } else if (unqualifiedReason) {
    errors.unqualifiedReason = 'Only an unqualified lead carries a reason'
  }
  if (Object.keys(errors).length) return crmValidationFailed(ctx, 'lead', errors)

  const update: Record<string, unknown> = updatePayload({ ...rest, ownerUid })
  if (status !== undefined && status !== current) update.status = status
  if (next === 'unqualified') {
    if (unqualifiedReason !== undefined) update.unqualifiedReason = unqualifiedReason
  } else if (stored.unqualifiedReason !== undefined) {
    // Reopening drops the reason with the closed state.
    update.unqualifiedReason = FieldValue.delete()
  }
  if (Object.keys(update).length > 0) {
    await ref.update({ ...update, updatedAt: Timestamp.now() })
  }
  return apiJson(leadView(site.siteId, await ref.get()), { headers: ctx.headers })
}

// ── Convert ─────────────────────────────────────────────────────────────────

const CONVERT_KEYS = new Set(['siteId', 'company', 'deal', 'ownerUid', 'ownerEmail'])
const CURRENCY_PATTERN = /^[a-z]{3}$/

type ConvertPlan = Pick<ConvertHostLeadInput, 'companyId' | 'createCompany' | 'deal'>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * The convert body: `company` is `{ link }`, `{ create }` or `null`; `deal`
 * is what to open, or `null`. Each key is named in full — `company.link`,
 * `deal.amountCents` — so a refused nested field is the one the integrator
 * sent.
 */
function readConvertInput(
  body: Record<string, unknown>,
): { plan: ConvertPlan } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const plan: ConvertPlan = {}
  refuseUnknownKeys(body, CONVERT_KEYS, 'conversion', errors)

  if (body.company !== undefined && body.company !== null) {
    if (!isPlainObject(body.company)) {
      errors.company = 'Must be { "link": id }, { "create": { … } } or null'
    } else {
      const company = body.company
      const keys = Object.keys(company)
      const shape = keys.length === 1 ? keys[0] : null
      if (shape === 'link') {
        const link = company.link
        if (typeof link !== 'string' || !link.trim() || link.trim().length > CRM_ID_MAX) {
          errors['company.link'] = 'Must be a company id'
        } else {
          plan.companyId = link.trim()
        }
      } else if (shape === 'create' && isPlainObject(company.create)) {
        const create = company.create
        for (const key of Object.keys(create)) {
          if (key !== 'name' && key !== 'domain') {
            errors[`company.create.${key}`] = 'Not writable on a company created here'
          }
        }
        const name = String(create.name ?? '')
          .trim()
          .slice(0, CRM_LABEL_MAX)
        if (!name) errors['company.create.name'] = 'A name is required'
        let domain: string | null = null
        if (create.domain !== undefined && create.domain !== null) {
          const rawDomain = String(create.domain).trim()
          domain = rawDomain ? normalizeCompanyDomain(rawDomain) : null
          if (rawDomain && !domain) {
            errors['company.create.domain'] = 'Must be a domain, like acme.com'
          }
        }
        if (name) plan.createCompany = { name, domain }
      } else {
        errors.company = 'Must be exactly one of { "link": id } or { "create": { "name", "domain"? } }'
      }
    }
  }

  if (body.deal !== undefined && body.deal !== null) {
    if (!isPlainObject(body.deal)) {
      errors.deal = 'Must be an object, or null'
    } else {
      const deal = body.deal
      for (const key of Object.keys(deal)) {
        if (!['title', 'amountCents', 'currency', 'stageId'].includes(key)) {
          errors[`deal.${key}`] = 'Not writable on a deal opened here'
        }
      }
      const title = String(deal.title ?? '')
        .trim()
        .slice(0, CRM_TITLE_MAX)
      if (!title) errors['deal.title'] = 'A title is required'
      let amountCents: number | null = null
      if (deal.amountCents !== undefined && deal.amountCents !== null) {
        if (
          typeof deal.amountCents !== 'number' ||
          !Number.isInteger(deal.amountCents) ||
          deal.amountCents < 0
        ) {
          errors['deal.amountCents'] = 'Must be a whole number of cents, 0 or more'
        } else {
          amountCents = deal.amountCents
        }
      }
      let currency = 'usd'
      if (deal.currency !== undefined && deal.currency !== null) {
        const value = String(deal.currency).trim().toLowerCase()
        if (CURRENCY_PATTERN.test(value)) currency = value
        else errors['deal.currency'] = 'Must be a three-letter ISO 4217 code, like usd'
      }
      let stageId: string | undefined
      if (deal.stageId !== undefined && deal.stageId !== null) {
        if (typeof deal.stageId !== 'string' || !deal.stageId.trim()) {
          errors['deal.stageId'] = 'Must be a stage id'
        } else {
          stageId = deal.stageId.trim().slice(0, CRM_ID_MAX)
        }
      }
      if (title) plan.deal = { title, amountCents, currency, ...(stageId ? { stageId } : {}) }
    }
  }

  return Object.keys(errors).length ? { errors } : { plan }
}

/** `POST /v1/leads/{id}/convert`. */
async function convertLead(
  request: Request,
  ctx: ApiV1Context,
  url: URL,
  leadId: string,
): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readConvertInput(body)
  if ('errors' in parsed) return crmValidationFailed(ctx, 'conversion', parsed.errors)
  const site = readLeadSite(ctx, url, body)
  if ('response' in site) return site.response
  const errors: Record<string, string> = {}
  const ownerUid = await readOwner(ctx, body, errors)
  if (ownerUid) Object.assign(errors, await memberError(ctx, 'ownerUid', ownerUid))
  if (Object.keys(errors).length) return crmValidationFailed(ctx, 'conversion', errors)

  const ref = leadsCollection(ctx, site.siteId).doc(leadId)
  if (!(await ref.get()).exists) {
    return ApiErrors.notFound({ message: 'No such lead', headers: ctx.headers })
  }

  // Scoped to the SITE: the lead is the site's record, and its id is only
  // unique within the site — see the module header.
  const claimed = await claimWrite(
    ctx,
    site.siteId,
    request.headers.get('Idempotency-Key'),
    'lead-conversions',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const result = await convertHostLead({
      firestore: ctx.firestore,
      hostId: site.siteId,
      orgId: ctx.orgId,
      org: ctx.org as Record<string, unknown>,
      leadId,
      // A key has no uid; `'api'` is the attribution every REST create
      // stamps, and a key owns nothing — see the runtime's header.
      actor: { uid: 'api', email: null, kind: 'api' },
      ...(ownerUid ? { ownerUid } : {}),
      ...parsed.plan,
    })
    if (result.ok === false) {
      await claim.release()
      return convertRefusal(ctx, result.reason)
    }
    const receipt = {
      object: 'lead_conversion',
      id: leadId,
      siteId: site.siteId,
      contactId: result.contactId,
      companyId: result.companyId ?? null,
      dealId: result.dealId ?? null,
      alreadyConverted: result.alreadyConverted,
      lead: leadView(site.siteId, await ref.get()),
    }
    await claim.record(200, receipt)
    return apiJson(receipt, {
      status: result.alreadyConverted ? 200 : 201,
      headers: ctx.headers,
    })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * Each refusal the writes can answer, in the envelope this API publishes.
 * A band is `plan_required` with the creates' own code, because on the one
 * plan that refuses an upgrade is the whole remedy; the rest are states of
 * the record, which is what `409 conflict` means here.
 */
function convertRefusal(
  ctx: ApiV1Context,
  reason: ConvertHostLeadRefusal,
): Response {
  switch (reason) {
    case 'unknown-lead':
      return ApiErrors.notFound({ message: 'No such lead', headers: ctx.headers })
    case 'unknown-company':
      return crmValidationFailed(ctx, 'conversion', {
        'company.link': 'No such company in this organization',
      })
    case 'band-full':
      return ApiErrors.planRequired({
        message:
          'CRM records limit reached across contacts, companies and deals — ' +
          'the lead was not converted. Upgrade the plan to add more.',
        code: 'crm_records_quota',
        headers: ctx.headers,
      })
    case 'no-email':
      return ApiErrors.conflict({
        message: 'This lead has no usable email address to convert',
        code: 'lead_not_convertible',
        headers: ctx.headers,
      })
    case 'contact-not-created':
      return ApiErrors.conflict({
        message:
          'The contact could not be created — the audience band may be full. ' +
          'Nothing was changed.',
        code: 'contact_not_created',
        headers: ctx.headers,
      })
    case 'no-stages':
      return ApiErrors.conflict({
        message: 'The default pipeline has no stages to open a deal in',
        code: 'pipeline_has_no_stages',
        headers: ctx.headers,
      })
  }
}

// ── List ────────────────────────────────────────────────────────────────────

/** The `lastSeen`-ordered cursor: `ms|id`. */
function encodeLeadCursor(lastSeenAtMs: unknown, id: string): string {
  return `${typeof lastSeenAtMs === 'number' ? lastSeenAtMs : 0}|${id}`
}

function decodeLeadCursor(raw: string | undefined): { lastSeenAtMs: number; id: string } | null {
  if (!raw) return null
  const match = /^(\d+)\|(.+)$/.exec(raw)
  return match ? { lastSeenAtMs: Number(match[1]), id: match[2] } : null
}

/** `GET /v1/leads`. */
async function listLeads(ctx: ApiV1Context, url: URL): Promise<Response> {
  const site = readLeadSite(ctx, url)
  if ('response' in site) return site.response
  const rawStatus = (url.searchParams.get('status') ?? '').trim()
  if (rawStatus && !(CRM_LEAD_STATUSES as readonly string[]).includes(rawStatus)) {
    return crmValidationFailed(ctx, 'lead filter', {
      status: `Must be one of: ${CRM_LEAD_STATUSES.join(', ')}`,
    })
  }
  const status = rawStatus as CrmLeadStatus | ''
  const ownerUid = (url.searchParams.get('ownerUid') ?? '').trim().slice(0, CRM_ID_MAX)

  const limit = parseLimit(url.searchParams.get('limit'))
  let query: FirebaseFirestore.Query = leadsCollection(ctx, site.siteId)
    .orderBy('lastSeenAtMs', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(limit + 1)
  const cursor = decodeLeadCursor(decodeCursor(url.searchParams.get('cursor')))
  if (cursor) query = query.startAfter(cursor.lastSeenAtMs, cursor.id)
  const snap = await query.get()
  const docs = snap.docs.slice(0, limit)
  const last = docs[docs.length - 1]
  const nextCursor =
    snap.docs.length > limit && last
      ? encodeCursor(encodeLeadCursor(last.get('lastSeenAtMs'), last.id))
      : null
  const page = docs.filter((doc) => {
    const data = (doc.data() ?? {}) as CrmLeadFields
    if (status && crmLeadStatus(data) !== status) return false
    if (ownerUid && data.ownerUid !== ownerUid) return false
    return true
  })
  return listResponse(
    page.map((doc) => leadView(site.siteId, doc)),
    nextCursor,
    ctx.headers,
  )
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export async function handleLeads(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const [, leadId, action] = segments

  if (!leadId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'crm:read')
      if (denied) return denied
      return listLeads(ctx, url)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET' },
    })
  }

  if (action === 'convert') {
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'crm:write')
      if (denied) return denied
      return convertLead(request, ctx, url, leadId)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'POST' },
    })
  }
  if (action !== undefined) {
    return ApiErrors.notFound({
      message: `Unknown endpoint: /v1/${segments.join('/')}`,
      headers: ctx.headers,
    })
  }

  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'crm:read')
    if (denied) return denied
    const site = readLeadSite(ctx, url)
    if ('response' in site) return site.response
    const snap = await leadsCollection(ctx, site.siteId).doc(leadId).get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such lead', headers: ctx.headers })
    }
    return apiJson(leadView(site.siteId, snap), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return updateLead(request, ctx, url, leadId)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH' },
  })
}
