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
 * A revoked or removed member leaves the authorization projections
 * (AGL-2985).
 *
 * `syncOrgAuthProjections` recomputes `memberRoles` and `memberPermissions`
 * on every site from the roster. It wrote them with `{ merge: true }`, which
 * merges a nested map key by key and KEEPS every key the new map omits — so a
 * member who dropped out of the projection kept their key, and the Firestore
 * rules, which read `hosts/{hostId}.memberRoles[uid]` and nothing else to let
 * a person edit a site, went on granting it. Every in-memory double of the
 * batch writer shallow-merges or ignores the options, so none of them could
 * see this; the emulator applies the real merge.
 *
 * Driven through the real membership functions, not through the writer
 * alone, because the defect is what a revoke and a removal leave behind.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. The functions it calls
 * read and write Firestore only.
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns auth-projections-replace.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-projection-replace-org'
const HOST = 'e2e-projection-replace-host'
const OWNER = 'e2e-projection-owner'
/** An org-wide admin who is removed from the organization. */
const LEAVER = 'e2e-projection-leaver'
/** A collaborator scoped to the one site, whose access is revoked. */
const COLLABORATOR = 'e2e-projection-collaborator'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('the auth projections replace what they recompute (AGL-2985)', () => {
  let db: Firestore
  let organizations: typeof import('./organizations')

  const hostData = async () =>
    (await db.collection('hosts').doc(HOST).get()).data() ?? {}

  const cleanUp = async () => {
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    await db.collection('hosts').doc(HOST).delete()
    for (const uid of [OWNER, LEAVER, COLLABORATOR]) {
      await db.recursiveDelete(db.collection('users').doc(uid))
    }
  }

  beforeAll(async () => {
    db = getFirestore()
    organizations = await import('./organizations')
    await cleanUp()

    await db
      .collection('orgs')
      .doc(ORG)
      .set({ name: 'Projection Replace Fixture', hosts: { [HOST]: true } })
    await db
      .collection('hosts')
      .doc(HOST)
      .set({ orgId: ORG, displayName: 'Fixture site', subdomain: 'fixture' })
    const members = db.collection('orgs').doc(ORG).collection('members')
    await members.doc(OWNER).set({ role: 'owner', allHosts: true })
    await members.doc(LEAVER).set({ role: 'admin', allHosts: true })
    await members.doc(COLLABORATOR).set({
      role: 'editor',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
    })

    await organizations.syncOrgAuthProjections(ORG)
  }, 120_000)

  afterAll(async () => {
    if (EMULATED) await cleanUp()
  }, 60_000)

  it('CONTROL: the first projection grants every member their site role', async () => {
    // Without this, the assertions below would pass against a writer that
    // wrote nothing at all.
    const roles = (await hostData())['memberRoles'] as Record<string, string>
    expect(roles[OWNER]).toBeDefined()
    expect(roles[LEAVER]).toBeDefined()
    expect(roles[COLLABORATOR]).toBe('editor')
  }, 60_000)

  it('THE DEFECT: a revoked collaborator no longer holds a site role', async () => {
    await organizations.revokeHostAccess(ORG, COLLABORATOR, HOST)
    const roles = (await hostData())['memberRoles'] as Record<string, string>
    expect(Object.keys(roles)).not.toContain(COLLABORATOR)
    // The rest of the roster is untouched by the replacement.
    expect(roles[OWNER]).toBeDefined()
    expect(roles[LEAVER]).toBeDefined()
  }, 60_000)

  it('a member removed from the organization loses every site key', async () => {
    await organizations.removeOrgMember(ORG, LEAVER)
    const host = await hostData()
    expect(Object.keys(host['memberRoles'] as object)).not.toContain(LEAVER)
    expect(Object.keys((host['memberPermissions'] ?? {}) as object)).not.toContain(
      LEAVER,
    )
    // Fields the projection does not own survive the replacement.
    expect(host['displayName']).toBe('Fixture site')
    expect(host['subdomain']).toBe('fixture')
  }, 60_000)
})
