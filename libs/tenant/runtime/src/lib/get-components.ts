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
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Part of the per-host compose bundle every page render pays (AGL-1302):
 * up to 200 docs per render before caching. Component publishes announce
 * themselves through the console revalidate route, which busts
 * `tenant-data:{hostId}`; 60s is the backstop for direct writes.
 */
const COMPONENTS_TTL_SECONDS = 60

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
        data.definitions[docSnapshot.id] = {
          rootId: value.rootId,
          nodes: value.nodes as Aglyn.ReusableComponentTree['nodes'],
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
