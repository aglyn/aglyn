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
 * A STORE FILE'S MARKETING CHOICE, WRITTEN AND UNDONE (AGL-4245).
 *
 * The plan (`customer-consent-plan.ts`) decided each row's change against
 * the contact as the dry run read it. This writes it against the contact as
 * it is NOW, checking again, because a person may have unsubscribed between
 * the dry run and the import:
 *
 * - **A grant** is the site's own entry (`marketingConsentByHost[site]`),
 *   for that one site, and only when the plan carries the statement of the
 *   member who planned it and the job's answer still says so. A contact
 *   whose basis reads declined for the site, or whom the site's unsubscribe
 *   list holds, is never granted.
 * - **A refusal** is the site's own entry too, read across its consent
 *   group like every refusal. A contact who was subscribed here is also put
 *   on the site's unsubscribe list (`recordSiteUnsubscribe`, `via`
 *   `crm-import:<store>`), as their own unsubscribe link would. With no
 *   site, the refusal is the record's unscoped one, honored by every site.
 * - **Provenance** rides with the entry, where the consent reader looks for
 *   it: `marketingConsentSource` with the kind {@link CONTACT_IMPORT_CONSENT_KIND},
 *   who, when, the store and the import job, and a sentence saying so.
 *
 * Undo puts back exactly the entry that stood before, and lifts the
 * unsubscribe row the import filed — only while the entry is still the
 * import's own; a choice the person made since is theirs and stays.
 *=========================================*/

import {
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_FIELD,
  MARKETING_CONSENT_SOURCE_FIELD,
  readMarketingBasis,
} from '@aglyn/aglyn/app-utils/marketing-consent'
import type { ConsentGroup } from '@aglyn/aglyn/app-utils/consent-groups'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { recordSiteUnsubscribe, releaseSiteUnsubscribe } from '@aglyn/tenant-data-admin/server/site-marketing-sync'
import { FieldValue } from 'firebase-admin/firestore'
import type { ImportedConsentDetail } from './customer-consent-plan'
import { CUSTOMER_FILE_SOURCE_NAMES } from './customer-sources'

/** The `kind` of the provenance an import's consent entry carries. */
export const CONTACT_IMPORT_CONSENT_KIND = 'contact-import'

/** The suppression `via` an import's unsubscribe is filed under. */
export function importedConsentVia(source: ImportedConsentDetail['source']): string {
  return `crm-import:${source}`
}

/** The addresses any of `hostIds`' unsubscribe lists holds live, lowercased. */
export async function readSuppressedAddresses(
  firestore: FirebaseFirestore.Firestore,
  hostIds: readonly string[],
  emails: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  const keyed = emails.flatMap((email) => {
    const key = personKey(email)
    return key ? [{ email: email.trim().toLowerCase(), key }] : []
  })
  const refs = hostIds.flatMap((hostId) =>
    keyed.map((entry) => ({
      email: entry.email,
      ref: firestore.collection('hosts').doc(hostId).collection('suppressions').doc(entry.key),
    })),
  )
  for (let at = 0; at < refs.length; at += 300) {
    const page = refs.slice(at, at + 300)
    const snapshots = await firestore.getAll(...page.map((entry) => entry.ref))
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists && !snapshot.get('releasedAt')) out.add((page[index] as { email: string }).email)
    })
  }
  return out
}

/** What undo needs to put one contact's consent back. */
export interface ImportedConsentUndo {
  /** Field path → the value before the import, or `null` for none. */
  fields: Record<string, unknown>
  /** The provenance's `atMs`: the entry is still the import's while it reads this. */
  atMs: number
  /** The unsubscribe row the import filed, when it filed one. */
  suppression: { hostId: string; email: string; via: string } | null
}

/** A stored value as plain data an undo snapshot can hold: a timestamp as its epoch ms. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  const millis = (value as { toMillis?: () => number }).toMillis
  if (typeof millis === 'function') return millis.call(value)
  if (Array.isArray(value)) return value.map(plain)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, plain(entry)]))
}

/** The sentence a consent record carries, for whoever reads it later. */
function provenanceReason(detail: ImportedConsentDetail, atMs: number): string {
  const file = detail.source === 'file' ? 'a customer file' : `a ${CUSTOMER_FILE_SOURCE_NAMES[detail.source]} customer file`
  const day = new Date(atMs).toISOString().slice(0, 10)
  const job = detail.jobId ? ` (import ${detail.jobId})` : ''
  return detail.action === 'grant'
    ? `Opted in as ${file} recorded, imported on ${day}${job}. The member who imported it confirmed these people agreed to hear from this business.`
    : `Unsubscribed as ${file} recorded, imported on ${day}${job}.`
}

/** What one row's consent write did. */
export type ImportedConsentOutcome =
  | { written: true; value: boolean; undo: ImportedConsentUndo }
  | { written: false; message?: string }

/**
 * Writes one row's planned consent change onto the contact, checked against
 * the contact as it is now (see the module note). A grant needs both the
 * plan's own statement and `attestedNow`, the job's Permission answer as the
 * apply reads it.
 */
export async function writeImportedConsent(input: {
  firestore: FirebaseFirestore.Firestore
  contactRef: FirebaseFirestore.DocumentReference
  /** The import's site, or `null` with none. */
  hostId: string | null
  group: ConsentGroup
  detail: ImportedConsentDetail
  attestedNow: boolean
  /** Who to name on a refusal when the plan named nobody. */
  fallbackBy: string | null
  atMs: number
}): Promise<ImportedConsentOutcome> {
  const { detail, hostId } = input
  const snapshot = await input.contactRef.get()
  const contact = snapshot.data()
  if (!snapshot.exists || !contact) return { written: false }
  const email = String(contact['email'] ?? '').trim().toLowerCase()
  if (!email) return { written: false }
  const basis = hostId
    ? readMarketingBasis(contact, input.group).basis
    : contact[MARKETING_CONSENT_FIELD] === false
      ? 'declined'
      : 'unrecorded'
  const by = detail.by ?? input.fallbackBy

  if (detail.action === 'grant') {
    if (!hostId || !detail.attested || !input.attestedNow || !detail.by) {
      return { written: false, message: 'Not opted in: nobody confirmed these people agreed to hear from you.' }
    }
    if (basis === 'declined') return { written: false, message: 'Not opted in: they unsubscribed here.' }
    if (basis === 'granted') return { written: false }
    const suppressed = await readSuppressedAddresses(input.firestore, input.group.hostIds.length ? input.group.hostIds : [hostId], [email])
    if (suppressed.size) return { written: false, message: 'Not opted in: they unsubscribed here.' }
  } else if (basis === 'declined') {
    return { written: false }
  }

  const source = {
    kind: CONTACT_IMPORT_CONSENT_KIND,
    by: by ?? 'import',
    atMs: input.atMs,
    reason: provenanceReason(detail, input.atMs),
    actor: 'operator' as const,
    source: detail.source,
    jobId: detail.jobId,
  }
  const granted = detail.action === 'grant'
  const update: Record<string, unknown> = {}
  const fields: Record<string, unknown> = {}
  if (hostId) {
    const path = `${MARKETING_CONSENT_BY_HOST_FIELD}.${hostId}`
    const byHost = contact[MARKETING_CONSENT_BY_HOST_FIELD] as Record<string, unknown> | undefined
    fields[path] = plain(byHost?.[hostId])
    update[path] = {
      [MARKETING_CONSENT_FIELD]: granted,
      marketingConsentAtMs: input.atMs,
      [MARKETING_CONSENT_SOURCE_FIELD]: source,
    }
  } else {
    // No site: the record's unscoped refusal, which every site honors, with
    // its provenance where the reader looks for an unscoped refusal's.
    for (const path of [MARKETING_CONSENT_FIELD, 'marketingConsentAtMs', MARKETING_CONSENT_SOURCE_FIELD]) {
      fields[path] = plain(contact[path])
    }
    update[MARKETING_CONSENT_FIELD] = false
    update['marketingConsentAtMs'] = input.atMs
    update[MARKETING_CONSENT_SOURCE_FIELD] = source
  }
  await input.contactRef.update({ ...update, updatedAt: FieldValue.serverTimestamp() })

  let suppression: ImportedConsentUndo['suppression'] = null
  if (!granted && hostId && basis === 'granted') {
    const via = importedConsentVia(detail.source)
    const name = detail.source === 'file' ? 'customer file' : `${CUSTOMER_FILE_SOURCE_NAMES[detail.source]} customer file`
    const filed = await recordSiteUnsubscribe({
      hostId,
      email,
      via,
      detail: `Unsubscribed, as your ${name} records.`,
      firestore: input.firestore,
    })
    if (filed.created) suppression = { hostId, email, via }
  }
  return { written: true, value: granted, undo: { fields, atMs: input.atMs, suppression } }
}

/** Whether the consent at `path` on `contact` is still the one this import wrote. */
function stillImported(contact: Record<string, unknown>, path: string, atMs: number): boolean {
  const source = path.startsWith(`${MARKETING_CONSENT_BY_HOST_FIELD}.`)
    ? ((contact[MARKETING_CONSENT_BY_HOST_FIELD] as Record<string, Record<string, unknown>> | undefined)?.[
        path.slice(MARKETING_CONSENT_BY_HOST_FIELD.length + 1)
      ]?.[MARKETING_CONSENT_SOURCE_FIELD] as Record<string, unknown> | undefined)
    : (contact[MARKETING_CONSENT_SOURCE_FIELD] as Record<string, unknown> | undefined)
  return source?.['kind'] === CONTACT_IMPORT_CONSENT_KIND && source['atMs'] === atMs
}

/**
 * Puts back the consent one contact held before the import, and lifts the
 * unsubscribe row the import filed. Nothing changes when the person's
 * consent has moved since: the choice they made since is theirs.
 *
 * @returns whether the import's consent was taken back.
 */
export async function revertImportedConsent(input: {
  firestore: FirebaseFirestore.Firestore
  contactRef: FirebaseFirestore.DocumentReference
  undo: ImportedConsentUndo
}): Promise<boolean> {
  const snapshot = await input.contactRef.get()
  const contact = snapshot.data()
  if (!snapshot.exists || !contact) return false
  const paths = Object.keys(input.undo.fields ?? {})
  const own = paths.find((path) => path !== 'marketingConsentAtMs' && path !== MARKETING_CONSENT_FIELD) ?? paths[0]
  if (!own || !stillImported(contact, own, input.undo.atMs)) return false
  const update: Record<string, unknown> = {}
  for (const path of paths) {
    const previous = input.undo.fields[path]
    update[path] = previous === null || previous === undefined ? FieldValue.delete() : previous
  }
  await input.contactRef.update({ ...update, updatedAt: FieldValue.serverTimestamp() })
  const filed = input.undo.suppression
  if (filed) {
    await releaseSiteUnsubscribe({ hostId: filed.hostId, email: filed.email, via: filed.via, firestore: input.firestore })
  }
  return true
}

/** The undo an entry's `extras` holds, when it is well formed. */
export function readImportedConsentUndo(extras: Readonly<Record<string, unknown>> | undefined): ImportedConsentUndo | null {
  const value = extras?.['consent'] as Partial<ImportedConsentUndo> | undefined
  if (!value || typeof value !== 'object' || typeof value.atMs !== 'number' || !value.fields || typeof value.fields !== 'object') {
    return null
  }
  return { fields: value.fields, atMs: value.atMs, suppression: value.suppression ?? null }
}
