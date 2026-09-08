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

/*==========================================
 * EMAIL TEMPLATES, SNIPPETS AND MERGE FIELDS (AGL-2658).
 *
 * A one-to-one email is a letter, and a rep writes the same three letters
 * all week: the follow-up, the proposal cover note, the "still keen?". A
 * TEMPLATE is one of those letters kept under a name — a subject and a body
 * the dialog fills in whole. A SNIPPET is a paragraph kept under a name —
 * a signature block, a pricing line — inserted where the caret is. Both
 * carry MERGE FIELDS, `{{contact.firstName}}` and the like, which the send
 * route fills from the record the email is about, so a template written
 * once reads as a letter to each person it is sent to.
 *
 * ## One resolver, run twice
 *
 * The server resolves at send time, off the documents it has already read
 * to find the recipient, and what it writes to the timeline is the letter
 * as it left. The dialog runs the SAME resolver over the same documents to
 * show the rep what will go out, so the preview and the message cannot
 * disagree. The resolver is pure and lives here, beside the model, so
 * neither caller can drift into its own grammar.
 *
 * ## What a field with no value does
 *
 * It renders as nothing. A template that greets `{{contact.firstName}}` is
 * sent to a contact known only by email as "Hi ," — which is why the dialog
 * counts the empty fields and says so before the rep clicks Send, and why
 * an unknown field name renders as nothing too rather than as its own
 * braces: a typo in a merge field must not reach a customer as `{{contct.
 * firstName}}`. Nothing is escaped, because the mail is plain text.
 *
 * ## Shared or personal
 *
 * A template is either the team's — every CRM editor may use and change it
 * — or one person's, listed for its owner alone. The rules gate the writes
 * (`cloud/firebase-firestore.rules`); the listing hides a colleague's
 * personal rows the way a private saved view is hidden (AGL-2617), because
 * a rule per reader would need a query per reader.
 *==========================================*/

import {
  contactDisplayName,
  normalizeContactEmail,
  readContactFacet,
} from './contacts'
import { CRM_EMAIL_BODY_MAX, CRM_EMAIL_SUBJECT_MAX, type CrmScoped } from './crm'

/** The most a template's name may hold. */
export const CRM_EMAIL_TEMPLATE_NAME_MAX = 80

/**
 * The listing's window, and the ceiling the console's create respects.
 *
 * A LOOKUP rather than a list: the picker is a menu a rep opens, and two
 * hundred named letters for one workspace is past what anybody scrolls.
 * Bounded so the listen cannot grow with the org.
 */
export const CRM_EMAIL_TEMPLATES_LIMIT = 200

/** A whole letter under a name, or a paragraph under one. */
export const CRM_EMAIL_TEMPLATE_KINDS = ['template', 'snippet'] as const
export type CrmEmailTemplateKind = (typeof CRM_EMAIL_TEMPLATE_KINDS)[number]

export const CRM_EMAIL_TEMPLATE_KIND_LABELS: Record<CrmEmailTemplateKind, string> = {
  template: 'Template',
  snippet: 'Snippet',
}

export function isCrmEmailTemplateKind(value: unknown): value is CrmEmailTemplateKind {
  return (
    typeof value === 'string' &&
    (CRM_EMAIL_TEMPLATE_KINDS as readonly string[]).includes(value)
  )
}

/** The team's, or one person's. */
export const CRM_EMAIL_TEMPLATE_VISIBILITIES = ['shared', 'personal'] as const
export type CrmEmailTemplateVisibility = (typeof CRM_EMAIL_TEMPLATE_VISIBILITIES)[number]

export const CRM_EMAIL_TEMPLATE_VISIBILITY_LABELS: Record<CrmEmailTemplateVisibility, string> = {
  shared: 'Shared',
  personal: 'Personal',
}

export function isCrmEmailTemplateVisibility(
  value: unknown,
): value is CrmEmailTemplateVisibility {
  return (
    typeof value === 'string' &&
    (CRM_EMAIL_TEMPLATE_VISIBILITIES as readonly string[]).includes(value)
  )
}

/**
 * `orgs/{orgId}/crmEmailTemplates/{templateId}`.
 *
 * Scoped like a task (AGL-2637): under a site it carries that site's tokens
 * and `hostId`; written from the organization's own hub it carries the org
 * token and `hostId: null`, because a letter the whole workspace keeps is
 * not any one brand's. `ownerUid` is set on a personal template only, and
 * is the one member the listing shows it to.
 */
export interface CrmEmailTemplate extends Omit<CrmScoped, 'hostId'> {
  /** The site it was written under, or `null` for the organization's own. */
  hostId: string | null
  name: string
  /** The subject line a template fills in; `''` on a snippet. */
  subject: string
  /** Plain text, with merge fields — see {@link renderCrmMergeFields}. */
  body: string
  kind: CrmEmailTemplateKind
  visibility: CrmEmailTemplateVisibility
  /** The one member a personal template is listed for; absent on a shared one. */
  ownerUid?: string
  /** Who made it — `'api'` for a key, which has no uid. */
  createdByUid: string
  createdAtMs: number
  updatedAtMs: number
}

/** A template as a listener hands it back: the document plus its id. */
export type CrmEmailTemplateRow = CrmEmailTemplate & { $id: string }

/**
 * Whether a template belongs in `uid`'s menu: every shared one, and the
 * personal ones they own. A colleague's personal template is readable under
 * the rules and hidden here — see the module header.
 */
export function crmEmailTemplateIsListed(
  template: Pick<CrmEmailTemplate, 'visibility' | 'ownerUid'>,
  uid: string | null | undefined,
): boolean {
  if (template.visibility !== 'personal') return true
  return Boolean(uid) && template.ownerUid === uid
}

const asText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : ''

const asMs = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * A stored document held to shape, for a listener that reads it raw.
 *
 * Lenient where the rules are not: a kind or a visibility the union does not
 * name reads as the default, because a row some other writer produced is
 * still a letter somebody kept, and dropping it from the menu would lose it.
 */
export function normalizeCrmEmailTemplate(
  row: Record<string, unknown> | null | undefined,
): CrmEmailTemplate {
  const data = row ?? {}
  const visibility = isCrmEmailTemplateVisibility(data['visibility'])
    ? data['visibility']
    : 'shared'
  const ownerUid = asText(data['ownerUid'], 128)
  return {
    name: asText(data['name'], CRM_EMAIL_TEMPLATE_NAME_MAX).trim(),
    subject: asText(data['subject'], CRM_EMAIL_SUBJECT_MAX),
    body: asText(data['body'], CRM_EMAIL_BODY_MAX),
    kind: isCrmEmailTemplateKind(data['kind']) ? data['kind'] : 'template',
    visibility,
    ...(visibility === 'personal' && ownerUid ? { ownerUid } : {}),
    createdByUid: asText(data['createdByUid'], 128),
    createdAtMs: asMs(data['createdAtMs']),
    updatedAtMs: asMs(data['updatedAtMs']),
    hostId: typeof data['hostId'] === 'string' ? data['hostId'] : null,
    visibleTo: Array.isArray(data['visibleTo'])
      ? (data['visibleTo'] as unknown[]).map(String)
      : [],
    createdAt: data['createdAt'],
    updatedAt: data['updatedAt'],
  }
}

/*==========================================
 * MERGE FIELDS.
 *==========================================*/

/** The group a field belongs to, as the picker headings it. */
export type CrmMergeFieldGroup = 'Contact' | 'Lead' | 'Deal' | 'You' | 'Site'

export interface CrmMergeFieldDefinition {
  key: string
  label: string
  group: CrmMergeFieldGroup
}

/**
 * Every field the resolver knows, in the order the picker offers them.
 *
 * A fixed list rather than a path into the document, because a merge field
 * is a promise about what a person will read: `contact.title` has to mean
 * the job title on every send, whatever the document happens to call it
 * this year, and a free path would let a template reach into a note or a
 * consent map.
 */
export const CRM_MERGE_FIELDS: readonly CrmMergeFieldDefinition[] = [
  { key: 'contact.firstName', label: 'First name', group: 'Contact' },
  { key: 'contact.lastName', label: 'Last name', group: 'Contact' },
  { key: 'contact.name', label: 'Full name', group: 'Contact' },
  { key: 'contact.email', label: 'Email address', group: 'Contact' },
  { key: 'contact.company', label: 'Company', group: 'Contact' },
  { key: 'contact.title', label: 'Job title', group: 'Contact' },
  { key: 'lead.firstName', label: 'First name', group: 'Lead' },
  { key: 'lead.lastName', label: 'Last name', group: 'Lead' },
  { key: 'lead.name', label: 'Full name', group: 'Lead' },
  { key: 'lead.email', label: 'Email address', group: 'Lead' },
  { key: 'deal.name', label: 'Deal name', group: 'Deal' },
  { key: 'deal.amount', label: 'Deal amount', group: 'Deal' },
  { key: 'sender.firstName', label: 'Your first name', group: 'You' },
  { key: 'sender.name', label: 'Your name', group: 'You' },
  { key: 'sender.email', label: 'Your email address', group: 'You' },
  { key: 'site.name', label: 'Site name', group: 'Site' },
]

/** `{{key}}` — the one spelling the resolver reads and the picker inserts. */
export function crmMergeFieldToken(key: string): string {
  return `{{${key}}}`
}

/**
 * What the resolver reads from: the documents as they are stored, so the
 * send route hands over what it already read and the dialog what it
 * fetched for the preview, with no projection in between to drift.
 */
export interface CrmMergeContext {
  /** The contact document, `orgs/{orgId}/contacts/{id}`. */
  contact?: Record<string, unknown> | null
  /**
   * The holder group whose facet names the contact — the sending site's,
   * since a name, a job title and a company are one holder's knowledge of
   * a person (`readContactFacet`). The canonical name is the fallback.
   */
  contactGroupId?: string | null
  /** The lead document, `hosts/{hostId}/leads/{id}`. */
  lead?: Record<string, unknown> | null
  /** The deal document, `orgs/{orgId}/deals/{id}`. */
  deal?: Record<string, unknown> | null
  /** The person sending, as their token or session names them. */
  sender?: { name?: string | null; email?: string | null } | null
  /** The site the email leaves from. */
  site?: { name?: string | null } | null
}

export interface CrmMergeResult {
  /** The text with every field replaced — by its value, or by nothing. */
  text: string
  /** The fields that rendered as nothing, unique, in order of appearance. */
  unresolved: string[]
}

/*
 * `{{ group.field }}`, spaces allowed inside the braces because a rep will
 * type them. A single brace pair or a bare word is left alone: a letter may
 * legitimately contain braces.
 */
const MERGE_FIELD_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)\s*\}\}/g

/** The merge fields a text names, unique, in order of first appearance. */
export function crmMergeFieldsIn(text: string): string[] {
  const seen = new Set<string>()
  const fields: string[] = []
  for (const match of String(text ?? '').matchAll(MERGE_FIELD_PATTERN)) {
    const key = match[1]
    if (seen.has(key)) continue
    seen.add(key)
    fields.push(key)
  }
  return fields
}

export function hasCrmMergeFields(text: string): boolean {
  MERGE_FIELD_PATTERN.lastIndex = 0
  return MERGE_FIELD_PATTERN.test(String(text ?? ''))
}

/** A name as one string → its first word and the rest. */
export function splitPersonName(name: unknown): { firstName: string; lastName: string } {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return {
    firstName: words[0] ?? '',
    lastName: words.slice(1).join(' '),
  }
}

/**
 * A deal's amount as a letter prints it.
 *
 * A fixed locale rather than the reader's, on purpose: the server has no
 * reader, and the preview has to print what the server will send. Cents
 * that are not a number render as nothing, so a deal with no value greets
 * nobody with "$0.00".
 */
export function formatCrmMergeAmount(cents: unknown, currency: unknown): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  const code = String(currency || 'usd').toUpperCase()
  const amount = cents / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** One field's value from the context, or `''` for anything it cannot answer. */
function resolveCrmMergeField(key: string, context: CrmMergeContext): string {
  const [group, field] = key.split('.')
  switch (group) {
    case 'contact': {
      const contact = context.contact
      if (!contact) return ''
      const groupId = text(context.contactGroupId)
      const facet = readContactFacet(contact, groupId)
      const name = groupId
        ? contactDisplayName(contact, groupId)
        : text(contact['name'])
      switch (field) {
        case 'firstName':
          return splitPersonName(name).firstName
        case 'lastName':
          return splitPersonName(name).lastName
        case 'name':
          return name
        case 'email':
          return normalizeContactEmail(contact['email']) ?? ''
        case 'company':
          return text(facet.companyName)
        case 'title':
          return text(facet.jobTitle)
        default:
          return ''
      }
    }
    case 'lead': {
      const lead = context.lead
      if (!lead) return ''
      switch (field) {
        case 'firstName':
          return splitPersonName(lead['name']).firstName
        case 'lastName':
          return splitPersonName(lead['name']).lastName
        case 'name':
          return text(lead['name'])
        case 'email':
          return normalizeContactEmail(lead['email']) ?? ''
        default:
          return ''
      }
    }
    case 'deal': {
      const deal = context.deal
      if (!deal) return ''
      switch (field) {
        case 'name':
          return text(deal['title'])
        case 'amount':
          return formatCrmMergeAmount(deal['amountCents'], deal['currency'])
        default:
          return ''
      }
    }
    case 'sender': {
      const sender = context.sender
      if (!sender) return ''
      switch (field) {
        case 'firstName':
          return splitPersonName(sender.name).firstName
        case 'name':
          return text(sender.name)
        case 'email':
          return normalizeContactEmail(sender.email) ?? ''
        default:
          return ''
      }
    }
    case 'site':
      return field === 'name' ? text(context.site?.name) : ''
    default:
      return ''
  }
}

/**
 * Every merge field in `text` replaced from `context`, and the ones that
 * had nothing to say. Pure, and never throws: a missing record, an unknown
 * field, a malformed context each render as nothing and are named in
 * `unresolved`.
 */
export function resolveCrmMergeFields(
  text: string,
  context: CrmMergeContext | null | undefined,
): CrmMergeResult {
  const source = String(text ?? '')
  const ctx = context ?? {}
  const unresolved = new Set<string>()
  const rendered = source.replace(MERGE_FIELD_PATTERN, (_match, key: string) => {
    const value = resolveCrmMergeField(key, ctx)
    if (!value) unresolved.add(key)
    return value
  })
  return { text: rendered, unresolved: [...unresolved] }
}

/** {@link resolveCrmMergeFields}, text alone — what the send route sends. */
export function renderCrmMergeFields(
  text: string,
  context: CrmMergeContext | null | undefined,
): string {
  return resolveCrmMergeFields(text, context).text
}

/** What the dialog says under a draft whose fields have nothing to fill. */
export function crmMergeUnresolvedMessage(unresolved: readonly string[]): string {
  if (unresolved.length === 0) return ''
  const count = unresolved.length
  const noun = count === 1 ? '1 field has no value' : `${count} fields have no value`
  return `${noun}: ${unresolved.map(crmMergeFieldToken).join(', ')}`
}
