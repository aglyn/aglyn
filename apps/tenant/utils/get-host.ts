/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import { firebaseAdmin, hostConverter } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  tenantHostAliasTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'

/**
 * Custom-domain sentinel (AGL-166): the middleware rewrites unrecognized
 * hostnames to `cname--{hostname}` because the edge runtime can't query
 * Firestore; this resolver maps them back via `host.cname`.
 */
export const CNAME_HOST_PREFIX = 'cname--'

/**
 * Every render and every SEO route starts with this read, so it is the single
 * most amplified read in the tenant runtime (AGL-1302). Cached in TWO levels
 * rather than one, because the two halves invalidate for different reasons:
 *
 * 1. alias → hostId. A pure naming fact that publishes never touch — it only
 *    changes on subdomain rename or custom-domain (dis)connect. Keyed by the
 *    REQUESTED alias, so the subdomain and `cname--` forms each get an entry.
 *
 * 2. hostId → host doc. This is the doc a publish rewrites (the `screens`
 *    routing map), so it carries `tenantDataTag(hostId)` and the tenant
 *    `/api/revalidate` route busts it the moment a publish lands. One level
 *    would have made that impossible: the tag has to name the hostId, and a
 *    single alias-keyed cache cannot know its hostId before the read it is
 *    supposed to avoid. The split is also what lets a custom domain and the
 *    `.aglyn.app` alias share one doc entry instead of caching it twice.
 *
 * A miss costs one extra read over the old single query (the alias query is
 * now a projection, then the doc get); a hit costs zero. Negative results are
 * never stored — an unknown host keeps exactly today's behavior.
 */
const HOST_ALIAS_TTL_SECONDS = 60
const HOST_DOC_TTL_SECONDS = 60

async function queryHostIdByAlias(host: string): Promise<string | null> {
  const firestore = firebaseAdmin.app().firestore()
  const byCname = host.startsWith(CNAME_HOST_PREFIX)
  const query = byCname
    ? firestore
        .collection('hosts')
        .where('cname', '==', host.slice(CNAME_HOST_PREFIX.length))
    : firestore.collection('hosts').where('subdomain', '==', host)

  // `select()` with no fields = key-only projection; only the id is needed.
  const res = await query.select().limit(2).get()
  // Connect-time uniqueness should prevent this; log if it slips.
  if (byCname && res.size > 1) {
    console.error('Ambiguous cname resolution', host)
  }
  return res.size ? res.docs[0].id : null
}

async function readHostDoc(hostId: string): Promise<Aglyn.AglynHost | null> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .withConverter(hostConverter)
    .doc(hostId)
    .get()
  return snapshot.exists ? (snapshot.data() as Aglyn.AglynHost) : null
}

export async function getHost(options: { host: Aglyn.HostUid }) {
  const { host } = options
  const data = {
    host: undefined as Aglyn.AglynHost,
    nextPageToken: '',
    error: null,
  }

  try {
    const hostId = await withRenderCache({
      key: ['tenant-host-alias', host],
      revalidate: HOST_ALIAS_TTL_SECONDS,
      tags: [tenantHostAliasTag(host)],
      read: () => queryHostIdByAlias(host),
      store: (value) => value !== null,
    })
    if (!hostId) return data

    const doc = await withRenderCache({
      key: ['tenant-host-doc', hostId],
      revalidate: HOST_DOC_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read: () => readHostDoc(hostId),
      store: (value) => value !== null,
    })
    if (doc) data.host = doc
  } catch (error) {
    console.error(error)
    data.error = error
  }

  return data
}

export default getHost
