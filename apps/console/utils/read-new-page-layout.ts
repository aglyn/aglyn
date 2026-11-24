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
  homeScreenIdOf,
  newPageLayoutId,
  screenLayoutBinding,
} from '@aglyn/aglyn/app-utils/new-page-layout'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  type Firestore,
} from 'firebase/firestore'

/** A layout the Create new page drawer offers. */
export interface NewPageLayoutOption {
  id: string
  displayName: string
}

export interface NewPageLayoutReading {
  /** The site's live layouts, by name. */
  layouts: NewPageLayoutOption[]
  /** The layout a new page starts with (`newPageLayoutId`), or none. */
  layoutId: string | undefined
}

/**
 * The reads behind a new page's default layout (AGL-4241), taken ONCE when
 * the Create new page drawer opens rather than as standing listeners on the
 * Pages list: the host (its Built-in page layout setting and routing map),
 * the site's layouts, and the home page and its live version. The choice
 * itself is `newPageLayoutId`'s, in `@aglyn/aglyn`, the same rule the public
 * API's create applies.
 *
 * Fails open to "no layout": a read that throws must not stop a page being
 * created, only cost it the default.
 */
export async function readNewPageLayout(
  firestore: Firestore,
  hostId: string,
): Promise<NewPageLayoutReading> {
  try {
    const hostRef = doc(firestore, 'hosts', hostId)
    const [host, layoutDocs] = await Promise.all([
      getDoc(hostRef),
      // 50, the bound the besigner's layout picker and the Built-in page
      // layout card take; single digits on every real site.
      getDocs(query(collection(firestore, 'hosts', hostId, 'layouts'), limit(50))),
    ])
    const live = layoutDocs.docs.filter((layout) => !layout.get('deletedAt'))
    const layouts = live
      .map((layout) => ({
        id: layout.id,
        displayName: String(layout.get('displayName') ?? '') || layout.id,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    let homeLayoutId: string | null = null
    const homeId = homeScreenIdOf(host.get('screens'))
    if (homeId) {
      const home = await getDoc(doc(hostRef, 'screens', homeId))
      const versionId = home.get('versionId')
      const version =
        typeof versionId === 'string' && versionId
          ? await getDoc(doc(hostRef, 'screens', homeId, 'versions', versionId))
              .then((snapshot) => snapshot.data())
              .catch(() => undefined)
          : undefined
      homeLayoutId = screenLayoutBinding(home.data(), version)
    }

    return {
      layouts,
      layoutId: newPageLayoutId({
        designatedLayoutId: host.get('builtInPageLayoutId'),
        homeLayoutId,
        layouts: layouts.map((layout) => ({ id: layout.id })),
      }),
    }
  } catch (error) {
    console.error('new page layout lookup failed', error)
    return { layouts: [], layoutId: undefined }
  }
}

export default readNewPageLayout
