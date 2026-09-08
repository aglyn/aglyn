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
 * `/v1/email-templates` (AGL-2658) — the letters a team sends from a
 * record: a TEMPLATE is a subject and a body under a name, a SNIPPET a
 * paragraph under one, and both may carry merge fields the send fills in
 * (`crm-email-templates.ts`). An integration seeds a workspace's letters
 * with this, or keeps them in step with another tool.
 *
 * ## Whose a template is
 *
 * `visibility` is `shared` — every CRM editor's — unless it is `personal`,
 * and a personal template names its `ownerUid`, the one member whose menu
 * lists it. The two travel together: a personal template with no owner
 * would be listed for nobody, and a shared one with an owner would claim a
 * privacy the console does not enforce, so a write that separates them is
 * refused rather than stored. Flipping a template to shared drops its
 * owner; flipping it to personal needs one named.
 *
 * ## A snippet has no subject
 *
 * The console fills a template's subject into the email and inserts a
 * snippet into the body, so a subject on a snippet would be a field
 * nothing reads. It is stored empty whatever was sent, and a template's
 * subject is optional: an email keeps its own when the template has none.
 */
import {
  CRM_COLLECTIONS,
  CRM_EMAIL_BODY_MAX,
  CRM_EMAIL_SUBJECT_MAX,
  CRM_EMAIL_TEMPLATE_NAME_MAX,
  type CrmEmailTemplate,
  type CrmEmailTemplateKind,
  type CrmEmailTemplateVisibility,
  createResourceUid,
} from '@aglyn/aglyn/server'
import { apiJson, ApiErrors } from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { type ApiV1Context, requireScope } from '../api-v1'
import {
  type Clearable,
  CRM_TITLE_MAX,
  createPayload,
  crmCollection,
  crmCreateStamp,
  crmTimes,
  crmValidationFailed,
  listCrm,
  memberError,
  readChoice,
  readCrmSite,
  readEqualityFilters,
  readOptionalText,
  refuseUnknownKeys,
  updatePayload,
} from './crm-shared'
import { claimWrite, readJsonBody } from './shared'

/*
 * Spelled here rather than imported: the `/v1` suites mock the model as a
 * closed world, and a module-level read of an export they did not ask for
 * would throw at import in every suite that never asked for the CRM.
 */
const TEMPLATE_KINDS = ['template', 'snippet'] as const
const TEMPLATE_VISIBILITIES = ['shared', 'personal'] as const

/** The template object as published. Every writable field appears here. */
function templateView(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = (doc.data() ?? {}) as Partial<CrmEmailTemplate>
  return {
    id: doc.id,
    object: 'email_template',
    name: data.name ?? null,
    kind: data.kind ?? 'template',
    visibility: data.visibility ?? 'shared',
    ownerUid: data.ownerUid ?? null,
    subject: data.subject ?? '',
    body: data.body ?? '',
    siteId: data.hostId ?? null,
    ...crmTimes(data as FirebaseFirestore.DocumentData),
  }
}

const TEMPLATE_WRITABLE = new Set(['name', 'kind', 'visibility', 'ownerUid', 'subject', 'body'])

interface TemplateInput {
  name?: string
  kind?: CrmEmailTemplateKind
  visibility?: CrmEmailTemplateVisibility
  ownerUid?: Clearable<string>
  /** `''` clears; a template keeps its own subject optional. */
  subject?: string
  body?: string
}

/** Paragraphs as one string: line endings normalized, as the send route stores them. */
const paragraphs = (value: string, max: number): string =>
  value
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max)

function readTemplateInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: TemplateInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const values: TemplateInput = {}
  const allowed = new Set(TEMPLATE_WRITABLE)
  if (!partial) allowed.add('consentSiteId')
  refuseUnknownKeys(body, allowed, 'email template', errors)

  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '')
      .trim()
      .slice(0, CRM_EMAIL_TEMPLATE_NAME_MAX)
    if (name) values.name = name
    else errors.name = partial ? 'Must not be empty' : 'A name is required'
  }

  const kind = readChoice(body, 'kind', TEMPLATE_KINDS, errors)
  if (kind) values.kind = kind
  const visibility = readChoice(body, 'visibility', TEMPLATE_VISIBILITIES, errors)
  if (visibility) values.visibility = visibility
  const ownerUid = readOptionalText(body, 'ownerUid', CRM_TITLE_MAX, errors)
  if (ownerUid !== undefined) values.ownerUid = ownerUid

  if (body.subject !== undefined) {
    if (body.subject === null) {
      values.subject = ''
    } else if (typeof body.subject !== 'string') {
      errors.subject = 'Must be a string'
    } else {
      values.subject = body.subject.trim().slice(0, CRM_EMAIL_SUBJECT_MAX)
    }
  }

  if (body.body !== undefined || !partial) {
    if (typeof body.body !== 'string' && body.body !== undefined) {
      errors.body = 'Must be a string'
    } else {
      const text = paragraphs(String(body.body ?? ''), CRM_EMAIL_BODY_MAX)
      if (text) values.body = text
      else errors.body = partial ? 'Must not be empty' : 'A message is required'
    }
  }

  return Object.keys(errors).length ? { errors } : { values }
}

/**
 * The owner a write leaves the template with, given what it will be after
 * the write — see the module header. `null` means "no owner", which is a
 * field delete on an update and nothing on a create.
 */
function placeOwner(
  values: TemplateInput,
  stored: Partial<CrmEmailTemplate> | null,
): { ownerUid: string | null } | { errors: Record<string, string> } {
  const visibility = values.visibility ?? stored?.visibility ?? 'shared'
  const owner =
    values.ownerUid !== undefined ? values.ownerUid : (stored?.ownerUid ?? null)
  if (visibility === 'personal') {
    return owner
      ? { ownerUid: owner }
      : { errors: { ownerUid: 'A personal template names the member it is for' } }
  }
  if (values.ownerUid) {
    return { errors: { ownerUid: 'Only a personal template has an owner — set visibility: "personal"' } }
  }
  return { ownerUid: null }
}

/** `POST /v1/email-templates`. */
async function createTemplate(request: Request, ctx: ApiV1Context): Promise<Response> {
  const body = await readJsonBody(request)
  const parsed = readTemplateInput(body, { partial: false })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'email template', parsed.errors)
  const site = readCrmSite(ctx, 'email template', body)
  if ('response' in site) return site.response
  const placed = placeOwner(parsed.values, null)
  if ('errors' in placed) return crmValidationFailed(ctx, 'email template', placed.errors)
  const owner = await memberError(ctx, 'ownerUid', placed.ownerUid)
  if (Object.keys(owner).length) return crmValidationFailed(ctx, 'email template', owner)

  const collection = crmCollection(ctx, CRM_COLLECTIONS.emailTemplates)
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'email-templates',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed

  try {
    const { name, kind, visibility, subject, body: text } = parsed.values
    const id = createResourceUid()
    const stamp = crmCreateStamp(ctx, site.siteId)
    const nowMs = stamp.createdAt.toMillis()
    const storedKind = kind ?? 'template'
    await collection.doc(id).create({
      name,
      kind: storedKind,
      visibility: visibility ?? 'shared',
      subject: storedKind === 'template' ? (subject ?? '') : '',
      body: text,
      ...createPayload({ ownerUid: placed.ownerUid }),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      ...stamp,
    })
    const view = templateView(await collection.doc(id).get())
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `PATCH /v1/email-templates/{id}`. */
async function updateTemplate(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const parsed = readTemplateInput(await readJsonBody(request), { partial: true })
  if ('errors' in parsed) return crmValidationFailed(ctx, 'email template', parsed.errors)
  const snap = await ref.get()
  if (!snap.exists) {
    return ApiErrors.notFound({ message: 'No such email template', headers: ctx.headers })
  }
  const stored = (snap.data() ?? {}) as Partial<CrmEmailTemplate>
  const placed = placeOwner(parsed.values, stored)
  if ('errors' in placed) return crmValidationFailed(ctx, 'email template', placed.errors)
  if (placed.ownerUid && placed.ownerUid !== stored.ownerUid) {
    const owner = await memberError(ctx, 'ownerUid', placed.ownerUid)
    if (Object.keys(owner).length) return crmValidationFailed(ctx, 'email template', owner)
  }

  const { ownerUid: _ignored, ...rest } = parsed.values
  const kind = rest.kind ?? stored.kind ?? 'template'
  const update: Record<string, unknown> = updatePayload({
    ...rest,
    // A snippet keeps no subject, whatever the body sent or the row held.
    ...(kind === 'snippet' ? { subject: '' } : {}),
    ownerUid: placed.ownerUid,
  })
  if (Object.keys(update).length > 0) {
    const now = Timestamp.now()
    await ref.update({ ...update, updatedAtMs: now.toMillis(), updatedAt: now })
  }
  return apiJson(templateView(await ref.get()), { headers: ctx.headers })
}

/** `DELETE /v1/email-templates/{id}`. */
async function deleteTemplate(
  request: Request,
  ctx: ApiV1Context,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Response> {
  const claimed = await claimWrite(
    ctx,
    '*',
    request.headers.get('Idempotency-Key'),
    'email-template-deletes',
  )
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const snap = await ref.get()
    if (!snap.exists) {
      await claim.release()
      return ApiErrors.notFound({ message: 'No such email template', headers: ctx.headers })
    }
    await ref.delete()
    const view = { id: ref.id, object: 'email_template', deleted: true }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

/** `GET /v1/email-templates` filters, most selective first. */
async function listTemplates(
  ctx: ApiV1Context,
  collection: FirebaseFirestore.CollectionReference,
  url: URL,
): Promise<Response> {
  const errors: Record<string, string> = {}
  const rawKind = url.searchParams.get('kind')
  if (rawKind !== null && rawKind.trim() !== '' && !(TEMPLATE_KINDS as readonly string[]).includes(rawKind.trim())) {
    errors.kind = `Must be one of: ${TEMPLATE_KINDS.join(', ')}`
  }
  const rawVisibility = url.searchParams.get('visibility')
  if (
    rawVisibility !== null &&
    rawVisibility.trim() !== '' &&
    !(TEMPLATE_VISIBILITIES as readonly string[]).includes(rawVisibility.trim())
  ) {
    errors.visibility = `Must be one of: ${TEMPLATE_VISIBILITIES.join(', ')}`
  }
  if (Object.keys(errors).length) return crmValidationFailed(ctx, 'email template filter', errors)
  const filters = readEqualityFilters(url, ['ownerUid', 'kind', 'visibility'])
  return listCrm(ctx, collection, url, filters, templateView)
}

export async function handleEmailTemplates(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
): Promise<Response> {
  const collection = crmCollection(ctx, CRM_COLLECTIONS.emailTemplates)
  const [, templateId] = segments

  if (!templateId) {
    if (request.method === 'GET') {
      const denied = requireScope(ctx, 'crm:read')
      if (denied) return denied
      return listTemplates(ctx, collection, url)
    }
    if (request.method === 'POST') {
      const denied = requireScope(ctx, 'crm:write')
      if (denied) return denied
      return createTemplate(request, ctx)
    }
    return ApiErrors.methodNotAllowed({
      headers: { ...ctx.headers, Allow: 'GET, POST' },
    })
  }

  const ref = collection.doc(templateId)
  if (request.method === 'GET') {
    const denied = requireScope(ctx, 'crm:read')
    if (denied) return denied
    const snap = await ref.get()
    if (!snap.exists) {
      return ApiErrors.notFound({ message: 'No such email template', headers: ctx.headers })
    }
    return apiJson(templateView(snap), { headers: ctx.headers })
  }
  if (request.method === 'PATCH') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return updateTemplate(request, ctx, ref)
  }
  if (request.method === 'DELETE') {
    const denied = requireScope(ctx, 'crm:write')
    if (denied) return denied
    return deleteTemplate(request, ctx, ref)
  }
  return ApiErrors.methodNotAllowed({
    headers: { ...ctx.headers, Allow: 'GET, PATCH, DELETE' },
  })
}
