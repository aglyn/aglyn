/**
 * @jest-environment node
 */

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
 * AGL-2486: a document with no `nameLower` is invisible to the query the
 * switchers used, and visible to the one they use now — proved against a REAL
 * Firestore rather than a mock.
 *
 * ## Why this cannot be a unit test
 *
 * The defect is not in our code's logic, it is in Firestore's: **`orderBy` on
 * a field omits every document that does not carry it**. A mocked `getDocs`
 * returns whatever the mock was told to return, so a unit test written against
 * one would pass with either query shape and prove nothing. That is exactly
 * how this survived: the existing switcher specs only ever exercise documents
 * that happen to have the field.
 *
 * So this runs the two real query shapes against the emulator and compares
 * what comes back.
 *
 * Driven through the ADMIN SDK, deliberately. The claim is about Firestore's
 * own indexing behaviour, not about a particular client, and the admin SDK
 * bypasses the security rules the emulator loads — which would otherwise
 * refuse an unauthenticated fixture write and turn a real finding into a
 * PERMISSION_DENIED. The query shapes are the same ones the hook builds.
 *
 * ## Running it
 *
 *   cd cloud && npx firebase-tools@13 emulators:start \
 *     --config firebase.e2e.json --project aglyn-main --only auth,firestore
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 npx jest \
 *     --config libs/tenant/feature/instance/jest.config.ts \
 *     --testPathPatterns switcher-search-window
 *
 * Gated on `FIRESTORE_EMULATOR_HOST` exactly as
 * `erase-org-projections.emulator.spec.ts` is — the repo's existing
 * convention, and synchronous, which matters: a probe resolved in `beforeAll`
 * is too late, because `describe` bodies have already chosen `it` vs
 * `it.skip` by then. Getting that wrong is silent, and it cost this file a
 * run that reported six green tests having executed none of them.
 */

import { deleteApp, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { nameSearchKey, scoreMatch } from '@aglyn/aglyn'

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? ''
const EMULATED = Boolean(HOST)
const SITE = 'agl2486-switcher-window'
const describeEmulated = EMULATED ? describe : describe.skip

let app: ReturnType<typeof initializeApp> | undefined
let db: Firestore

const SCREENS = [
  // The document at the heart of this: created by a path that does not stamp
  // `nameLower`. Every seeded screen in the repo's own e2e fixtures looks
  // exactly like this.
  { id: 'agl2486-unstamped', displayName: 'Launching soon' },
  // A normal one, so a failure here cannot be "the query returned nothing".
  {
    id: 'agl2486-stamped',
    displayName: 'Launch checklist',
    nameLower: nameSearchKey('Launch checklist'),
  },
  // The "Main Layout" case: the word people search by is not the first word.
  {
    id: 'agl2486-main-layout',
    displayName: 'Main Layout',
    nameLower: nameSearchKey('Main Layout'),
  },
]

beforeAll(async () => {
  if (!EMULATED) return
  app = initializeApp({ projectId: 'aglyn-main' }, `agl2486-${Date.now()}`)
  db = getFirestore(app)
  for (const screen of SCREENS) {
    const { id, ...fields } = screen
    await db.collection('hosts').doc(SITE).collection('screens').doc(id).set(fields)
  }
}, 60_000)

afterAll(async () => {
  if (!EMULATED) return
  for (const screen of SCREENS) {
    await db
      .collection('hosts').doc(SITE).collection('screens').doc(screen.id)
      .delete()
      .catch(() => undefined)
  }
  if (app) await deleteApp(app)
}, 60_000)

const ref = () => db.collection('hosts').doc(SITE).collection('screens')
const names = (snapshot: { docs: Array<{ data: () => any }> }) =>
  snapshot.docs.map((document) => document.data().displayName)

/** The query shape the switchers used before AGL-2486. */
async function oldPrefixSearch(text: string) {
  const key = nameSearchKey(text)
  return names(
    await ref()
      .orderBy('nameLower')
      .startAt(key)
      .endAt(key + '')
      .limit(20)
      .get(),
  )
}

/** The window the switchers read now, matched client-side. */
async function newWindowSearch(text: string) {
  const snapshot = await ref().orderBy(FieldPath.documentId()).limit(50).get()
  return snapshot.docs
    .map((document) => document.data().displayName as string)
    .filter((name) => scoreMatch({ name }, text) !== null)
}

describeEmulated('a screen whose write path never stamped nameLower', () => {
  /**
   * The defect, named. "Launching soon" is in the collection and the query
   * that backs the switcher's search cannot return it — not because it does
   * not match, but because Firestore omits documents lacking the ordered
   * field.
   */
  it('is INVISIBLE to the old name-prefix query', async () => {
    const hits = await oldPrefixSearch('launch')
    // The stamped sibling proves the query itself works and the fixture is
    // present — without this the assertion below could pass on an empty
    // collection, which would prove nothing at all.
    expect(hits).toContain('Launch checklist')
    expect(hits).not.toContain('Launching soon')
  }, 60_000)

  it('is FOUND by the window the switcher reads now', async () => {
    const hits = await newWindowSearch('launch')
    expect(hits).toContain('Launching soon')
    expect(hits).toContain('Launch checklist')
  }, 60_000)
})

describeEmulated('a name whose searchable word is not its first', () => {
  /** The case that is firing on every surface today, unstamped or not. */
  it('is invisible to the old query even when fully stamped', async () => {
    const hits = await oldPrefixSearch('layout')
    expect(hits).not.toContain('Main Layout')
  }, 60_000)

  it('is found by the window', async () => {
    expect(await newWindowSearch('layout')).toContain('Main Layout')
  }, 60_000)
})

describeEmulated('the ordering the window uses', () => {
  /**
   * The property that disarms the whole class: every document carries an id,
   * so this ordering cannot omit one. Asserted by counting, because that is
   * the thing the old shape got wrong.
   */
  it('returns EVERY document in the collection', async () => {
    const windowed = await ref().orderBy(FieldPath.documentId()).limit(50).get()
    const byName = await ref().orderBy('nameLower').limit(50).get()
    expect(windowed.size).toBe(SCREENS.length)
    expect(byName.size).toBe(SCREENS.length - 1)
  }, 60_000)
})
