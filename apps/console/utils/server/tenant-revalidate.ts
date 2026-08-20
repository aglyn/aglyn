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
 * The one place the console asks a tenant deployment to drop cached pages
 * (AGL-2462).
 *
 * Extracted rather than copied. `POST /v1/sites/{siteId}/publish` needs the
 * exact request `/api/screens/revalidate` already sends — same secret header,
 * same `{ host, hostId, paths }` body, same timeout — and a second hand-rolled
 * copy is how the two would come to disagree about the field that matters.
 * `hostId` is that field: it is what busts `tenant-data:{hostId}`, and a caller
 * that forgets it gets pages that faithfully regenerate from the cached
 * datasets, routing map and version pointers the publish just replaced
 * (AGL-1302). Making it a required parameter here means no caller can omit it
 * by accident.
 *
 * The tenant treats this secret as a cache hint rather than an authorization
 * boundary — its own docblock says so, and bounds what the call can do to one
 * host's cached HTML. Both callers therefore do the real authorization check
 * BEFORE reaching here: the console route with `mayRevalidate` (host role
 * `admin`/`editor`), the API with the `sites:publish` scope plus an org-owns-
 * host check.
 */

/**
 * The apex comes from `TENANT_APEX`, never re-derived here (AGL-2195).
 *
 * `TENANT_APEX` is the one reader of `NEXT_PUBLIC_TENANT_DOMAIN`. Reading that
 * variable again here, with our own apex as the literal default, is how the
 * four hand-rolled copies the ratchet exists to prevent got in — and the
 * extraction this module IS carried one across from the console route it
 * replaced. A self-hoster who sets the variable must not end up with a console
 * that posts its revalidation at OUR apex: that is a cache-drop which never
 * lands on their pages, and an unsolicited request to a host they do not own.
 */
import { TENANT_APEX } from '@aglyn/aglyn/server'

/** A publish should feel instant; a slow tenant must not hold the caller. */
const TIMEOUT_MS = 5000

export interface TenantRevalidateResult {
  /** Cache keys the tenant reported dropping. */
  revalidated: string[]
  /**
   * Why the drop is not a plain success, or `'ok'`.
   *
   * `'not-configured'` when `REVALIDATE_SECRET` is unset — said out loud
   * rather than reported as a fast publish that is still slow, which is the
   * confusing half of the original bug (AGL-1150).
   */
  reason: 'ok' | 'not-configured' | `tenant-${number}` | 'error'
  /** The tenant's own `MAX_PATHS` overflow (AGL-1161), 0 when it took them all. */
  pathsDropped: number
}

/**
 * Ask the tenant deployment serving `subdomain` to drop `paths` and bust the
 * host's document-cache tag.
 *
 * Never throws and never returns a failed promise: a cache hint that could not
 * be sent must not make a completed publish look failed, and the ISR window is
 * still underneath it as the backstop.
 */
export async function postTenantRevalidate(options: {
  /** The site's subdomain — the tenant keys its cache on it, not on `hostId`. */
  subdomain: string
  /** Required: without it no `tenant-data:{hostId}` tag is busted. */
  hostId: string
  /** Site-absolute paths (`/`, `/menu`). The tenant caps them at 250. */
  paths: string[]
}): Promise<TenantRevalidateResult> {
  const { subdomain, hostId, paths } = options
  const secret = process.env['REVALIDATE_SECRET']
  if (!secret) return { revalidated: [], reason: 'not-configured', pathsDropped: 0 }

  try {
    const response = await fetch(`https://${subdomain}.${TENANT_APEX}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ host: subdomain, hostId, paths }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const result = (await response.json().catch(() => null)) as {
      revalidated?: unknown
      truncated?: unknown
    } | null
    if (!response.ok) {
      console.error('[tenant-revalidate] tenant refused', response.status, result)
      return {
        revalidated: [],
        reason: `tenant-${response.status}` as TenantRevalidateResult['reason'],
        pathsDropped: 0,
      }
    }
    return {
      revalidated: Array.isArray(result?.revalidated) ? (result.revalidated as string[]) : [],
      reason: 'ok',
      pathsDropped: Number(result?.truncated ?? 0) || 0,
    }
  } catch (error) {
    console.error('[tenant-revalidate] request failed', error)
    return { revalidated: [], reason: 'error', pathsDropped: 0 }
  }
}

export default postTenantRevalidate
