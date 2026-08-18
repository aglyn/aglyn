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

import { checkEntitlement } from '@aglyn/aglyn/server'
import { type HostRedirect, matchRedirect, normalizeRedirectSource } from '../model/redirects'
import {
  analyticsDayExpiresAt,
  firebaseAdmin,
  getOrgForHost,
} from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * One of three per-render reads AGL-1302 left uncached (AGL-1440).
 *
 * This query runs before route resolution on every render of every path, and
 * Firestore bills a minimum of one read for a query returning nothing — so a
 * site that has never written a rule still paid for asking, forever. The rules
 * are pure host-scoped published config: `revalidateTag(tenant-data:{hostId})`
 * busts them on publish, and 60s is the backstop for a manager edit that does
 * not publish.
 *
 * Worst stale read: a rule edited in the console takes up to 60s longer to
 * start (or stop) firing than the ≤30s this file already documents. The paid
 * gate and the hit counters stay OUTSIDE the cache — see below.
 */
const REDIRECT_RULES_TTL_SECONDS = 60

/** One enabled rule, flattened to the plain data the matcher reads. */
type StoredRedirect = HostRedirect & { $id: string }

async function readEnabledRules(hostId: string): Promise<StoredRedirect[]> {
  const rules = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('redirects')
    .where('enabled', '==', true)
    .limit(100)
    .get()
  return rules.docs.map((doc) => ({
    ...(doc.data() as HostRedirect),
    $id: doc.id,
  }))
}

export interface ResolvedRedirect {
  destination: string
  statusCode: 301 | 302 | 307 | 308
}

/** Firestore map keys: strip characters that complicate field paths. */
const idKey = (value: string) => value.replace(/[.$#[\]/]/g, '_')

/**
 * Redirect enforcement (AGL-155), Option A per the issue: rules apply in
 * `getStaticProps` before route resolution, with a low revalidate on the
 * redirect response. Trade-offs, documented: rule edits take effect on
 * the next revalidation (≤30s), and hit counts are SAMPLED — cached
 * redirect responses never re-execute code, so each count represents "at
 * least one hit in a revalidation window", not per-request accuracy.
 * Middleware-accurate counting stays open as a later upgrade.
 *
 * Paid gating: when the host has enabled rules but the owning org's
 * plan lacks the `redirects` flag (downgrade with leftover rules), the
 * rules stop firing — the org read only happens when rules exist.
 * Loop guard: self-redirects never execute even if stored (console
 * validation and this floor can disagree; both refuse).
 */
export async function resolveRedirect(
  host: { $id: string },
  requestPath: string,
): Promise<ResolvedRedirect | null> {
  try {
    const source = normalizeRedirectSource(
      requestPath === '/' || requestPath === '' ? '/' : `/${requestPath}`,
    )
    if (!source) return null
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(host.$id)
    // Cached per host, never per path (AGL-1440): the rule set is the same for
    // every URL on the site, so a path in the key would mint one entry per
    // route and cache nothing.
    const ruleList = await withRenderCache({
      key: ['redirect-rules', host.$id],
      revalidate: REDIRECT_RULES_TTL_SECONDS,
      tags: [tenantDataTag(host.$id)],
      read: () => readEnabledRules(host.$id),
    })
    if (!ruleList.length) return null

    // v2 matcher (AGL-375): exact/prefix/regex in priority order, capture
    // substitution, self-redirect floor. Run per request — it depends on the
    // path, which the cache key deliberately does not carry.
    const matched = matchRedirect(ruleList, source)
    if (!matched) return null
    const matchId = ruleList[matched.index]?.$id
    if (!matchId) return null

    // Paid gate — only paid orgs' rules fire (dark-launch orgs pass).
    //
    // Deliberately OUTSIDE the cache above. A cached entitlement would keep a
    // downgraded org's leftover rules redirecting for the life of the entry,
    // which on this code path means taking pages off the internet on the
    // strength of a plan the org no longer has.
    {
      const org = (await getOrgForHost(host.$id))?.org
      if (!checkEntitlement(org as any, 'redirects')) {
        return null
      }
    }

    // Sampled hit recording (fire-and-forget): day-doc counter + recency
    // stamp for the manager (AGL-157). Also outside the cache — a cached
    // function would stop counting altogether rather than counting less often.
    // The rule's ref is rebuilt from its id, because a `DocumentReference`
    // cannot survive the cache's JSON round trip.
    const day = new Date().toISOString().slice(0, 10)
    void hostRef
      .collection('analytics')
      .doc(day)
      .set(
        {
          redirects: { [idKey(matchId)]: FieldValue.increment(1) },
          // Retention (AGL-1844): every writer of a day doc stamps the
          // day-anchored expiry the TTL policy sweeps on.
          expiresAt: analyticsDayExpiresAt(day),
        },
        { merge: true },
      )
      .catch(() => undefined)
    void hostRef
      .collection('redirects')
      .doc(matchId)
      .set({ lastHitAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => undefined)

    return { destination: matched.destination, statusCode: matched.statusCode }
  } catch (error) {
    console.error('resolveRedirect failed', host.$id, requestPath, error)
    return null
  }
}

export default resolveRedirect
