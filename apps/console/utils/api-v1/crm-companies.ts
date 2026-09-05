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
 * `/v1/companies` (AGL-2606) — the organizations behind the people.
 *
 * A company is keyed, in practice, by its domain: two contacts at
 * `acme.com` work for one company, and the console's auto-association
 * (`companyDomainForEmail`) files them under it by that string. So the
 * domain is normalized exactly as the console stores it, a second company on
 * a domain already held is a `409 company_exists` naming the first — the
 * contact create's own rule for a second row on one email — and `?domain=`
 * is the lookup a sync starts with.
 */
import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import {
  CRM_COLLECTIONS,
  createResourceUid,
  normalizeAddress,
  normalizeCompanyDomain,
  normalizePhone,
} from '@aglyn/aglyn/server'
import { apiJson, ApiErrors } from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from '../api-v1'
import {
  type Clearable,
  CRM_LABEL_MAX,
  CRM_TEXT_MAX,
  CRM_TITLE_MAX,
  createPayload,
  crmCollection,
  crmCreateStamp,
  crmTimes,
  crmValidationFailed,
  listCrm,
  memberError,
  readCrmSite,
  readEqualityFilters,
  readOptionalText,
  refuseUnknownKeys,
  updatePayload,
} from './crm-shared'
import { claimWrite, readJsonBody } from './shared'

/** The company object as published. Every writable field appears here. */
function companyView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {}
  return {
    id: doc.id,
    object: 'company',
    name: data.name ?? null,
    domain: data.domain ?? null,
    website: data.website ?? null,
    phone: data.phone ?? null,
    address: data.address ?? null,
    industry: data.industry ?? null,
    ownerUid: data.ownerUid ?? null,
    notes: data.notes ?? null,
    siteId: data.hostId ?? null,
    ...crmTimes(data),
  }
}

const COMPANY_WRITABLE = new Set([
  'name',
  'domain',
  'website',
  'phone',
  'address',
  'industry',
  'ownerUid',
  'notes',
])

interface CompanyInput {
  name?: string
  domain?: Clearable<string>
  website?: Clearable<string>
  phone?: Clearable<string>
  address?: Clearable<ReturnType<typeof normalizeAddress>>
  industry?: Clearable<string>
  ownerUid?: Clearable<string>
  notes?: Clearable<string>
}

/**
 * The writable half of a company, validated. `partial` separates PATCH from
 * POST as every reader in this API does: a create needs a name, an update
 * may send one field alone. Unknown keys are named, never dropped.
 *
 * `domain` and `phone` go through the console's own normalizers so the API
 * cannot store a value the console would never have written, and a value
 * that does not survive normalization names the field rather than storing
 * the raw string — a raw domain would never match the auto-association, and
 * a raw phone is the unusable half-number `normalizePhone` exists to end.
 */
function readCompanyInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: CompanyInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: CompanyInput = {}
  const allowed = new Set(COMPANY_WRITABLE)
  if (!partial) allowed.add('consentSiteId')
  refuseUnknownKeys(body, allowed, 'company', errors)

  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '')
      .trim()
      .slice(0, CRM_TITLE_MAX)
    if (name) values.name = name
    else errors.name = partial ? 'Must not be empty' : 'A name is required'
  }

  const domain = readOptionalText(body, 'domain', CRM_TITLE_MAX, errors)
  if (domain) {
    const normalized = normalizeCompanyDomain(domain)
    if (normalized) values.domain = normalized
    else errors.domain = 'Must be a domain name, like acme.com'
  } else if (domain === null) {
    values.domain = null
  }

  const website = readOptionalText(body, 'website', CRM_TITLE_MAX * 4, errors)
  if (website) {
    // A bare `acme.com` is what people paste; stored with the scheme so the
    // console can render it as a link without guessing one.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(website)
      ? website
      : `https://${website}`
    let parsed: URL | null = null
    try {
      parsed = new URL(withScheme)
    } catch {
      parsed = null
    }
    if (parsed && /^https?:$/.test(parsed.protocol) && normalizeCompanyDomain(parsed.hostname)) {
      values.website = parsed.toString()
    } else {
      errors.website = 'Must be a web address, like https://acme.com'
    }
  } else if (website === null) {
    values.website = null
  }

  const phone = readOptionalText(body, 'phone', CRM_LABEL_MAX, errors)
  if (phone) {
    const normalized = normalizePhone(phone)
    if (normalized) values.phone = normalized
    else errors.phone = 'Must be a phone number with a country code, like +15125550123'
  } else if (phone === null) {
    values.phone = null
  }

  if (body.address !== undefined) {
    if (body.address === null) {
      values.address = null
    } else if (typeof body.address !== 'object' || Array.isArray(body.address)) {
      errors.address = 'Must be an address object'
    } else {
      // A blank address normalizes to `null`, which clears — an object of
      // empty strings must not read as "has an address".
      values.address = normalizeAddress(body.address as never)
    }
  }

  const industry = readOptionalText(body, 'industry', CRM_LABEL_MAX, errors)
  if (industry !== undefined) values.industry = industry

  const ownerUid = readOptionalText(body, 'ownerUid', CRM_LABEL_MAX, errors)
  if (ownerUid !== undefined) values.ownerUid = ownerUid

  const notes = readOptionalText(body, 'notes', CRM_TEXT_MAX, errors)
  if (notes !== undefined) values.notes = notes

  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * `POST /v1/companies`. Claimed first and released on the duplicate, the
 * ordering `createContact` argues for: a refusal that clears when the
 * duplicate is removed must not burn the key the retry will carry.
 */
async function createCompany(
  request: Request,
  ctx: ApiV1Context,
): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readCompanyInput(body, { partial: false })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'company', parsed.errors)
  const site = readCrmSite(ctx, 'company', body)
  if ('response' in site) return site.response
  const owner = await memberError(ctx, 'ownerUid', parsed.values.ownerUid)
  if (Object.keys(owner).length) return crmValidationFailed(ctx, 'company', owner)

  const collection = crmCollection(ctx, CRM_COLLECTIONS.companies)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'companies',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const { name, domain, ...rest } = parsed.values
    if (domain) {
      const existing = await collection.where('domain', '==', domain).limit(1).get()
      if (!existing.empty) {
        await claim.release()
        return ApiErrors.conflict({
          message: `A company with this domain already exists (${existing.docs[0].id}). Update it instead.`,
          code: 'company_exists',
          headers: ctx.headers,
        })
      }
    }
    const id = createResourceUid()
    await collection.doc(id).create({
      // `nameLower`/`nameTokens` travel with the name: the console's company
      // list searches the collection, not the page it fetched.
      ...nameSearchFields(name ?? ''),
      ...createPayload({ domain, ...rest }),
      ...crmCreateStamp(ctx, site.siteId),
    })
    const view = companyView(await collection.doc(id).get())
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `PATCH /v1/companies/{id}` — no key, for `updateContact`'s reason. */
async function updateCompany(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const parsed = readCompanyInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'company', parsed.errors)
  const snap = await ref.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such company', headers: ctx.headers })
  }
  const owner = await memberError(ctx, 'ownerUid', parsed.values.ownerUid)
  if (Object.keys(owner).length) return crmValidationFailed(ctx, 'company', owner)

  const { name, domain, ...rest } = parsed.values
  if (domain && domain !== snap.get('domain')) {
    const existing = await ref.parent.where('domain', '==', domain).limit(1).get()
    if (!existing.empty && existing.docs[0].id !== ref.id) {
      return ApiErrors.conflict({
        message: `A company with this domain already exists (${existing.docs[0].id}).`,
        code: 'company_exists',
        headers: ctx.headers,
      })
    }
  }
  const update: Record<string, unknown> = {
    ...(name !== undefined ? nameSearchFields(name) : {}),
    ...updatePayload({ domain, ...rest }),
  }
  // An empty body is a no-op answered with the current company.
  if (Object.keys(update).length > 0) {
    await ref.update({ ...update, updatedAt: Timestamp.now() })
  }
  return apiJson(companyView(await ref.get()), { headers: ctx.headers })
}

/**
 * `DELETE /v1/companies/{id}` — the company alone. The deals, tasks and
 * activities filed against it keep their `companyId`; they are records of
 * their own, and a delete that cascaded through them would erase a sales
 * history because somebody removed a duplicate account.
 */
async function deleteCompany(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'company-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const snap = await ref.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({ message: 'No such company', headers: ctx.headers })
    }
    await ref.delete()
    const view = { id: ref.id, object: 'company', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/**
 * `GET /v1/companies` filters. `domain` is normalized exactly as the write
 * stores it, so `?domain=https://www.Acme.com/about` finds `acme.com`; a
 * value that is not a domain at all is a `400`, not an empty page, for the
 * reason `listContacts` gives about `?email=`.
 */
async function listCompanies(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const rawDomain = url.searchParams.get('domain')
  const filters = readEqualityFilters(url, ['ownerUid'])
  if (rawDomain !== null && rawDomain.trim() !== '') {
    const domain = normalizeCompanyDomain(rawDomain)
    if (!domain) {
      return crmValidationFailed(ctx, 'company filter', {
        domain: 'Must be a domain name, like acme.com',
      })
    }
    // The domain is unique, so it is the clause that goes to Firestore.
    filters.unshift({ field: 'domain', value: domain })
  }
  return listCrm(ctx, collection, url, filters, companyView)
}

export async function handleCompanies(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = crmCollection(ctx, CRM_COLLECTIONS.companies)
  const [, companyId] = segments

  if (!companyId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'crm:read')
      if (denied) return denied
      return listCompanies(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'crm:write')
      if (denied) return denied
      return createCompany(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const ref = collection.doc(companyId)
  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'crm:read')
    if (denied) return denied
    const snap = await ref.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such company', headers: ctx.headers })
    }
    return apiJson(companyView(snap), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return updateCompany(request, ctx, ref)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return deleteCompany(request, ctx, ref)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}
