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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  e164OrNull,
  toAmount,
  type MarketingProvider,
  type ProviderConsentChange,
  type ProviderContact,
  type ProviderCredential,
  type ProviderSkip,
} from './provider'

/**
 * Constant Contact, through its v3 API (AGL-3696), behind the deployment's
 * OAuth app: offered only once `CONSTANT_CONTACT_CLIENT_ID` and
 * `CONSTANT_CONTACT_CLIENT_SECRET` exist — v3 takes no merchant API key.
 *
 * - **Out:** the people the site may market to go into the chosen list
 *   through a bulk JSON import (`POST /activities/contacts_json_import`),
 *   with name, phone, and the site's facts in four custom fields this
 *   adapter creates on first use: tags, source tag, lifetime value and
 *   order count. Constant Contact gives a NEW contact implicit permission
 *   and never changes an existing contact's permission through an import,
 *   so a person who unsubscribed there is never subscribed again from here.
 *   A person the site may not market to is found by address and set
 *   `unsubscribed` (`PUT /contacts/{id}`, which keeps their other fields);
 *   one Constant Contact does not hold is left alone — there is nobody to
 *   send to.
 * - **Back:** the contacts that opted out since the cursor
 *   (`status=all&optout_after`), and, after the first run, those whose
 *   permission went back to explicit since then (`updated_after`, with an
 *   opt-in date after the cursor). Both walks are bounded by the same
 *   window, so the cursor moves only when both are finished.
 * - **Events:** none. Constant Contact's public API has no order or custom
 *   event endpoint for its automations, so nothing is invented here; the
 *   card offers no event switch for it.
 *
 * Constant Contact allows four requests a second; calls are spaced to stay
 * under it, and a 429 is the shared door's rate limit.
 */

const PROVIDER = 'Constant Contact'
/** The API host; every path names its version, `/v3/…`. */
const BASE = 'https://api.cc.email'
/** Constant Contact's limit is four requests a second. */
export const CONSTANT_CONTACT_CALL_SPACING_MS = 260
const CONTACTS = '/v3/contacts'
/** The contacts list, ready for its query. */
const CONTACTS_PAGE = `${CONTACTS}?`
const CONTACT_LISTS = '/v3/contact_lists'
const CUSTOM_FIELDS = '/v3/contact_custom_fields'
const IMPORT_MAX = 500
const CONSENT_PAGE = 500
/** Pages one read-back call takes before it hands the walk to the next. */
const CONSENT_PAGES_PER_CALL = 5
/** How far behind now a read-back window ends, so a change still being indexed is not stepped over. */
const WINDOW_LAG_MS = 2 * 60 * 1000
const EPOCH = '2000-01-01T00:00:00.000Z'
const TEXT_MAX = 50
const FIELD_VALUE_MAX = 255

/** The custom fields the adapter keeps the site's facts in, by label. */
export const CONSTANT_CONTACT_FIELDS = {
  tags: { label: `${PLATFORM_BRAND_NAME} tags`, type: 'string', metadata: null },
  source: { label: `${PLATFORM_BRAND_NAME} source`, type: 'string', metadata: null },
  lifetimeValue: { label: `${PLATFORM_BRAND_NAME} lifetime value`, type: 'number', metadata: { decimal_places: 2 } },
  ordersCount: { label: `${PLATFORM_BRAND_NAME} orders`, type: 'number', metadata: { decimal_places: 0 } },
} as const

type FieldKey = keyof typeof CONSTANT_CONTACT_FIELDS

function headers(credential: ProviderCredential): Record<string, string> {
  return { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
}

/** A `_links.next.href` Constant Contact answered, kept only when it points back at the same resource. */
function nextPath(answer: any, prefix: string): string | null {
  const href = answer?._links?.next?.href
  return typeof href === 'string' && href.startsWith(prefix) && !href.includes('..') ? href : null
}

/**
 * The read-back cursor. A finished walk stores the plain ISO time its window
 * ended at; an unfinished one stores where it stopped.
 */
export interface ConstantContactCursor {
  /** Changes after this were not yet handed back; `null` before the first walk. */
  since: string | null
  /** The end of the window the walk reads. */
  until: string
  phase: 'optouts' | 'optins'
  /** Where the walk resumes in its phase, or `null` at the phase's first page. */
  next: string | null
}

export function readConstantContactCursor(cursor: string | null, nowMs: number): ConstantContactCursor {
  const raw = String(cursor ?? '')
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      const valid =
        (parsed.since === null || (typeof parsed.since === 'string' && !Number.isNaN(Date.parse(parsed.since)))) &&
        typeof parsed.until === 'string' &&
        !Number.isNaN(Date.parse(parsed.until)) &&
        (parsed.phase === 'optouts' || parsed.phase === 'optins') &&
        (parsed.next === null || (typeof parsed.next === 'string' && parsed.next.startsWith(CONTACTS_PAGE)))
      if (valid) return { since: parsed.since, until: parsed.until, phase: parsed.phase, next: parsed.next }
    } catch {
      // Unreadable: start a fresh window below.
    }
  }
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null
  const until = new Date(nowMs - WINDOW_LAG_MS).toISOString()
  // A clock that has not passed the cursor yet reads an empty window.
  return { since, until: since && Date.parse(since) > Date.parse(until) ? since : until, phase: 'optouts', next: null }
}

const clip = (value: string | null, max = TEXT_MAX): string | undefined =>
  value && value.trim() ? value.trim().slice(0, max) : undefined

/**
 * Constant Contact's refusals that concern ONE person rather than the
 * request: an address it will not hold, or one it has deleted.
 */
const PERSON_REFUSAL = /email|address/i

export function createConstantContactProvider(
  http: ProviderHttp,
  options: { now?: () => number } = {},
): MarketingProvider {
  const now = options.now ?? (() => Date.now())
  let calls = 0
  const call = async (credential: ProviderCredential, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => {
    if (calls > 0) await http.sleep(CONSTANT_CONTACT_CALL_SPACING_MS)
    calls += 1
    return providerRequest(http, { provider: PROVIDER, method, url: `${BASE}${path}`, headers: headers(credential), body })
  }

  /** The custom field names, by key, for one token: created on first use, read once per run. */
  const fieldNames = new Map<string, Promise<Record<FieldKey, string | null>>>()
  const ensureFields = (credential: ProviderCredential) => {
    const cached = fieldNames.get(credential.token)
    if (cached) return cached
    const work = (async () => {
      const existing: Array<{ label: string; name: string }> = []
      let path: string | null = `${CUSTOM_FIELDS}?limit=100`
      for (let page = 0; path && page < 10; page += 1) {
        const answer = await call(credential, 'GET', path)
        for (const field of Array.isArray(answer?.custom_fields) ? answer.custom_fields : []) {
          if (typeof field?.name === 'string') existing.push({ label: String(field.label ?? ''), name: field.name })
        }
        path = nextPath(answer, CUSTOM_FIELDS)
      }
      const names = {} as Record<FieldKey, string | null>
      for (const key of Object.keys(CONSTANT_CONTACT_FIELDS) as FieldKey[]) {
        const spec = CONSTANT_CONTACT_FIELDS[key]
        const found = existing.find((field) => field.label.toLowerCase() === spec.label.toLowerCase())
        if (found) {
          names[key] = found.name
          continue
        }
        const create = (type: string, metadata: Record<string, unknown> | null) =>
          call(credential, 'POST', CUSTOM_FIELDS, { label: spec.label, type, ...(metadata ? { metadata } : {}) })
        let created: any
        try {
          created = await create(spec.type, spec.metadata)
        } catch (error) {
          // An account that refuses a typed field still takes text.
          if (!(error instanceof ProviderError && error.kind === 'invalid' && spec.type !== 'string')) throw error
          created = await create('string', null).catch((fallback) => {
            if (fallback instanceof ProviderError && fallback.kind === 'invalid') return null
            throw fallback
          })
        }
        names[key] = typeof created?.name === 'string' ? created.name : null
      }
      return names
    })()
    fieldNames.set(credential.token, work)
    work.catch(() => fieldNames.delete(credential.token))
    return work
  }

  const importRow = (contact: ProviderContact, fields: Record<FieldKey, string | null>, tag: string) => {
    const row: Record<string, unknown> = { email: contact.email }
    const first = clip(contact.firstName)
    const last = clip(contact.lastName)
    if (first) row['first_name'] = first
    if (last) row['last_name'] = last
    const phone = e164OrNull(contact.phone)
    if (phone) row['phone'] = phone
    const set = (key: FieldKey, value: string | number | null | undefined) => {
      const name = fields[key]
      if (name && value !== null && value !== undefined && value !== '') row[`cf:${name}`] = value
    }
    set('tags', clip([...new Set(contact.tags.map((value) => String(value ?? '').trim()).filter(Boolean))].join(', '), FIELD_VALUE_MAX))
    set('source', clip(tag, FIELD_VALUE_MAX))
    set('lifetimeValue', contact.lifetimeValueCents === null ? null : toAmount(contact.lifetimeValueCents))
    set('ordersCount', contact.ordersCount)
    return row
  }

  const findContact = async (credential: ProviderCredential, email: string) => {
    const params = new URLSearchParams({ email, status: 'all', include_count: 'false' })
    const answer = await call(credential, 'GET', `${CONTACTS_PAGE}${params.toString()}`)
    const contacts: any[] = Array.isArray(answer?.contacts) ? answer.contacts : []
    return (
      contacts.find(
        (entry) => String(entry?.email_address?.address ?? '').trim().toLowerCase() === email.trim().toLowerCase(),
      ) ?? null
    )
  }

  return {
    id: 'constant-contact',

    async verify(credential) {
      const summary = await call(credential, 'GET', '/v3/account/summary')
      const lists: { id: string; name: string }[] = []
      let path: string | null = `${CONTACT_LISTS}?limit=1000&include_count=false`
      for (let page = 0; path && page < 5; page += 1) {
        const answer = await call(credential, 'GET', path)
        for (const list of Array.isArray(answer?.lists) ? answer.lists : []) {
          if (typeof list?.list_id === 'string') lists.push({ id: list.list_id, name: String(list.name ?? list.list_id) })
        }
        path = nextPath(answer, CONTACT_LISTS)
      }
      const name = summary?.organization_name
      return { accountName: typeof name === 'string' && name.trim() ? name.trim() : null, lists, apiBase: null }
    },

    async pushContacts(credential, target, contacts) {
      if (!target.listId) throw new ProviderError('invalid', 'Choose the Constant Contact list contacts go into')
      let pushed = 0
      const skipped: ProviderSkip[] = []
      const subscribed = contacts.filter((contact) => contact.status === 'subscribed')
      if (subscribed.length) {
        const fields = await ensureFields(credential)
        for (let index = 0; index < subscribed.length; index += IMPORT_MAX) {
          const batch = subscribed.slice(index, index + IMPORT_MAX)
          await call(credential, 'POST', '/v3/activities/contacts_json_import', {
            import_data: batch.map((contact) => importRow(contact, fields, target.tag)),
            list_ids: [target.listId],
          })
          pushed += batch.length
        }
      }
      for (const contact of contacts.filter((entry) => entry.status === 'unsubscribed')) {
        try {
          const found = await findContact(credential, contact.email)
          // Not held there: nobody to send to, and nothing to unsubscribe.
          if (!found || typeof found.contact_id !== 'string') continue
          if (found.email_address?.permission_to_send === 'unsubscribed') continue
          // PUT replaces the top-level fields, so every one is sent back as
          // it was; the contact's lists, phones and custom fields are
          // sub-resources it leaves alone.
          const body: Record<string, unknown> = {
            email_address: { address: found.email_address.address, permission_to_send: 'unsubscribed' },
            update_source: 'Account',
          }
          for (const key of ['first_name', 'last_name', 'job_title', 'company_name', 'birthday_month', 'birthday_day', 'anniversary']) {
            if (found[key] !== undefined && found[key] !== null && found[key] !== '') body[key] = found[key]
          }
          await call(credential, 'PUT', `${CONTACTS}/${encodeURIComponent(found.contact_id)}`, body)
          pushed += 1
        } catch (error) {
          if (error instanceof ProviderError && error.kind === 'invalid' && PERSON_REFUSAL.test(error.message)) {
            skipped.push({ email: contact.email, reason: error.message })
            continue
          }
          throw error
        }
      }
      return { pushed, skipped }
    },

    async pullConsent(credential, target, cursor) {
      if (!target.listId) return { changes: [], cursor, more: false }
      const state = readConstantContactCursor(cursor, now())
      const changes: ProviderConsentChange[] = []
      const sinceMs = state.since ? Date.parse(state.since) : null
      for (let page = 0; page < CONSENT_PAGES_PER_CALL; page += 1) {
        let path = state.next
        if (!path) {
          const params =
            state.phase === 'optouts'
              ? new URLSearchParams({
                  status: 'all',
                  optout_after: state.since ?? EPOCH,
                  optout_before: state.until,
                  limit: String(CONSENT_PAGE),
                  include_count: 'false',
                })
              : new URLSearchParams({
                  status: 'active',
                  updated_after: state.since ?? EPOCH,
                  updated_before: state.until,
                  limit: String(CONSENT_PAGE),
                  include_count: 'false',
                })
          path = `${CONTACTS_PAGE}${params.toString()}`
        }
        const answer = await call(credential, 'GET', path)
        for (const contact of Array.isArray(answer?.contacts) ? answer.contacts : []) {
          const email = String(contact?.email_address?.address ?? '').trim().toLowerCase()
          const permission = contact?.email_address?.permission_to_send
          if (!email) continue
          if (state.phase === 'optouts' && permission === 'unsubscribed') changes.push({ email, status: 'unsubscribed' })
          if (state.phase === 'optins' && permission === 'explicit') {
            const optedIn = Date.parse(String(contact?.email_address?.opt_in_date ?? ''))
            if (sinceMs !== null && Number.isFinite(optedIn) && optedIn > sinceMs) changes.push({ email, status: 'subscribed' })
          }
        }
        state.next = nextPath(answer, CONTACTS_PAGE)
        if (state.next) continue
        // The phase is finished. A return is read only after a first walk:
        // before it, this connection filed nothing a return could lift.
        if (state.phase === 'optouts' && state.since) {
          state.phase = 'optins'
          continue
        }
        return { changes, cursor: state.until, more: false }
      }
      return { changes, cursor: JSON.stringify(state), more: true }
    },
  }
}
