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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Part of the per-host compose bundle every page render pays (AGL-1302):
 * up to 200 docs per render before caching. Component publishes announce
 * themselves through the console revalidate route, which busts
 * `tenant-data:{hostId}`; The TTL is only the backstop for writes that never announce themselves — see PUBLISHED_SITE_DATA_TTL_SECONDS.
 */
const COMPONENTS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * Fetches the host's reusable component definitions keyed by id, in the
 * shape `composeReusableComponentNodes` consumes. Fail-open: on error an
 * empty map is returned (instances render as empty wrappers, the page still
 * serves).
 */
async function readComponents(hostId: Aglyn.HostUid) {
  const data = {
    definitions: {} as Record<string, Aglyn.ReusableComponentTree>,
    error: null as unknown,
  }
  const firestore = firebaseAdmin.app().firestore()

  await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('components')
    .limit(200)
    .get()
    .then((res) => {
      for (const docSnapshot of res.docs) {
        const value = docSnapshot.data() as Aglyn.AglynHostComponent
        if (value?.deletedAt || !value?.nodes || !value?.rootId) continue
        /*
         * BOTH STORED FORMS, on the hot path (AGL-1151).
         *
         * A published definition is msgpack for anything promoted since
         * components were compressed and a plain map for everything older,
         * and nothing migrates them — `decodeStoredNodes` returns a map
         * unchanged, so one call serves both forever.
         *
         * It has to be here rather than at the caller because the failure is
         * silent and cached: `composeReusableComponentNodes` looks up
         * `nodes[rootId]` on the value below, finds nothing in a `Buffer`,
         * and grafts an empty wrapper — so every instance of the component
         * disappears from every page of the site, and the result is stored
         * under the render cache for the rest of its TTL.
         *
         * The decode costs no new dependency: this module already imports
         * `@aglyn/aglyn/server`, and the tenant's published-page CLIENT
         * bundle never reaches this file.
         */
        const nodes = Aglyn.decodeStoredNodes<
          Aglyn.ReusableComponentTree['nodes']
        >(value.nodes)
        // An undecodable definition is skipped rather than grafted empty. It
        // is the same outcome for the page either way, but `decodeStoredNodes`
        // logs the reason, and a definition that silently became `{}` would
        // not say why the component vanished.
        if (!nodes) continue
        data.definitions[docSnapshot.id] = {
          rootId: value.rootId,
          nodes,
          // Declared props (AGL-1247): without these the graft leaves every
          // `{{prop.*}}` token unresolved on the published page.
          ...(value.props?.length && { props: value.props }),
        }
      }
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}

export async function getComponents(options: { hostId: Aglyn.HostUid }) {
  const { hostId } = options
  try {
    return await withRenderCache({
      key: ['tenant-components', hostId as string],
      revalidate: COMPONENTS_TTL_SECONDS,
      tags: [tenantDataTag(hostId as string)],
      read: () => readComponents(hostId),
      // A failed read keeps its fail-open empty map per-request only.
      store: (value) => !value.error,
    })
  } catch (error) {
    console.error(error)
    return readComponents(hostId)
  }
}

export default getComponents
