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
 * AGL-1466 against a REAL Firestore: the document a folder create stores,
 * and whether the site-scoped listener can then see it.
 *
 * Asserted here rather than on the dialog because THE DIALOG IS THE THING
 * THAT LIED — it displayed `['org']` whenever the stored value was absent,
 * so a render test of the sharing editor passed happily for three weeks
 * while every folder in the org was invisible from every host. The only
 * witness that cannot be fooled is the stored document plus the query the
 * product actually issues.
 *
 * The query half matters as much as the write half: `array-contains-any`
 * fails CLOSED on a missing field, which is not obvious from reading it and
 * is exactly why "8 of 9 folders" vanished. Running it proves the symptom
 * and its absence rather than reasoning about them.
 *
 * Skipped unless the Firestore emulator host is set, so a normal `jest` run
 * is unaffected and this can never touch production:
 *
 *   npm run firebase:emulate
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --testPathPatterns media-folder-create-scope
 */

import * as Aglyn from '@aglyn/aglyn'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'folder-scope-jest'
const HOST = 'folder-scope-jest-h1'

// No credential: with FIRESTORE_EMULATOR_HOST set the Admin SDK talks only
// to the local emulator, so the root .env's production key is never reached.
if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('media folder creation scope (emulator)', () => {
  let db: Firestore
  let folders: FirebaseFirestore.CollectionReference

  beforeAll(async () => {
    db = getFirestore()
    folders = db.collection('orgs').doc(ORG).collection('mediaFolders')
    // A clean collection per run: these assertions count documents.
    const existing = await folders.get()
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()))
  })

  /**
   * The read set the library builds when it is opened FOR A SITE
   * (`forHostId`) — the exact constraint at the folder listener.
   */
  const hostTokens = () => Aglyn.scopeTokensForHost(HOST)

  async function visibleFromHost(): Promise<string[]> {
    const snapshot = await folders
      .where('visibleTo', 'array-contains-any', hostTokens())
      .get()
    return snapshot.docs.map((doc) => doc.get('name')).sort()
  }

  it('stores visibleTo on the document the NEW FOLDER button writes', async () => {
    const ref = folders.doc('created-through-the-button')
    await ref.set(
      Aglyn.newMediaFolderDoc({
        name: 'Product',
        parentId: null,
        createdAt: new Date('2026-08-13T12:00:00Z'),
        visibleTo: Aglyn.defaultScopeForNewResource({ hostId: null }),
      }),
    )

    const stored = (await ref.get()).data() as Record<string, unknown>
    expect(stored['name']).toBe('Product')
    expect(stored['visibleTo']).toEqual([Aglyn.ORG_SCOPE_TOKEN])
  })

  /**
   * The user-visible symptom, both ways round. "Product", created from the
   * org page, has to appear when the same library is opened from a host —
   * that is the whole bug. "Legacy" is what the old code wrote, kept as the
   * counterfactual so this spec proves the query fails closed rather than
   * assuming it.
   */
  it('shows a folder created in the org scope to a host-scoped listener', async () => {
    await folders.doc('legacy-unscoped').set({
      name: 'Legacy',
      parentId: null,
      createdAt: new Date('2026-08-13T12:00:00Z'),
    })

    const seen = await visibleFromHost()
    expect(seen).toContain('Product')
    expect(seen).not.toContain('Legacy')
  })

  /**
   * A folder created while the library is open for a site under an org that
   * has chosen host-default resources (AGL-1048) is scoped to that site —
   * and is still visible from it, which is the property that matters. The
   * point of routing through `defaultScopeForNewResource` is that folders
   * follow the same rule as the datasets and uploads created beside them.
   */
  it('honours a host default without hiding the folder from that host', async () => {
    await folders.doc('created-for-a-site').set(
      Aglyn.newMediaFolderDoc({
        name: 'Client only',
        parentId: null,
        createdAt: new Date('2026-08-13T12:00:00Z'),
        visibleTo: Aglyn.defaultScopeForNewResource({
          defaultResourceScope: 'host',
          hostId: HOST,
        }),
      }),
    )

    expect(await visibleFromHost()).toContain('Client only')
    const other = await folders
      .where('visibleTo', 'array-contains-any', Aglyn.scopeTokensForHost('some-other-host'))
      .get()
    expect(other.docs.map((doc) => doc.get('name'))).not.toContain('Client only')
  })
})
