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
 * WHICH WRITE MOVES A COMPONENT ONTO A LIVE PAGE (AGL-2486).
 *
 * The bug this pins: a component edited in the besigner and SAVED did not
 * appear on the live site, and would not have appeared however long anyone
 * waited. The editor nonetheless said "the live pages using it are refreshing
 * now" and fired a full dependent scan + cache drop for every screen that
 * embeds the component.
 *
 * The reason is a storage asymmetry, not a cache one. A screen version IS what
 * the tenant renders (`getScreenVersion` reads
 * `screens/{id}/versions/{versionId}`), so saving an already-published screen
 * version genuinely changes live bytes and the ISR window is the only delay.
 * A component version is NOT: `getComponents` reads the PARENT doc
 * `components/{id}` — one query per render, which is why nodes were never
 * moved into version docs — so a component save writes a document no renderer
 * ever opens. Only FILE ▸ Publish, which copies the tree onto the parent,
 * changes what a visitor sees.
 *
 * Cache invalidation cannot rescue that, and this spec is the proof: it drives
 * a real Firestore and recomposes an embedding screen after each write, with
 * no cache anywhere in the picture (`withRenderCache` falls back to the
 * uncached read outside Next). The save is invisible with the caches already
 * cold. So the fix belongs on the write, not on the drop — and the drop
 * belongs on the publish, where the bytes actually move.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is unaffected
 * and this can never touch production. Start the emulator (docs/E2E_LOCAL.md),
 * then:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c libs/tenant/runtime/jest.config.ts \
 *       --testPathPatterns component-publish-propagation --maxWorkers=2
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const HOST = 'e2e-cmp-propagation'
const COMPONENT = 'cmpFooter'
const COMPONENT_VERSION = 'cv1'
const SCREEN = 'scrHome'
const SCREEN_VERSION = 'sv1'

const OLD = 'CHEVRON-BEFORE-THE-EDIT'
const NEW = 'CHEVRON-AFTER-THE-EDIT'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

/** The component's own tree, with the label the author is editing. */
const componentNodes = (label: string) => ({
  cRoot: {
    $id: 'cRoot',
    componentId: 'div',
    props: { 'data-marker': label },
    nodes: [],
  },
})

describeEmulated('a component reaches live pages on PUBLISH, not on SAVE (AGL-2486)', () => {
  let db: Firestore
  let composeScreenNodes: typeof import('./compose-screen-nodes').composeScreenNodes

  const renderedMarkers = async (): Promise<string> => {
    const composed = await composeScreenNodes({
      hostId: HOST,
      screenId: SCREEN,
      screen: { versionId: SCREEN_VERSION } as never,
    })
    return JSON.stringify(composed ?? {})
  }

  beforeAll(async () => {
    db = getFirestore()
    const host = db.collection('hosts').doc(HOST)
    await host.set({ subdomain: HOST, screens: { [SCREEN]: '/' } })
    // The PUBLISHED copy of the component: what `getComponents` reads.
    await host.collection('components').doc(COMPONENT).set({
      rootId: 'cRoot',
      nodes: componentNodes(OLD),
      versionId: COMPONENT_VERSION,
    })
    // The version the besigner has open and saves into.
    await host
      .collection('components')
      .doc(COMPONENT)
      .collection('versions')
      .doc(COMPONENT_VERSION)
      .set({ nodes: componentNodes(OLD) })
    // A published screen that embeds the component.
    await host.collection('screens').doc(SCREEN).set({ versionId: SCREEN_VERSION })
    await host
      .collection('screens')
      .doc(SCREEN)
      .collection('versions')
      .doc(SCREEN_VERSION)
      .set({
        nodes: {
          root: { $id: 'root', componentId: 'div', nodes: ['inst'] },
          inst: {
            $id: 'inst',
            componentId: 'reusableInstance',
            parentId: 'root',
            props: { refId: COMPONENT },
            nodes: [],
          },
        },
      })
    composeScreenNodes = (await import('./compose-screen-nodes')).composeScreenNodes
  }, 60_000)

  it('the embedding screen renders the component that is on the PARENT doc', async () => {
    expect(await renderedMarkers()).toContain(OLD)
  }, 60_000)

  it('THE BUG: saving the published component VERSION changes nothing a visitor sees', async () => {
    // Exactly what `saveComponentVersion` in the component besigner writes:
    // the version document, and only the version document.
    await db
      .collection('hosts')
      .doc(HOST)
      .collection('components')
      .doc(COMPONENT)
      .collection('versions')
      .doc(COMPONENT_VERSION)
      .set({ nodes: componentNodes(NEW) })

    const rendered = await renderedMarkers()
    // No cache is involved here — this is a cold read of Firestore. The edit
    // is absent because the renderer never opens the document it was written
    // to, which is why no revalidate window and no cache drop would ever
    // surface it.
    expect(rendered).not.toContain(NEW)
    expect(rendered).toContain(OLD)
  }, 60_000)

  it('publishing copies the tree onto the parent doc, and the screen picks it up', async () => {
    // What FILE ▸ Publish writes.
    await db
      .collection('hosts')
      .doc(HOST)
      .collection('components')
      .doc(COMPONENT)
      .update({ nodes: componentNodes(NEW) })

    const rendered = await renderedMarkers()
    expect(rendered).toContain(NEW)
    expect(rendered).not.toContain(OLD)
  }, 60_000)
})
