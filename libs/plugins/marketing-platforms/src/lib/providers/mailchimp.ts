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

import { createHash } from 'node:crypto'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  e164OrNull,
  type MarketingProvider,
  type ProviderConsentChange,
  type ProviderCredential,
  type ProviderSkip,
} from './provider'

/**
 * Mailchimp, through its Marketing API v3 (AGL-3639): an audience kept in
 * step with the site in both directions.
 *
 * - **Out:** each person is upserted at `PUT /lists/{id}/members/{hash}`.
 *   A person the site may market to is sent with `status_if_new:
 *   subscribed` and no `status`, so a member who unsubscribed IN Mailchimp
 *   is never subscribed again from here; a person the site may not market
 *   to is set `unsubscribed`. Name and phone go in the default merge fields
 *   (`skip_merge_validation`, so an audience without PHONE still takes the
 *   rest), and tags through the member's tags endpoint.
 * - **Back:** members whose status changed since the cursor, oldest first
 *   (`since_last_changed`, sorted by `last_changed`), for both directions.
 *
 * An API key carries its data center after the dash (`…-us21`); an OAuth
 * token's data center is read from Mailchimp's metadata endpoint at connect
 * and stored with it.
 */

const PROVIDER = 'Mailchimp'
const PAGE = 500
const MAX_PAGES = 10

/** The data center an API key names, or `null` for a key with none. */
export function mailchimpDataCenter(apiKey: string): string | null {
  const dc = String(apiKey ?? '').trim().split('-').pop() ?? ''
  return /^[a-z]{2}\d{1,3}$/.test(dc) && apiKey.includes('-') ? dc : null
}

/** Mailchimp's member id: the MD5 of the lowercased address. */
export function mailchimpSubscriberHash(email: string): string {
  return createHash('md5').update(String(email).trim().toLowerCase()).digest('hex')
}

function apiBase(credential: ProviderCredential): string {
  if (credential.apiBase) return credential.apiBase.replace(/\/+$/, '')
  const dc = mailchimpDataCenter(credential.token)
  if (!dc) throw new ProviderError('auth', 'That is not a Mailchimp API key: it should end in your data center, like -us21')
  return `https://${dc}.api.mailchimp.com/3.0`
}

function headers(credential: ProviderCredential): Record<string, string> {
  return {
    Authorization:
      credential.kind === 'oauth'
        ? `Bearer ${credential.token}`
        : `Basic ${Buffer.from(`aglyn:${credential.token}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Mailchimp's refusals that concern ONE person rather than the request: a
 * permanently deleted ("forgotten") address, one held for compliance, a
 * fake or invalid one. They are skipped and logged; the run goes on.
 */
const PERSON_REFUSAL = /forgotten|compliance|fake|invalid|looks fake|permanently deleted|member exists/i

export function createMailchimpProvider(http: ProviderHttp): MarketingProvider {
  const call = (credential: ProviderCredential, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) =>
    providerRequest(http, {
      provider: PROVIDER,
      method,
      url: `${apiBase(credential)}${path}`,
      headers: headers(credential),
      body,
    })

  return {
    id: 'mailchimp',

    async verify(credential) {
      const base = apiBase(credential)
      const root = await call(credential, 'GET', '/?fields=account_name')
      const lists = await call(credential, 'GET', '/lists?count=100&fields=lists.id,lists.name')
      return {
        accountName: typeof root?.account_name === 'string' ? root.account_name : null,
        lists: (Array.isArray(lists?.lists) ? lists.lists : [])
          .filter((list: any) => typeof list?.id === 'string')
          .map((list: any) => ({ id: String(list.id), name: String(list.name ?? list.id) })),
        apiBase: base,
      }
    },

    async pushContacts(credential, target, contacts) {
      if (!target.listId) throw new ProviderError('invalid', 'Choose the Mailchimp audience contacts go into')
      const listPath = `/lists/${encodeURIComponent(target.listId)}/members`
      let pushed = 0
      const skipped: ProviderSkip[] = []
      for (const contact of contacts) {
        const hash = mailchimpSubscriberHash(contact.email)
        const mergeFields: Record<string, string> = {}
        if (contact.firstName) mergeFields['FNAME'] = contact.firstName
        if (contact.lastName) mergeFields['LNAME'] = contact.lastName
        const phone = e164OrNull(contact.phone)
        if (phone) mergeFields['PHONE'] = phone
        const body =
          contact.status === 'subscribed'
            ? { email_address: contact.email, status_if_new: 'subscribed', merge_fields: mergeFields }
            : { email_address: contact.email, status_if_new: 'unsubscribed', status: 'unsubscribed', merge_fields: mergeFields }
        try {
          await call(credential, 'PUT', `${listPath}/${hash}?skip_merge_validation=true`, body)
          const tags = [...new Set([target.tag, ...contact.tags].map((tag) => String(tag ?? '').trim()).filter(Boolean))].slice(0, 20)
          if (tags.length && contact.status === 'subscribed') {
            await call(credential, 'POST', `${listPath}/${hash}/tags`, {
              tags: tags.map((name) => ({ name: name.slice(0, 100), status: 'active' })),
            })
          }
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
      const since = cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : null
      const changes: ProviderConsentChange[] = []
      /*
       * One cursor for two walks. Each status is walked oldest first; when a
       * walk stops short, the stored cursor must not pass the point it
       * reached, or the rest of that status would be skipped for good. So a
       * truncated walk caps the cursor at where it stopped, and the other
       * status is read again from there next time (applying a change twice
       * is a no-op).
       */
      const reached: string[] = []
      const capped: string[] = []
      for (const status of ['unsubscribed', 'subscribed'] as const) {
        let latest = since
        let truncated = false
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const params = new URLSearchParams({
            status,
            count: String(PAGE),
            offset: String(page * PAGE),
            sort_field: 'last_changed',
            sort_dir: 'ASC',
            fields: 'members.email_address,members.status,members.last_changed',
          })
          if (since) params.set('since_last_changed', since)
          const answer = await call(
            credential,
            'GET',
            `/lists/${encodeURIComponent(target.listId)}/members?${params.toString()}`,
          )
          const members: any[] = Array.isArray(answer?.members) ? answer.members : []
          for (const member of members) {
            const email = String(member?.email_address ?? '').trim().toLowerCase()
            if (!email) continue
            changes.push({ email, status })
            const changed = String(member?.last_changed ?? '')
            if (changed && !Number.isNaN(Date.parse(changed)) && (!latest || Date.parse(changed) > Date.parse(latest))) {
              latest = changed
            }
          }
          if (members.length < PAGE) break
          if (page === MAX_PAGES - 1) truncated = true
        }
        if (latest) (truncated ? capped : reached).push(latest)
      }
      const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b)
      const cursorOut = capped.length ? [...capped].sort(byTime)[0] : ([...reached].sort(byTime).pop() ?? since)
      return { changes, cursor: cursorOut, more: capped.length > 0 }
    },
  }
}
