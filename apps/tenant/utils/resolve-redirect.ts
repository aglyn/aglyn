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
  checkEntitlement,
  type HostRedirect,
  isSelfRedirect,
  normalizeRedirectSource,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

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
 * Paid gating: when the host has enabled rules but the owning tenant's
 * plan lacks the `redirects` flag (downgrade with leftover rules), the
 * rules stop firing — the tenant read only happens when rules exist.
 * Loop guard: self-redirects never execute even if stored (console
 * validation and this floor can disagree; both refuse).
 */
export async function resolveRedirect(
  host: { $id: string; tenantId?: string },
  requestPath: string,
): Promise<ResolvedRedirect | null> {
  try {
    const source = normalizeRedirectSource(
      requestPath === '/' || requestPath === '' ? '/' : `/${requestPath}`,
    )
    if (!source) return null
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(host.$id)
    const rules = await hostRef
      .collection('redirects')
      .where('enabled', '==', true)
      .limit(100)
      .get()
    if (rules.empty) return null

    const match = rules.docs.find(
      (doc) =>
        !doc.get('deletedAt') && (doc.data() as HostRedirect).source === source,
    )
    if (!match) return null
    const rule = match.data() as HostRedirect
    if (!rule.destination || isSelfRedirect(rule)) return null

    // Paid gate — only paid tenants' rules fire (dark-launch tenants pass).
    if (host.tenantId) {
      const tenantSnapshot = await firestore
        .collection('tenants')
        .doc(host.tenantId)
        .get()
      const tenant = tenantSnapshot.exists ? tenantSnapshot.data() : undefined
      if (tenant?.['plan'] && !checkEntitlement(tenant as any, 'redirects')) {
        return null
      }
    }

    // Sampled hit recording (fire-and-forget): day-doc counter + recency
    // stamp for the manager (AGL-157).
    const day = new Date().toISOString().slice(0, 10)
    void hostRef
      .collection('analytics')
      .doc(day)
      .set(
        { redirects: { [idKey(match.id)]: FieldValue.increment(1) } },
        { merge: true },
      )
      .catch(() => undefined)
    void match.ref
      .set({ lastHitAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => undefined)

    const statusCode = ([301, 302, 307, 308] as const).includes(
      rule.statusCode as any,
    )
      ? rule.statusCode
      : 302
    return { destination: rule.destination, statusCode }
  } catch (error) {
    console.error('resolveRedirect failed', host.$id, requestPath, error)
    return null
  }
}

export default resolveRedirect
