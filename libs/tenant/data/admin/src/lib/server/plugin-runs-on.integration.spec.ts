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
 * A marketplace plugin installed for every site but some, end to end against
 * the Firestore emulator (AGL-4047).
 *
 * The real transaction writes the sites left out, then the workspace's pin
 * lands, and the realm join a published page reads loads the plugin on every
 * site but those. A site added later has no entry, so it runs it, and a site
 * left out can turn it back on.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   npx jest --config libs/tenant/data/admin/jest.integration.config.ts
 */

import firebaseAdmin from './firebase-admin'
import { writePluginRunsOn } from './plugin-runs-on'
import { getRealmPluginInstalls } from './realm-plugins'

const ORG = 'zz-runs-on-org'
const LISTING = 'zz-runs-on-listing'
const VERSION = '1.0.0'
const [A, B, C, LATER] = ['zz-runs-on-a', 'zz-runs-on-b', 'zz-runs-on-c', 'zz-runs-on-later']

const db = () => firebaseAdmin.app().firestore()
const host = (id: string) => db().collection('hosts').doc(id)

async function wipe(): Promise<void> {
  await db().recursiveDelete(db().collection('marketplaceListings').doc(LISTING))
  await db().recursiveDelete(db().collection('orgs').doc(ORG))
  for (const id of [A, B, C, LATER]) {
    await db().recursiveDelete(host(id))
    await db().collection('hostIndex').doc(id).delete()
  }
}

async function seed(): Promise<void> {
  const listing = db().collection('marketplaceListings').doc(LISTING)
  await listing.set({ displayName: 'Runs On Fixture' })
  await listing.collection('pluginVersions').doc(VERSION).set({
    sha256: 'a'.repeat(64),
    signature: 'c2lnbmF0dXJl',
    trust: 'realm',
    hostAbi: 1,
  })
  // A workspace with a configured list that does not name the listing yet:
  // the install is what switches it on.
  await db()
    .collection('orgs')
    .doc(ORG)
    .set({ hosts: { [A]: true, [B]: true, [C]: true }, enabledPlugins: ['crm'] })
  for (const [id, name] of [
    [A, 'Bakery'],
    [B, 'Cafe'],
    [C, 'Catering'],
  ]) {
    await host(id).set({ orgId: ORG, displayName: name })
    await db().collection('hostIndex').doc(id).set({ orgId: ORG })
  }
}

/** What the install route does after its checks: the sites left out, then the pin. */
async function installLeavingOut(
  exceptHostIds: string[],
  mayChangeSite: (hostId: string) => boolean = () => true,
) {
  const written = await writePluginRunsOn({
    firestore: db(),
    orgId: ORG,
    pluginId: LISTING,
    label: 'Runs On Fixture',
    choice: { mode: 'allExcept', exceptHostIds },
    installing: true,
    mayChangeSite: async (hostId) => mayChangeSite(hostId),
    refusedOnSite: (name) => `refused on ${name}`,
    now: () => firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  })
  if (!('problem' in written)) {
    await db().collection('orgs').doc(ORG).collection('installs').doc(LISTING).set({ version: VERSION })
    await db()
      .collection('orgs')
      .doc(ORG)
      .update({ enabledPlugins: firebaseAdmin.firestore.FieldValue.arrayUnion(LISTING) })
  }
  return written
}

const runsOn = async (hostId: string) => (await getRealmPluginInstalls({ hostId })).length > 0

jest.setTimeout(30000)

describe('a marketplace plugin installed for every site but some', () => {
  beforeEach(async () => {
    await wipe()
    await seed()
  })
  afterAll(async () => {
    await wipe()
  })

  it('runs on every site but the one left out, and on a site added later', async () => {
    const written = await installLeavingOut([B])
    expect(written).toEqual({ ok: true, leftOutHostIds: [B], broughtBackHostIds: [] })
    expect((await host(B).get()).get('disabledPlugins')).toEqual([LISTING])
    expect(await runsOn(A)).toBe(true)
    expect(await runsOn(B)).toBe(false)
    expect(await runsOn(C)).toBe(true)

    await host(LATER).set({ orgId: ORG, displayName: 'Later' })
    await db().collection('hostIndex').doc(LATER).set({ orgId: ORG })
    expect(await runsOn(LATER)).toBe(true)
  })

  it('a site left out can turn it back on for itself', async () => {
    await installLeavingOut([B])
    await host(B).update({ disabledPlugins: [] })
    expect(await runsOn(B)).toBe(true)
  })

  it('keeps a site’s earlier switch, and writes nothing when one site refuses', async () => {
    await host(C).update({ disabledPlugins: [LISTING] })
    const refused = await installLeavingOut([A, B], (hostId) => hostId !== B)
    expect(refused).toEqual({ ok: false, status: 403, problem: 'refused on Cafe' })
    expect((await host(A).get()).get('disabledPlugins')).toBeUndefined()
    expect((await db().collection('orgs').doc(ORG).collection('installs').doc(LISTING).get()).exists).toBe(false)

    await installLeavingOut([A])
    expect(await runsOn(A)).toBe(false)
    expect(await runsOn(B)).toBe(true)
    // Catering switched it off before; the install leaves that alone.
    expect(await runsOn(C)).toBe(false)
  })
})
