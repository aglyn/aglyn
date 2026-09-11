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
 * The media CDN's scope grammar and the verdict it reaches under it
 * (AGL-1043), as pure functions.
 *
 * `serveMediaCdn` enforces them and re-exports them, so the handler remains
 * the authority. They live here, in a module with no server dependency,
 * because two other readers have to reach the verdict the handler reaches
 * before it serves a film:
 *
 * - the tenant composition, which lays a placed film's current facts over its
 *   node only when the page's own URL would be served
 *   (`libs/tenant/runtime/src/lib/get-video-asset-facts.ts`);
 * - the besigner canvas, which reads the same document in the browser so an
 *   author is shown what a visitor gets (`video-asset-facts.ts`).
 *
 * A copy in either would be a second rule, free to disagree with the one that
 * refuses the bytes.
 *
 * Out of every barrel: the handler, the composition and the editor import it
 * by path, and nothing here has a reason to reach a published page's bundle.
 */

import { isOrgWideScope, visibleToHost } from './scope-tokens'

/** One CDN path segment: a host id, an org id, a media id or a content hash. */
export const MEDIA_CDN_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The parsed CDN scope segment (AGL-1043). Shapes:
 *
 * - `{hostId}` — that host's own library
 * - `org:{orgId}` — the org library, ORG-WIDE assets only
 * - `org:{orgId}:{hostId}` — an org asset in one site's context
 *
 * The host is in the URL rather than sniffed from the `Host` header on
 * purpose. A header is the requester's CHOICE: anyone holding a restricted
 * asset's id could fetch it through a domain that IS permitted and get the
 * bytes, so header-based enforcement stops accidents while looking like a
 * boundary. Here the decision is a pure function of (URL, doc), and since
 * the cache key IS the URL, one host's answer can never reach another.
 */
export interface MediaCdnScope {
  isOrg: boolean
  scopeId: string
  /** Only on the `org:{orgId}:{hostId}` form. */
  contextHostId?: string
}

export function parseMediaCdnScope(
  scopeSegment: string,
): MediaCdnScope | null {
  if (!scopeSegment.startsWith('org:')) {
    return MEDIA_CDN_SEGMENT.test(scopeSegment)
      ? { isOrg: false, scopeId: scopeSegment }
      : null
  }
  const parts = scopeSegment.slice('org:'.length).split(':')
  if (parts.length > 2) return null
  const [scopeId, contextHostId] = parts
  if (!MEDIA_CDN_SEGMENT.test(scopeId ?? '')) return null
  if (contextHostId !== undefined && !MEDIA_CDN_SEGMENT.test(contextHostId)) {
    return null
  }
  return {
    isOrg: true,
    scopeId,
    ...(contextHostId ? { contextHostId } : {}),
  }
}

/**
 * The three ways an org asset can be refused under a CDN URL.
 *
 * They are one 404 on the wire — whether a restricted asset exists is not
 * something an anonymous caller has standing to learn — and three different
 * faults to whoever is looking at the broken page:
 *
 * - `restricted` — the asset carries a scope and this URL is not in it. The
 *   URL is what is wrong: a restricted asset has to be requested through the
 *   form that names the site (`hostQualifiedCdnPath`), and the same asset
 *   serves normally from the site it is shared with.
 * - `unscoped` — no `visibleTo` at all, so the asset is undeliverable under
 *   EVERY URL form there is. The document is what is wrong, and it means a
 *   creation path wrote it without a scope: `newResourceScopeFields` is what
 *   stops that at compile time, and the scope backfill is what repairs the
 *   documents already written (`docs/SCOPE_DRIFT.md`).
 * - `no-sites` — a stored empty array: somebody chose nobody. Equally
 *   undeliverable, and NOT repairable by the backfill, which leaves an empty
 *   array alone rather than widening a resource nobody asked to widen — so
 *   this one needs a person either way.
 */
export type MediaCdnScopeRefusal = 'restricted' | 'unscoped' | 'no-sites'

/** Why the asset is refused under this URL; `null` when it is not. */
export function mediaCdnScopeRefusal(
  scope: MediaCdnScope,
  visibleTo: unknown,
): MediaCdnScopeRefusal | null {
  // Host-library assets are private by construction and carry no
  // `visibleTo`, so only the org branch is scoped at all.
  if (!scope.isOrg) return null
  if (!Array.isArray(visibleTo)) return 'unscoped'
  if (!visibleTo.length) return 'no-sites'
  const scoped = visibleTo as string[]
  const allowed = scope.contextHostId
    ? visibleToHost(scoped, scope.contextHostId)
    : isOrgWideScope(scoped)
  return allowed ? null : 'restricted'
}

/** Whether the asset may be served under this URL. */
export function mediaCdnAllows(
  scope: MediaCdnScope,
  visibleTo: unknown,
): boolean {
  return mediaCdnScopeRefusal(scope, visibleTo) === null
}
