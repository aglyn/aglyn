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

import {
  containerMembershipField,
  contactContainerFieldPath,
  normalizeContainerIds,
} from '@aglyn/aglyn/app-utils/container-membership'
import { normalizeContactEmail, readContactFacet } from '@aglyn/aglyn/app-utils/contacts'
import {
  CRM_COLLECTIONS,
  CRM_SCOPED_SEARCH_JOIN,
  CRM_SCOPED_SEARCH_TOKENS_FIELD,
  crmLeadStatus,
  crmViewIsListed,
  isCrmLeadOpen,
  normalizeCrmViewFilters,
} from '@aglyn/aglyn/app-utils/crm'
import { dynamicListDimensionsForCrmView } from '@aglyn/aglyn/app-utils/dynamic-list-rule'
import { NAME_TOKEN_MAX_PREFIX, nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  scopeTokensForHost,
  seenOnlyThroughGrant,
  visibleToHost,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  PluginPersonChange,
  PluginPersonChangesPage,
  PluginPersonChangesRequest,
  PluginPersonFileRequest,
  PluginPersonFindRequest,
  PluginPersonReadRequest,
  PluginPersonRecord,
  PluginPersonRecordRef,
  PluginPersonRecords,
  PluginPersonSearchRequest,
  PluginPersonViewPeople,
  PluginPersonViewRequest,
  PluginPersonWroteInRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import {
  consentGroupForSite,
  firebaseAdmin,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
// The leaves, not the barrel: this plugin's specs substitute the barrel
// wholesale, and the lookup and the restamp must reach the real logic.
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { restampCrmListFieldsAt } from '@aglyn/tenant-data-admin/server/crm-records'
import { collectDynamicListCandidates } from '@aglyn/tenant-data-admin/server/dynamic-list-materialize'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { recordPersonRefund } from './person-refund'

/**
 * THE CRM AS THE PLUGIN THAT KEEPS PEOPLE, asked by the plugins that do not
 * (AGL-3080) — the CRM's side of `plugin-person-records`.
 *
 * Two kinds of record are a person here, in the words `plugin-record-routes`
 * addresses them by: a `contact`, the person once they are known, filed at
 * `orgs/{orgId}/contacts/{id}`; and a `lead`, the person before anybody has
 * qualified them, at `orgs/{orgId}/leads/{personKey}` (AGL-3275). One person
 * is one record (AGL-3232), so a lookup by address answers the contact when
 * there is one and the lead only for a caller that asked for any kind.
 *
 * The record's `data` is the stored document. Beside the fields the platform
 * defines (`marketingConsent…`, `emailState`, `visibleTo`), a contact keeps
 * what each consent group knows of the person in `facets.{groupId}` — the
 * sources, stage, owner, company, address and tags — and a lead keeps the
 * same facts at its top level.
 */

type Firestore = FirebaseFirestore.Firestore

/** The person kinds, as `plugin-record-routes` addresses them. */
export const CRM_PERSON_KINDS = { contact: 'contact', lead: 'lead' } as const

/** The collection each person kind is stored in, under the organization. */
const STORED_IN: Readonly<Record<string, string>> = {
  [CRM_PERSON_KINDS.contact]: 'contacts',
  [CRM_PERSON_KINDS.lead]: 'leads',
}

/** `getAll` takes this many references per call. */
const GET_ALL_CHUNK = 300

/**
 * The most leads a saved Leads view is taken from: the site's most recently
 * seen, the Leads list's own window (AGL-3234).
 */
export const CRM_LEADS_VIEW_WINDOW = 200

export interface CrmPersonRecordsDeps {
  firestore(): Firestore
  /** The organization a site belongs to, or `null` for one with none. */
  orgIdForHost(hostId: string): Promise<string | null>
  /** The consent group a site files its facet under. */
  groupIdForHost(hostId: string): Promise<string>
  /**
   * The addresses a saved Contacts view selects among one site's contacts,
   * read the way the dynamic-list sweep reads one, and whether the read
   * reached the whole view before its budget.
   */
  contactViewEmails(input: { hostId: string; viewId: string }): Promise<{ emails: string[]; complete: boolean }>
}

export function defaultCrmPersonRecordsDeps(): CrmPersonRecordsDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    orgIdForHost: async (hostId) => (await resolveOrgIdForHost(hostId)) ?? null,
    groupIdForHost: async (hostId) => (await consentGroupForSite(hostId)).groupId,
    contactViewEmails: async ({ hostId, viewId }) => {
      const scan = await collectDynamicListCandidates({
        hostId,
        rule: { sources: ['contacts'], viewId },
      })
      return { emails: scan.candidates.map((candidate) => candidate.email), complete: scan.complete }
    },
  }
}

function personOf(kind: string, snapshot: FirebaseFirestore.DocumentSnapshot): PluginPersonRecord {
  const data = (snapshot.data() ?? {}) as Record<string, unknown>
  return { kind, id: snapshot.id, email: normalizeContactEmail(data['email']), data }
}

/**
 * The organization a request names, or the one its site belongs to. A site
 * with no organization THROWS, as the org-data lookup every caller used to
 * make threw: each caller has already decided which way a failed read falls.
 */
async function orgOf(
  deps: CrmPersonRecordsDeps,
  request: { orgId?: string | null; hostId?: string | null },
): Promise<string> {
  const named = String(request.orgId ?? '').trim()
  if (named) return named
  const hostId = String(request.hostId ?? '').trim()
  const resolved = hostId ? await deps.orgIdForHost(hostId) : null
  if (!resolved) throw new Error(`[crm] no organization to find a person in for host ${hostId || '(none)'}`)
  return resolved
}

/** The most people one search answers, whatever the caller asks for. */
export const CRM_PERSON_SEARCH_MAX = 25

/**
 * The one token a typed search asks the contacts' search index for
 * (AGL-3609), or `''` for nothing searchable.
 *
 * A run of digits and phone punctuation is a phone number, read as its
 * digits: `crmPhoneSearchWords` stores the whole number, the number without
 * a country code, its last seven and its last four, so `(555) 123-4567`,
 * `5551234567` and `4567` all find it. Anything else is a name or an
 * address, and the LONGEST word asks — it is the most selective one, and a
 * stored token is a prefix of a word, so `dana@acme.com` and `dana` both
 * reach the contact. Capped at the twelve characters a token keeps.
 */
export function crmPersonSearchWord(text: unknown): string {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return ''
  if (/^[\d\s()+.-]+$/.test(raw)) {
    const digits = raw.replace(/\D/g, '')
    return digits.length >= 4 ? digits.slice(0, NAME_TOKEN_MAX_PREFIX) : ''
  }
  const words = nameSearchKey(raw).split(' ').filter(Boolean)
  const longest = words.reduce((best, word) => (word.length > best.length ? word : best), '')
  return longest.slice(0, NAME_TOKEN_MAX_PREFIX)
}

/**
 * A contacts walk's cursor (AGL-3639): the last contact's `updatedAt` to the
 * nanosecond, and its id for the tie. Opaque to every caller; a millisecond
 * alone would answer a contact written later in the same millisecond twice.
 */
export function encodeContactChangesCursor(updatedAt: unknown, id: string): string | null {
  const stamp = updatedAt as { seconds?: unknown; nanoseconds?: unknown } | null
  const seconds = Number(stamp?.seconds)
  const nanoseconds = Number(stamp?.nanoseconds ?? 0)
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds) || !id) return null
  return `${Math.trunc(seconds)}.${Math.trunc(nanoseconds)}.${id}`
}

/** Reads a cursor this module handed out, or `null` for anything else. */
export function decodeContactChangesCursor(
  cursor: string | null | undefined,
): { seconds: number; nanoseconds: number; id: string } | null {
  const match = /^(\d{1,12})\.(\d{1,9})\.([A-Za-z0-9_-]{1,200})$/.exec(String(cursor ?? ''))
  if (!match) return null
  return { seconds: Number(match[1]), nanoseconds: Number(match[2]), id: match[3] }
}

const millisOf = (value: unknown): number => {
  const stamp = value as { toMillis?: () => number } | null
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0
}

const integerOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null

export function createCrmPersonRecords(deps: CrmPersonRecordsDeps): PluginPersonRecords {
  return {
    /**
     * The contact first, through the org's address index (AGL-2633) so an
     * address a merge folded into another record still names the person who
     * now holds it; then, for a caller that asked for any kind, the lead the
     * address is keyed as. Narrowed to the site when asked, on the document
     * the address names: a record the site cannot see is `null`.
     */
    async find(request: PluginPersonFindRequest) {
      const email = normalizeContactEmail(request.email)
      if (!email) return null
      const orgId = await orgOf(deps, request)
      const org = deps.firestore().collection('orgs').doc(orgId)
      const hostId = String(request.hostId ?? '').trim()
      const narrowTo = request.onlyVisibleToSite && hostId ? hostId : null
      const contact = await findContactByEmail(
        org.collection(STORED_IN[CRM_PERSON_KINDS.contact]),
        email,
        narrowTo ? { hostId: narrowTo } : {},
      )
      if (contact) return personOf(CRM_PERSON_KINDS.contact, contact)
      if (!request.anyKind) return null
      const key = personKey(email)
      if (!key) return null
      const lead = await org.collection(STORED_IN[CRM_PERSON_KINDS.lead]).doc(key).get()
      if (!lead.exists) return null
      if (narrowTo && !visibleToHost(lead.get('visibleTo') as string[] | undefined, narrowTo)) {
        return null
      }
      return personOf(CRM_PERSON_KINDS.lead, lead)
    },

    /** Every record named, read at once; a kind the CRM does not keep is `null`. */
    async read(request: PluginPersonReadRequest) {
      const firestore = deps.firestore()
      const org = firestore.collection('orgs').doc(request.orgId)
      const refs = request.records.map((record) => {
        const collection = STORED_IN[record.kind]
        const id = String(record.id ?? '').trim()
        return collection && id ? org.collection(collection).doc(id) : null
      })
      const wanted = refs.filter((ref): ref is FirebaseFirestore.DocumentReference => ref !== null)
      const snapshots: FirebaseFirestore.DocumentSnapshot[] = []
      for (let start = 0; start < wanted.length; start += GET_ALL_CHUNK) {
        snapshots.push(...(await firestore.getAll(...wanted.slice(start, start + GET_ALL_CHUNK))))
      }
      let at = 0
      return request.records.map((record, index) => {
        if (!refs[index]) return null
        const snapshot = snapshots[at++]
        return snapshot?.exists ? personOf(record.kind, snapshot) : null
      })
    },

    /**
     * Files the person under the containers as the site holds them: on a
     * contact, inside the site's consent-group facet — which campaigns a
     * merchant filed somebody under is that merchant's record, and written at
     * the top it would be readable by every site of an agency's account; on a
     * lead, in the lead's own membership field, whose list fields are then
     * restamped so the Leads list's filter finds it (AGL-3321).
     *
     * `update`, never a merge-set: a dotted path in `set` is a literal field
     * name, and the record must exist. A record the site cannot see is not
     * filed.
     */
    async fileUnder(request: PluginPersonFileRequest) {
      const ids = normalizeContainerIds(request.ids)
      const collection = STORED_IN[request.record.kind]
      const id = String(request.record.id ?? '').trim()
      if (!ids.length || !collection || !id) return { filed: false }
      const orgId = await orgOf(deps, request)
      const ref = deps.firestore().collection('orgs').doc(orgId).collection(collection).doc(id)
      const snapshot = await ref.get()
      if (!snapshot.exists) return { filed: false }
      if (!visibleToHost(snapshot.get('visibleTo') as string[] | undefined, request.hostId)) {
        return { filed: false }
      }
      if (request.record.kind === CRM_PERSON_KINDS.lead) {
        await ref.update({
          [containerMembershipField(request.containerKind)]: FieldValue.arrayUnion(...ids),
          updatedAt: FieldValue.serverTimestamp(),
        })
        await restampCrmListFieldsAt(ref, 'leads')
        return { filed: true }
      }
      const groupId = await deps.groupIdForHost(request.hostId)
      await ref.update({
        [contactContainerFieldPath(groupId, request.containerKind)]: FieldValue.arrayUnion(...ids),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { filed: true }
    },

    recordRefund: (request) => recordPersonRefund(request),

    /**
     * The people a saved view selects for a site (AGL-3234). A colleague's
     * private view is theirs: not listed for this member, so it does not
     * exist for them here either.
     *
     * A Leads view takes the site's most recently seen leads —
     * {@link CRM_LEADS_VIEW_WINDOW}, the Leads list's own window — narrowed by
     * the view's status clause the way the list narrows it: open leads when
     * the view names no status, one status when it does, everything for
     * `all`. Held, not merely seen: a lead another site only SHARED with this
     * one (AGL-3336) is not this site's to take.
     *
     * A Contacts view is read the way the dynamic-list sweep reads one, and
     * each address it selects is resolved to the contact the site may see. A
     * view filtering on something that reading cannot apply is refused whole:
     * dropping the filter would select more people than the view shows.
     */
    async peopleInView(request: PluginPersonViewRequest): Promise<PluginPersonViewPeople> {
      const firestore = deps.firestore()
      const org = firestore.collection('orgs').doc(request.orgId)
      const view = await org.collection(CRM_COLLECTIONS.views).doc(request.viewId).get()
      const data = view.exists ? ((view.data() ?? {}) as Record<string, unknown>) : null
      if (
        !data ||
        !crmViewIsListed(
          { shared: data['shared'] === true, ownerUid: String(data['ownerUid'] ?? '') },
          request.viewerUid,
        )
      ) {
        return { ok: false, reason: 'not-found' }
      }
      const filters = normalizeCrmViewFilters(data['filters'])
      if (data['section'] === 'leads') {
        const statusClause = filters.find((clause) => clause.field === 'status' && clause.op === 'equals')
        const wanted = String(statusClause?.value ?? 'open')
        // Narrowed to what the site may see before it is ordered (AGL-3275):
        // the collection is org-wide, and an agency's sequence must not be
        // offered another client's people.
        const window = await org
          .collection(STORED_IN[CRM_PERSON_KINDS.lead])
          .where('visibleTo', 'array-contains-any', scopeTokensForHost(request.hostId))
          .orderBy('lastSeenAtMs', 'desc')
          .limit(CRM_LEADS_VIEW_WINDOW + 1)
          .get()
        const matching = window.docs.slice(0, CRM_LEADS_VIEW_WINDOW).filter((doc) => {
          const lead = (doc.data() ?? {}) as Record<string, unknown>
          if (seenOnlyThroughGrant(lead, request.hostId)) return false
          if (wanted === 'all') return true
          if (wanted === 'open') return isCrmLeadOpen(lead as never) && !lead['convertedContactId']
          return crmLeadStatus(lead as never) === wanted
        })
        return {
          ok: true,
          people: matching.slice(0, request.limit).map((doc) => ({ kind: CRM_PERSON_KINDS.lead, id: doc.id })),
          total: matching.length,
          truncated: matching.length > request.limit || window.docs.length > CRM_LEADS_VIEW_WINDOW,
        }
      }
      if (data['section'] !== 'contacts') return { ok: false, reason: 'not-people' }
      const { unsupported } = dynamicListDimensionsForCrmView(filters)
      if (unsupported.length) {
        return {
          ok: false,
          reason: 'unsupported',
          unsupported: unsupported.map((clause) => clause.label || clause.field),
        }
      }
      const { emails, complete } = await deps.contactViewEmails({
        hostId: request.hostId,
        viewId: request.viewId,
      })
      const ordered = [...new Set(emails)].sort()
      const contacts = org.collection(STORED_IN[CRM_PERSON_KINDS.contact])
      const found = await Promise.all(
        ordered
          .slice(0, request.limit)
          .map((email) => findContactByEmail(contacts, email, { hostId: request.hostId })),
      )
      const ids = [...new Set(found.filter((snapshot) => snapshot).map((snapshot) => String(snapshot?.id)))]
      return {
        ok: true,
        people: ids.map((id): PluginPersonRecordRef => ({ kind: CRM_PERSON_KINDS.contact, id })),
        total: ordered.length,
        truncated: ordered.length > request.limit || !complete,
      }
    },

    /**
     * The contacts a site may see, oldest change first (AGL-3639): the walk a
     * connector copies people out by. On the Contacts list's own index
     * (`visibleTo` array-contains-any, `updatedAt` ascending), with the id as
     * the tie-break. A contact the site sees only through a sharing grant is
     * read and stepped over — another holder's person is not this site's to
     * export — and the cursor still moves past it. The profile is the site's
     * consent group's facet, never another holder's.
     */
    async changedSince(request: PluginPersonChangesRequest): Promise<PluginPersonChangesPage> {
      const hostId = String(request.hostId ?? '').trim()
      if (!hostId) return { people: [], next: null }
      const orgId = await orgOf(deps, request)
      const groupId = await deps.groupIdForHost(hostId)
      const after = decodeContactChangesCursor(request.after)
      let query = deps
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .collection(STORED_IN[CRM_PERSON_KINDS.contact])
        .where('visibleTo', 'array-contains-any', scopeTokensForHost(hostId))
        .orderBy('updatedAt', 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
      if (after) {
        query = query.startAfter(new Timestamp(after.seconds, after.nanoseconds), after.id)
      }
      const snapshot = await query.limit(Math.max(1, Math.min(500, request.limit))).get()
      const people: PluginPersonChange[] = []
      let next: string | null = null
      for (const doc of snapshot.docs) {
        const data = (doc.data() ?? {}) as Record<string, unknown>
        next = encodeContactChangesCursor(data['updatedAt'], doc.id) ?? next
        if (seenOnlyThroughGrant(data, hostId)) continue
        const email = normalizeContactEmail(data['email'])
        if (!email) continue
        const facet = readContactFacet(data, groupId)
        people.push({
          kind: CRM_PERSON_KINDS.contact,
          id: doc.id,
          email,
          data,
          changedAtMs: millisOf(data['updatedAt']),
          profile: {
            name: typeof facet.name === 'string' && facet.name.trim() ? facet.name.trim() : null,
            phone: typeof facet.phone === 'string' && facet.phone.trim() ? facet.phone.trim() : null,
            tags: Array.isArray(facet.tags) ? facet.tags.filter((tag) => typeof tag === 'string') : [],
            lifetimeValueCents: integerOrNull(facet.ltvCents),
            ordersCount: integerOrNull(facet.ordersCount),
          },
        })
      }
      return { people, next }
    },

    /**
     * Whether each person has ever written in: an inbound email on their
     * timeline, filed on the contact, or on the lead while they were one
     * (AGL-3234). One keyed query each; a failed one is unknown.
     */
    async wroteIn(request: PluginPersonWroteInRequest) {
      const activities = deps
        .firestore()
        .collection('orgs')
        .doc(request.orgId)
        .collection(CRM_COLLECTIONS.activities)
      return Promise.all(
        request.records.map(async (record) => {
          const field =
            record.kind === CRM_PERSON_KINDS.contact
              ? 'contactId'
              : record.kind === CRM_PERSON_KINDS.lead
                ? 'leadId'
                : null
          const id = String(record.id ?? '').trim()
          if (!field || !id) return null
          try {
            const snapshot = await activities
              .where(field, '==', id)
              .where('direction', '==', 'inbound')
              .limit(1)
              .get()
            return !snapshot.empty
          } catch (error) {
            console.error('[crm] inbound email lookup failed; reading as unknown', error)
            return null
          }
        }),
      )
    },

    /**
     * Contacts the site may see whose name, address, company or phone
     * starts with the typed word (AGL-3609): ONE query on the scoped search
     * tokens every contact writer stamps, `array-contains-any` over the
     * site's scope tokens joined to the word — the same clause the Contacts
     * list runs under a site, so a record the site cannot see is never
     * answered and no index beyond the field's own is needed.
     */
    async search(request: PluginPersonSearchRequest) {
      const word = crmPersonSearchWord(request.text)
      const hostId = String(request.hostId ?? '').trim()
      const limit = Math.min(CRM_PERSON_SEARCH_MAX, Math.max(0, Math.floor(Number(request.limit) || 0)))
      if (!word || !hostId || !limit) return []
      const orgId = await orgOf(deps, request)
      const tokens = scopeTokensForHost(hostId).map((scope) => `${scope}${CRM_SCOPED_SEARCH_JOIN}${word}`)
      const snapshot = await deps
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .collection(STORED_IN[CRM_PERSON_KINDS.contact])
        .where(CRM_SCOPED_SEARCH_TOKENS_FIELD, 'array-contains-any', tokens)
        .limit(limit)
        .get()
      return snapshot.docs.map((doc) => personOf(CRM_PERSON_KINDS.contact, doc))
    },
  }
}

/** The service as the CRM registers it, its storage the admin app's. */
export const crmPersonRecords: Required<PluginPersonRecords> = {
  find: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).find(request),
  read: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).read(request),
  fileUnder: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).fileUnder!(request),
  recordRefund: (request) => recordPersonRefund(request),
  peopleInView: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).peopleInView!(request),
  wroteIn: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).wroteIn!(request),
  search: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).search!(request),
  changedSince: (request) => createCrmPersonRecords(defaultCrmPersonRecordsDeps()).changedSince!(request),
}
