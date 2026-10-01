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
  leavingDestination,
  leavingNoticeHref,
} from '@aglyn/aglyn/app-utils/leaving-notice'
import {
  leavingNoticeConfig,
  leavingNoticeEndsAt,
  leavingNoticeHosts,
  signLeavingDestination,
} from '@aglyn/tenant-data-admin/server/leaving-notice'
import type { LoadResult } from '../app/[host]/[scheme]/[[...slug]]/types'

/** The site and workspace a page render loaded, as the loader records them. */
export interface LeavingNoticeFacts {
  host?: ({ $id?: string; subdomain?: string | null; cname?: string | null } & object) | null
  org?: unknown
}

/**
 * A page render's result, with the leaving notice applied when the site is in
 * its window (AGL-3452) — the one place every exit of the loader passes.
 *
 * - **A page** gains `leavingNotice`: the hosts that are not "leaving" and a
 *   signature for every outside address the page renders from. Its links
 *   resolve to the notice through `useLinkTarget`, and the rest through the
 *   click interceptor.
 * - **A redirect** to another domain — a redirect rule, a plugin resolver's
 *   answer — becomes a redirect to the notice, signed. It is downgraded to a
 *   307 on the way: a browser keeps a permanent redirect forever, and this one
 *   must stop the day the window closes.
 *
 * Anything else, and anything outside the window, passes through untouched.
 */
export function applyLeavingNotice(
  result: LoadResult,
  facts: LeavingNoticeFacts,
  nowMs: number = Date.now(),
): LoadResult {
  const site = facts.host
  const hostId = site?.$id
  if (!site || !hostId) return result

  if ('redirect' in result) {
    if (leavingNoticeEndsAt(facts.org, nowMs) === null) return result
    const destination = leavingDestination(
      result.redirect.destination,
      leavingNoticeHosts(site),
    )
    if (!destination) return result
    let signature: string
    try {
      signature = signLeavingDestination(hostId, destination)
    } catch (error) {
      // No signing secret: the notice is off on this deployment (see
      // `leavingNoticeConfig`), so the redirect stands as authored.
      console.error('[leaving-notice] redirect left unsigned', error)
      return result
    }
    return {
      ...result,
      redirect: {
        destination: leavingNoticeHref(destination, signature),
        statusCode: 307,
      },
    }
  }

  if ('props' in result) {
    const config = leavingNoticeConfig({
      hostId,
      site,
      org: facts.org,
      content: result.props,
      nowMs,
    })
    if (!config) return result
    return { ...result, props: { ...result.props, leavingNotice: config } }
  }

  return result
}
