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

// The demo workspace's five sites are designed by hand in the Besigner
// (AGL-4166): pages, layouts, theme and routes. The seeds that first filled
// them must never write over that work again.
//
// - `seed-demo-host.mjs` deletes every `seed-*` page and component and
//   rewrites the home page, theme and name, so it refuses these hosts.
// - `seed-review-org.mjs` still refreshes their DATA, but it leaves out
//   every page document (email designs excepted), the host's `screens`
//   routing map, the sibling sites' re-creation and the prune of pages.

/** Hosts whose pages, layouts, theme and routing are designed by hand. */
export const HAND_BUILT_DEMO_HOSTS = Object.freeze([
  'review-bakery',
  'review-cantina',
  'review-ironleaf',
  'review-juniper-cafe',
  'review-juniper-catering',
])

/** Whether `hostId` is one of the hand-built demo sites. */
export const isHandBuiltDemoHost = (hostId) => HAND_BUILT_DEMO_HOSTS.includes(String(hostId ?? ''))

const HOST_PATH = /^hosts\/([^/]+)$/
const SCREEN_PATH = /^hosts\/([^/]+)\/screens\/([^/]+)(\/.*)?$/

/**
 * A seed plan without the documents that would overwrite a hand-built
 * site's pages: page screens and their versions, and the `screens` routing
 * map on the host document. Designed emails are screens too (`kind:
 * 'email'`), carry no route and are kept, versions included.
 *
 * @param {ReadonlyArray<{ path: string, data?: Record<string, unknown> }>} docs
 * @returns {{ docs: Array<{ path: string, data?: Record<string, unknown> }>, dropped: string[] }}
 */
export function withoutHandBuiltPages(docs) {
  const emailScreens = new Set()
  for (const doc of docs) {
    const match = SCREEN_PATH.exec(doc.path)
    if (match && !match[3] && doc.data?.kind === 'email') emailScreens.add(`${match[1]}/${match[2]}`)
  }
  const kept = []
  const dropped = []
  for (const doc of docs) {
    const screen = SCREEN_PATH.exec(doc.path)
    if (screen && isHandBuiltDemoHost(screen[1]) && !emailScreens.has(`${screen[1]}/${screen[2]}`)) {
      dropped.push(doc.path)
      continue
    }
    const host = HOST_PATH.exec(doc.path)
    if (host && isHandBuiltDemoHost(host[1]) && doc.data && 'screens' in doc.data) {
      const rest = Object.fromEntries(Object.entries(doc.data).filter(([field]) => field !== 'screens'))
      dropped.push(`${doc.path}#screens`)
      if (Object.keys(rest).length) kept.push({ ...doc, data: rest })
      continue
    }
    kept.push(doc)
  }
  return { docs: kept, dropped }
}

/** Whether the seed's prune may delete documents in `collectionPath`. */
export const prunesHandBuiltPages = (collectionPath) => {
  const match = /^hosts\/([^/]+)\/(screens|layouts|components)(\/|$)/.exec(String(collectionPath))
  return Boolean(match && isHandBuiltDemoHost(match[1]))
}
