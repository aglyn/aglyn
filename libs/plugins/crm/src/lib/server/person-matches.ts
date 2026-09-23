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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import type {
  PluginPersonMatch,
  PluginPersonMatchRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-matches'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { crmRoutes } from '../model/crm-routes'
import { namesResemble } from '../model/person-name-match'

/**
 * The CRM's answer to "did this workspace already know this person?"
 * (AGL-3289), registered through the platform's person-match seam and asked
 * when staff read where an account came from.
 *
 * Contacts and leads are both searched: by the account's address exactly —
 * the contact through its email index, the lead by its person key — and by
 * the account's name, as a resemblance the card shows as "possible".
 *
 * The account's OWN record is left out. The platform files every new account
 * into its sales workspace as a contact whose only source is `account`, so a
 * record like that, first seen once the account existed, is the sign-up
 * itself and says nothing about whether anybody knew them before.
 */

/** How many records each collection's name scan reads, at most. */
export const PERSON_NAME_SCAN_LIMIT = 5000
/** How many name resemblances are returned, at most. */
export const PERSON_NAME_MATCH_LIMIT = 5
/** Slack between the account's creation and its own record being written. */
const OWN_RECORD_SLACK_MS = 10 * 60 * 1000

/** A contact or lead as the matcher reads it. */
export interface PersonCandidate {
  kind: 'contact' | 'lead'
  id: string
  name: string | null
  email: string | null
  sources: string[]
  firstSeenAtMs: number | null
}

function millis(value: unknown): number | null {
  if (typeof value === 'number' && value > 0) return value
  const timestamp = value as { toMillis?: () => number } | null
  return timestamp && typeof timestamp.toMillis === 'function' ? timestamp.toMillis() : null
}

function sourcesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, flag]) => flag === true)
      .map(([source]) => source)
  }
  return []
}

/** A contact or lead document as a candidate. */
export function candidateFrom(
  kind: PersonCandidate['kind'],
  id: string,
  data: Record<string, unknown> | undefined,
): PersonCandidate {
  return {
    kind,
    id,
    name: typeof data?.['name'] === 'string' ? (data['name'] as string) : null,
    email: normalizeContactEmail(data?.['email']) || null,
    sources: sourcesOf(data?.['sources']),
    firstSeenAtMs: millis(data?.['firstSeenAtMs']) ?? millis(data?.['createdAt']),
  }
}

/** Whether a record is the one the account's own sign-up made. */
export function isTheAccountsOwnRecord(
  candidate: PersonCandidate,
  accountCreatedAtMs: number | null,
): boolean {
  if (candidate.sources.length !== 1 || candidate.sources[0] !== 'account') return false
  if (accountCreatedAtMs === null || candidate.firstSeenAtMs === null) return true
  return candidate.firstSeenAtMs >= accountCreatedAtMs - OWN_RECORD_SLACK_MS
}

/**
 * What to report, from what was read: every address match that is not the
 * account itself, then up to {@link PERSON_NAME_MATCH_LIMIT} name
 * resemblances that are neither an address match nor the account itself.
 */
export function selectPersonMatches(input: {
  request: PluginPersonMatchRequest
  byEmail: readonly PersonCandidate[]
  byName: readonly PersonCandidate[]
}): PluginPersonMatch[] {
  const { request } = input
  const email = normalizeContactEmail(request.email) || null
  const hub = request.orgSlug
    ? crmRoutes(buildRoute(Route.ORG_PLUGIN, { orgSlug: request.orgSlug, pluginSlug: 'crm' }))
    : null
  const href = (candidate: PersonCandidate): string | null =>
    hub ? (candidate.kind === 'contact' ? hub.contact(candidate.id) : hub.section('leads')) : null
  const toMatch = (candidate: PersonCandidate, basis: 'email' | 'name'): PluginPersonMatch => ({
    kind: candidate.kind,
    id: candidate.id,
    label: candidate.name || candidate.email || candidate.id,
    email: candidate.email,
    basis,
    firstSeenAtMs: candidate.firstSeenAtMs,
    sources: candidate.sources,
    href: href(candidate),
  })

  const seen = new Set<string>()
  const matches: PluginPersonMatch[] = []
  for (const candidate of input.byEmail) {
    const key = `${candidate.kind}:${candidate.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (isTheAccountsOwnRecord(candidate, request.accountCreatedAtMs)) continue
    matches.push(toMatch(candidate, 'email'))
  }
  let named = 0
  for (const candidate of input.byName) {
    if (named >= PERSON_NAME_MATCH_LIMIT) break
    const key = `${candidate.kind}:${candidate.id}`
    if (seen.has(key)) continue
    if (email && candidate.email === email) continue
    if (isTheAccountsOwnRecord(candidate, request.accountCreatedAtMs)) continue
    if (!namesResemble(request.name, candidate.name)) continue
    seen.add(key)
    matches.push(toMatch(candidate, 'name'))
    named++
  }
  return matches
}

/** The matcher the CRM registers. Reads only. */
export async function matchCrmPeople(
  request: PluginPersonMatchRequest,
): Promise<PluginPersonMatch[]> {
  const firestore = firebaseAdmin.app().firestore()
  const org = firestore.collection('orgs').doc(request.orgId)
  const contacts = org.collection('contacts')
  const leads = org.collection('leads')
  const email = normalizeContactEmail(request.email)

  const byEmail: PersonCandidate[] = []
  const key = email ? personKey(email) : null
  if (email && key) {
    const [contact, lead, alternates] = await Promise.all([
      findContactByEmail(contacts, email),
      leads.doc(key).get(),
      contacts.where('alternateEmails', 'array-contains', email).limit(3).get(),
    ])
    if (contact) byEmail.push(candidateFrom('contact', contact.id, contact.data()))
    if (lead.exists) byEmail.push(candidateFrom('lead', lead.id, lead.data()))
    for (const doc of alternates.docs) byEmail.push(candidateFrom('contact', doc.id, doc.data()))
  }

  const byName: PersonCandidate[] = []
  if (request.name) {
    const fields = ['name', 'email', 'sources', 'createdAt', 'firstSeenAtMs']
    const [contactNames, leadNames] = await Promise.all([
      contacts.select(...fields).limit(PERSON_NAME_SCAN_LIMIT).get(),
      leads.select(...fields).limit(PERSON_NAME_SCAN_LIMIT).get(),
    ])
    for (const doc of contactNames.docs) byName.push(candidateFrom('contact', doc.id, doc.data()))
    for (const doc of leadNames.docs) byName.push(candidateFrom('lead', doc.id, doc.data()))
  }

  return selectPersonMatches({ request, byEmail, byName })
}
