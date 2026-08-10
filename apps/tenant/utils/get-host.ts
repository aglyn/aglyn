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
 * The alias this resolver can actually query, from whatever spelling a caller
 * wrote (AGL-1385).
 *
 * `hosts` is queryable by exactly two fields — `subdomain` and `cname` — and
 * the branch between them is the `cname--` sentinel the MIDDLEWARE stamps.
 * That sentinel is an internal encoding of an edge-runtime limitation, and
 * until now it was also the only spelling a `?host=` caller could use:
 * `/api/collections-rss` documents its parameter as "your site's subdomain (or
 * custom domain)" and returned 404 for every custom domain, because
 * `aglyn.com` was matched against `subdomain` and nothing else was ever tried.
 * MEASURED against production before the fix: `?host=aglyn.com`,
 * `?host=marketing` and `?host=marketing.aglyn.app` all 404'd while
 * `?host=cname--aglyn.com` returned the feed.
 *
 * So map the three PUBLIC spellings onto the two internal ones:
 *
 *  - `{sub}.aglyn.app` → `{sub}`, the platform origin a site advertises.
 *  - any other dotted name → `cname--{name}`, a custom domain. The dot is an
 *    unambiguous discriminator: `SUBDOMAIN_PATTERN` admits only
 *    `[a-z0-9-]`, so a subdomain can never contain one.
 *  - everything else — a bare subdomain, an already-stamped `cname--…`, a
 *    host document id — is returned unchanged.
 *
 * That last clause is what makes this safe to apply to every caller rather
 * than to the one broken route: it is the IDENTITY on every form the
 * middleware produces, so no render, rewrite or revalidation changes shape.
 * Applying it here rather than in a route also keeps the two-level cache
 * honest — the key and `tenantHostAliasTag` are both derived from the result,
 * so two spellings of one site share an entry instead of each holding their
 * own, and the alias tag `/api/revalidate` busts (always the subdomain) keeps
 * matching what a `{sub}.aglyn.app` request stored.
 */
export function normalizeHostAlias(host: string | null | undefined): string {
  const trimmed = String(host ?? '')
    .trim()
    .toLowerCase()
  if (!trimmed || trimmed.startsWith(CNAME_HOST_PREFIX)) return trimmed
  // A `Host:`-derived value can carry a port or a fully-qualified trailing
  // dot; a host record's `cname` never does.
  const bare = trimmed.split(':')[0].replace(/\.+$/, '')
  if (!bare.includes('.')) return bare
  const apexSuffix = `.${Aglyn.TENANT_APEX}`
  if (bare.endsWith(apexSuffix)) {
    const subdomain = bare.slice(0, -apexSuffix.length)
    // A deeper name under the apex is not a subdomain we could look up, so it
    // falls through to the cname branch rather than resolving its last label.
    if (subdomain && !subdomain.includes('.')) return subdomain
  }
  return `${CNAME_HOST_PREFIX}${bare}`
}

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
  // Normalized BEFORE the cache key and the tag, never after: see
  // `normalizeHostAlias` (AGL-1385).
  const host = normalizeHostAlias(options.host as string) as Aglyn.HostUid
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
