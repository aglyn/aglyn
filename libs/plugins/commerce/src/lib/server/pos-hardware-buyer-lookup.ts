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

import * as Aglyn from '@aglyn/aglyn/server'
import { nameSearchKey, nameSearchTokens, NAME_TOKEN_MAX_PREFIX } from '@aglyn/aglyn/app-utils/name-search'
import { firebaseAdmin, hostDisplayName } from '@aglyn/tenant-data-admin'
import { findUserByEmailAcrossPools } from '@aglyn/tenant-data-admin/server/auth-pools'

/*==========================================
 * FINDING THE BUYER OF A CARD READER SOLD IN PERSON (AGL-4038).
 *
 * A register user on the platform's own store looks up who they are selling
 * a reader to, among every account on the platform, by:
 *
 *   - an exact email address, through every sign-in pool;
 *   - a person's name, through the word-prefix `searchTokens` every
 *     workspace roster row carries (`orgs/{orgId}/members`). Other
 *     collections are called `members` too — an email list's subscribers,
 *     which are a store's own contacts — so the collection-group query asks
 *     for `consoleUserType`, which only a roster row carries
 *     (`orgMemberListFields`, backfilled by
 *     `tools/scripts/backfill-org-member-list-fields.mjs`), with its own
 *     index, and keeps only rows under `orgs/`. The typed words must each
 *     begin a word of the person's NAME, so a match on an address alone is
 *     never shown;
 *   - a workspace's name, through the workspaces' own `nameTokens`.
 *
 * Every answer is an indexed query, never a scan of a loaded window, and is
 * capped. Each says the least that lets the right buyer be picked: a
 * person's display name and their email address in full, so the register
 * user can read it back to them, and each of their workspaces with its
 * stores, whether the workspace's plan includes the point of sale and
 * whether each store has a card reader Location. Never a phone number, a
 * street address, a role or a bill. The audit log keeps the typed address
 * masked (`pos-hardware-sale.ts`).
 *=========================================*/

export interface HardwareBuyerStore {
  hostId: string
  name: string
  /** Whether card readers can be registered to it: its Stripe Terminal Location exists. */
  hasLocation: boolean
}

export interface HardwareBuyerWorkspace {
  orgId: string
  name: string
  /** Whether the workspace's plan includes the point of sale. */
  posPlan: boolean
  stores: HardwareBuyerStore[]
}

export interface HardwareBuyerPerson {
  uid: string
  name: string
  /** Their email address, in full. */
  email: string
  workspaces: HardwareBuyerWorkspace[]
}

export interface HardwareBuyerFindResult {
  kind: 'email' | 'name'
  people: HardwareBuyerPerson[]
  /** Workspaces whose name matched, each with the person it would be attached to. */
  workspaces: Array<HardwareBuyerWorkspace & { owner: Omit<HardwareBuyerPerson, 'workspaces'> | null }>
  /** An exact address with no account: sell anyway, invite, attach later. */
  noAccount: boolean
}

/** How many people, workspaces and stores one answer carries at most. */
export const BUYER_LOOKUP_LIMITS = { people: 8, workspaces: 8, workspacesPerPerson: 5, storesPerWorkspace: 10 }

const EXACT_EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/

function firestore() {
  return firebaseAdmin.app().firestore()
}

/** The typed words, as the tokens are stored. */
function words(query: string): string[] {
  return nameSearchKey(query)
    .split(' ')
    .filter(Boolean)
    .map((word) => [...word].slice(0, NAME_TOKEN_MAX_PREFIX).join(''))
}

/** Whether every typed word begins a word of `name`. */
function nameMatches(name: string, typed: readonly string[]): boolean {
  const own = new Set(nameSearchTokens(name))
  return typed.length > 0 && typed.every((word) => own.has(word))
}

/** The longest typed word: the narrowest single `array-contains`. */
function narrowest(typed: readonly string[]): string {
  return [...typed].sort((a, b) => b.length - a.length)[0] ?? ''
}

async function storesOf(orgId: string): Promise<HardwareBuyerStore[]> {
  const hosts = await firestore()
    .collection('hosts')
    .where('orgId', '==', orgId)
    .limit(BUYER_LOOKUP_LIMITS.storesPerWorkspace)
    .get()
  return Promise.all(
    hosts.docs.map(async (doc: any) => {
      const config = await firestore()
        .collection('hosts')
        .doc(String(doc.id))
        .collection('terminal')
        .doc('config')
        .get()
      return {
        hostId: String(doc.id),
        name: hostDisplayName(doc.data() as Record<string, unknown>, String(doc.id)),
        hasLocation: Boolean(config.exists && config.get('stripeLocationId')),
      }
    }),
  )
}

async function workspace(orgId: string, org?: Record<string, unknown>): Promise<HardwareBuyerWorkspace | null> {
  const data = org ?? ((await firestore().collection('orgs').doc(orgId).get()).data() as Record<string, unknown> | undefined)
  if (!data) return null
  return {
    orgId,
    name: String(data['name'] ?? '').trim() || 'Workspace',
    posPlan: Aglyn.checkEntitlement(data as never, 'pos'),
    stores: await storesOf(orgId),
  }
}

/** A row of a workspace's own roster, `orgs/{orgId}/members/{uid}`, and no other `members`. */
function isRosterRow(doc: { ref?: any }): boolean {
  const parent = doc.ref?.parent?.parent
  return parent?.parent?.id === 'orgs'
}

/** The workspaces a person is on, by their roster rows. */
async function workspacesOf(uid: string): Promise<HardwareBuyerWorkspace[]> {
  const rows = await firestore()
    .collectionGroup('members')
    .where('uid', '==', uid)
    .limit(BUYER_LOOKUP_LIMITS.workspacesPerPerson)
    .get()
  const orgIds = [
    ...new Set(rows.docs.filter(isRosterRow).map((doc: any) => String(doc.ref.parent.parent.id))),
  ] as string[]
  return (await Promise.all(orgIds.map((orgId) => workspace(orgId)))).filter(
    (found): found is HardwareBuyerWorkspace => Boolean(found),
  )
}

/** The people whose name begins with every typed word, one per account. */
async function peopleNamed(typed: readonly string[]): Promise<Array<{ uid: string; name: string; email: string }>> {
  const rows = await firestore()
    .collectionGroup('members')
    .where('consoleUserType', 'in', ['manager', 'collaborator'])
    .where('searchTokens', 'array-contains', narrowest(typed))
    .limit(30)
    .get()
  const people = new Map<string, { uid: string; name: string; email: string }>()
  for (const doc of rows.docs as Array<{ id: string; ref?: any; data: () => Record<string, unknown> }>) {
    if (!isRosterRow(doc)) continue
    const data = doc.data()
    const uid = String(data['uid'] ?? doc.id)
    const name = String(data['displayName'] ?? '').trim()
    // A match on the address or the job title alone is not a match on a name.
    if (!uid || people.has(uid) || !nameMatches(name, typed)) continue
    people.set(uid, { uid, name, email: String(data['email'] ?? '') })
    if (people.size >= BUYER_LOOKUP_LIMITS.people) break
  }
  return [...people.values()]
}

/** The workspaces whose name begins with every typed word. */
async function workspacesNamed(typed: readonly string[]) {
  const orgs = await firestore()
    .collection('orgs')
    .where('nameTokens', 'array-contains', narrowest(typed))
    .limit(20)
    .get()
  const matched = (orgs.docs as Array<{ id: string; data: () => Record<string, unknown> }>)
    .filter((doc) => nameMatches(String(doc.data()['name'] ?? ''), typed))
    .slice(0, BUYER_LOOKUP_LIMITS.workspaces)
  return Promise.all(
    matched.map(async (doc) => {
      const data = doc.data()
      const found = (await workspace(String(doc.id), data)) as HardwareBuyerWorkspace
      const ownerUid = String(data['ownerUid'] ?? '')
      const owner = ownerUid
        ? await firestore().collection('orgs').doc(String(doc.id)).collection('members').doc(ownerUid).get()
        : null
      return {
        ...found,
        owner: owner?.exists
          ? {
              uid: ownerUid,
              name: String(owner.get('displayName') ?? '').trim(),
              email: String(owner.get('email') ?? ''),
            }
          : null,
      }
    }),
  )
}

/**
 * Looks a buyer up. An exact address is looked up as one; anything else as
 * a person's name and a workspace's. Every address is answered in full.
 */
export async function findHardwareBuyers(query: string): Promise<HardwareBuyerFindResult> {
  const text = query.trim()
  if (EXACT_EMAIL.test(text)) {
    const user = await findUserByEmailAcrossPools(text)
    if (!user) return { kind: 'email', people: [], workspaces: [], noAccount: true }
    const uid = user.record.uid
    return {
      kind: 'email',
      people: [
        {
          uid,
          name: String(user.record.displayName ?? '').trim(),
          email: text.toLowerCase(),
          workspaces: await workspacesOf(uid),
        },
      ],
      workspaces: [],
      noAccount: false,
    }
  }
  const typed = words(text)
  if (!typed.length) return { kind: 'name', people: [], workspaces: [], noAccount: false }
  const [named, workspaces] = await Promise.all([peopleNamed(typed), workspacesNamed(typed)])
  const people = await Promise.all(
    named.map(async (person) => ({
      uid: person.uid,
      name: person.name,
      email: person.email,
      workspaces: await workspacesOf(person.uid),
    })),
  )
  return { kind: 'name', people, workspaces, noAccount: false }
}
