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

import type { QuoteCatalogLineRequest, QuoteCustomer, QuoteEmailThread, QuoteResponseFile } from './commerce-quotes'

/*==========================================
 * A QUOTE STARTED FROM A REQUEST (AGL-4098).
 *
 * A "Request a quote" form sends a submission the forms plugin keeps; the
 * Inbox shows it, and this plugin answers it with a quote. Neither plugin
 * imports the other: the request is read through the core's record-facts
 * seam ({@link QUOTE_REQUEST_FACTS_RESOURCE}, the forms plugin's reader), and
 * the product a customer picked rides the submission as plain strings the
 * Product and options field posted ({@link parseProductFieldValue}).
 *
 * What a quote takes from a request, all of it server-read:
 *
 *  - the CUSTOMER: name, email, phone and company, as the form gave them;
 *  - a LINE for the product and its options, when the form had the field;
 *  - the NOTES: the request's own words;
 *  - its FILES, kept where the request keeps them and listed on the quote as
 *    the customer's files (`quote.requestFiles`), downloaded through the
 *    quote's own gated route;
 *  - the REQUEST itself (`quote.request`): which submission, which form, when;
 *  - the CONVERSATION (`quote.emailThread`): the thread the request's
 *    confirmation email started, so the quote's first email replies into it.
 *=========================================*/

/** The resource the forms plugin reads a submission's facts under, on the core's seam. */
export const QUOTE_REQUEST_FACTS_RESOURCE = 'forms.submission'

/** The request a quote was started from. */
export interface QuoteRequestRef {
  submissionId: string
  formName: string
  /** When the request arrived, epoch ms; null when the submission did not say. */
  receivedAtMs: number | null
}

/**
 * What the Product and options field posts beside its readable line, under
 * `{name}__data`: the product, the variant the options make, and the options
 * as picked. Add-ons are not taken from the storefront yet; when they are,
 * they ride here as `modifiers` and the quote line prices them as the editor
 * does.
 */
export interface ProductFieldValue {
  productId: string
  variantId?: string
  options?: Record<string, string>
  modifiers?: Array<{ groupId: string; optionId: string }>
}

const ID = /^(?!__.*__$)[^/]{1,200}$/
const MAX_OPTIONS = 20
const MAX_MODIFIERS = 50

const text = (value: unknown, max = 200): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** The compact value the field posts. */
export function encodeProductFieldValue(value: ProductFieldValue): string {
  return JSON.stringify({
    productId: value.productId,
    ...(value.variantId ? { variantId: value.variantId } : {}),
    ...(value.options && Object.keys(value.options).length ? { options: value.options } : {}),
    ...(value.modifiers?.length ? { modifiers: value.modifiers } : {}),
  })
}

/**
 * The field's posted value, read back, or null for anything that is not one:
 * malformed JSON, no product id, ids that cannot be document ids. The options
 * keep at most twenty names and values of up to 200 characters.
 */
export function parseProductFieldValue(raw: unknown): ProductFieldValue | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4000) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const source = parsed as Record<string, unknown>
  const productId = text(source['productId'])
  if (!ID.test(productId)) return null
  const variantId = text(source['variantId'])
  const options: Record<string, string> = {}
  const rawOptions = source['options']
  if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
    for (const [name, value] of Object.entries(rawOptions as Record<string, unknown>).slice(0, MAX_OPTIONS)) {
      const key = text(name)
      const picked = text(value)
      if (key && picked) options[key] = picked
    }
  }
  const modifiers = Array.isArray(source['modifiers'])
    ? (source['modifiers'] as unknown[])
        .slice(0, MAX_MODIFIERS)
        .map((entry) => {
          const pick = (entry ?? {}) as Record<string, unknown>
          return { groupId: text(pick['groupId']), optionId: text(pick['optionId']) }
        })
        .filter((pick) => pick.groupId && pick.optionId)
    : []
  return {
    productId,
    ...(variantId && ID.test(variantId) ? { variantId } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(modifiers.length ? { modifiers } : {}),
  }
}

/** The readable line the field posts under its name: the product, then its options. */
export function productFieldLabel(productName: string, options: Record<string, string> | undefined): string {
  const picked = Object.values(options ?? {}).filter(Boolean)
  return picked.length ? `${productName} — ${picked.join(' / ')}` : productName
}

/** What this plugin reads of a request's facts (the forms plugin's reader documents them). */
export interface QuoteRequestFacts {
  hostId: string
  formName: string
  createdAtMs: number | null
  requestKind: string | null
  person: { name: string; email: string; phone: string; company: string }
  /** The lead or contact the request was filed as, which the quote's customer links to. */
  capturedRecord: { kind: string; id: string } | null
  message: string
  fieldData: Record<string, string>
  files: Array<QuoteResponseFile>
  emailThread: QuoteEmailThread | null
}

/** A request's facts as the seam answered them, read defensively. */
export function readQuoteRequestFacts(raw: Readonly<Record<string, unknown>> | null | undefined): QuoteRequestFacts | null {
  if (!raw || raw['record'] !== 'formSubmission') return null
  const person = (raw['person'] ?? {}) as Record<string, unknown>
  const request = (raw['request'] ?? null) as { kind?: unknown } | null
  const files = Array.isArray(raw['files']) ? (raw['files'] as unknown[]) : []
  const thread = (raw['emailThread'] ?? null) as Record<string, unknown> | null
  const captured = (raw['capturedRecord'] ?? null) as { kind?: unknown; id?: unknown } | null
  const references = Array.isArray(thread?.['references']) ? (thread?.['references'] as unknown[]).map(String) : []
  return {
    hostId: text(raw['hostId']),
    formName: text(raw['formName']) || 'Form',
    createdAtMs: typeof raw['createdAtMs'] === 'number' ? raw['createdAtMs'] : null,
    requestKind: typeof request?.kind === 'string' ? request.kind : null,
    person: {
      name: text(person['name']),
      email: text(person['email']),
      phone: text(person['phone'], 40),
      company: text(person['company']),
    },
    capturedRecord:
      (captured?.kind === 'lead' || captured?.kind === 'contact') && ID.test(text(captured.id))
        ? { kind: captured.kind, id: text(captured.id) }
        : null,
    message: text(raw['message'], 5000),
    fieldData: Object.fromEntries(
      Object.entries((raw['fieldData'] ?? {}) as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, value]) => [key, value.slice(0, 4000)]),
    ),
    files: files.slice(0, 10).flatMap((entry) => {
      const file = (entry ?? {}) as Record<string, unknown>
      const id = text(file['id'], 128)
      const path = text(file['path'], 500)
      if (!id || !path.startsWith('hosts/') || !text(file['name'])) return []
      return [
        {
          id,
          name: text(file['name']),
          contentType: text(file['contentType'], 100),
          size: Number(file['size']) || 0,
          path,
        },
      ]
    }),
    emailThread:
      thread && typeof thread['messageId'] === 'string' && typeof thread['subject'] === 'string'
        ? { messageId: thread['messageId'], references, subject: thread['subject'] }
        : null,
  }
}

/** What the quote editor opens with when a quote is started from a request. */
export interface QuoteStartPrefill {
  customer: Pick<QuoteCustomer, 'record' | 'name' | 'email' | 'phone' | 'company'>
  lines: QuoteCatalogLineRequest[]
  notes: string
}

/** The product lines a request's Product and options fields ask for, one per field. */
export function quoteLinesFromFieldData(fieldData: Readonly<Record<string, string>>): QuoteCatalogLineRequest[] {
  const lines: QuoteCatalogLineRequest[] = []
  for (const raw of Object.values(fieldData)) {
    const value = parseProductFieldValue(raw)
    if (!value) continue
    lines.push({
      kind: 'catalog',
      productId: value.productId,
      ...(value.variantId ? { variantId: value.variantId } : {}),
      quantity: 1,
      ...(value.modifiers?.length ? { modifiers: value.modifiers } : {}),
    })
  }
  return lines
}

/** A quote's start from a request: the editor's prefill, and what the server stamps on the quote. */
export function quoteStartFromRequest(
  submissionId: string,
  facts: QuoteRequestFacts,
): {
  prefill: QuoteStartPrefill
  request: QuoteRequestRef
  files: QuoteResponseFile[]
  emailThread: QuoteEmailThread | null
} {
  return {
    prefill: {
      customer: {
        ...(facts.capturedRecord ? { record: facts.capturedRecord } : {}),
        ...(facts.person.name ? { name: facts.person.name } : {}),
        ...(facts.person.email ? { email: facts.person.email } : {}),
        ...(facts.person.phone ? { phone: facts.person.phone } : {}),
        ...(facts.person.company ? { company: facts.person.company } : {}),
      },
      lines: quoteLinesFromFieldData(facts.fieldData),
      notes: facts.message,
    },
    request: { submissionId, formName: facts.formName, receivedAtMs: facts.createdAtMs },
    files: facts.files,
    emailThread: facts.emailThread,
  }
}

/** A request's files as the console may see them: no storage path. */
export function quoteRequestFileViews(files: readonly QuoteResponseFile[] | null | undefined): Array<Omit<QuoteResponseFile, 'path'>> {
  return (files ?? []).map(({ id, name, contentType, size }) => ({ id, name, contentType, size }))
}
