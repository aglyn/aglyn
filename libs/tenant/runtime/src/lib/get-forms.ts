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
 * Cached under the same key and TTL the components read uses (AGL-1302), and
 * busted by the same `tenant-data:{hostId}` tag.
 *
 * ⚠️ Unlike a component publish, a FORM publish does not announce itself yet.
 * `/api/screens/revalidate` takes a `screenId`, `layoutId`, `componentId` or
 * `redirectPath` and drops the pages that render them; it has no `formId`
 * branch, and neither publish path — the besigner's write nor
 * `/api/hosts/forms/promote` — calls it. So a republished form reaches live
 * pages when this TTL lapses rather than within the minute, and the besigner's
 * "the live sites now serve this design" is that much ahead of itself.
 *
 * What that needs is the form half of `screenIdsUsingComponentDeep`: a placed
 * form is reachable from a screen, a layout or a component, so the scan is the
 * same walk with a different first-level predicate.
 */
const FORMS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * How many form documents ONE RENDER reads.
 *
 * Deliberately below `Aglyn.FORMS_MAX_PER_HOST`, which bounds the catalog
 * listings, and equal to the components bound this read is otherwise a copy
 * of: a catalog is read when a person opens a page in the console, while this
 * is on the hot path of every published page that places a form. The two
 * numbers answer different questions and must not be collapsed into one.
 *
 * Unordered, like the components query, so past this bound the page read is an
 * arbitrary subset rather than the first N by any rule. That is a backstop,
 * not a plan: a site with more forms than this needs the read narrowed to the
 * ids the page actually places, not a larger constant.
 */
const FORMS_PER_RENDER = 200

/**
 * The host's form entities keyed by id, in the shape the placed-form graft
 * consumes (`Aglyn.placedFormPlacement`).
 *
 * Only forms with a PUBLISHED design are returned. A form that has never been
 * published carries no `rootId`/`nodes` at all, and one whose root is missing
 * from its own nodes has no tree to graft — both are "this entity contributes
 * nothing", and the graft leaves such a placement rendering the fields drawn on
 * the page itself. Filtering here rather than in the graft keeps the payload
 * to what can actually be rendered.
 *
 * An ARCHIVED form is deliberately still returned. Archiving retires an entity
 * from the catalog the console lists; it is not a tombstone and it says nothing
 * about publication. A page that still places the form keeps rendering it,
 * because the alternative is a live page quietly losing its form the moment
 * someone tidies up a list.
 *
 * Fail-open like every other compose read: on error an empty map, so every
 * placement falls back to its own inline content and the page still serves.
 */
async function readForms(hostId: Aglyn.HostUid) {
  const data = {
    forms: {} as Record<string, Aglyn.PlacedFormDesign>,
    error: null as unknown,
  }
  const firestore = firebaseAdmin.app().firestore()

  await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('forms')
    .limit(FORMS_PER_RENDER)
    .get()
    .then((res) => {
      for (const docSnapshot of res.docs) {
        const value = docSnapshot.data() as Aglyn.FormDocument
        if (!value?.nodes || !value?.rootId) continue
        // BOTH stored forms, on the hot path (AGL-1151). A form's published
        // tree is written by the same promotion path a component's is, so it
        // is msgpack for anything published since compression landed and a
        // plain map for anything older. Skipping the decode would hand the
        // graft a `Buffer`, which has no `rootId` entry — every placement
        // would render an empty form, and the result would be stored under the
        // render cache for the rest of its TTL.
        const nodes = Aglyn.decodeStoredNodes<
          NonNullable<Aglyn.FormDocument['nodes']>
        >(value.nodes)
        // An undecodable design is skipped rather than grafted empty: the
        // placement then keeps its own fields, and `decodeStoredNodes` logs
        // why the entity did not resolve.
        if (!nodes?.[value.rootId]) continue
        data.forms[docSnapshot.id] = { rootId: value.rootId, nodes }
      }
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}

export async function getForms(options: { hostId: Aglyn.HostUid }) {
  const { hostId } = options
  try {
    return await withRenderCache({
      key: ['tenant-forms', hostId as string],
      revalidate: FORMS_TTL_SECONDS,
      tags: [tenantDataTag(hostId as string)],
      read: () => readForms(hostId),
      // A failed read keeps its fail-open empty map per-request only.
      store: (value) => !value.error,
    })
  } catch (error) {
    console.error(error)
    return readForms(hostId)
  }
}

export default getForms
