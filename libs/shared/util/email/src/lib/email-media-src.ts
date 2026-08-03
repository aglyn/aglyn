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
 * Absolute image URLs for email (AGL-1224).
 *
 * ## Why this is a mirror rather than an import
 *
 * The authority is `resolveMediaSrc` / `hostPublicOrigin` in
 * `libs/aglyn/src/lib/app-utils/` and this file must not diverge from it. It
 * cannot import it: `shared-util-email` is tagged `scope:shared`, and the
 * module-boundary rule makes shared libs LEAVES — `scope:shared` may depend
 * only on `scope:shared`, while `scope:aglyn` and `aglyn:framework` may depend
 * on shared. The arrow points one way on purpose, so that every send site can
 * import this renderer without dragging the framework in behind it.
 *
 * The same file already solves the same problem the same way: see
 * `EMAIL_NODE_ROOT_ID` in `./email-render`, a copy of the besigner's
 * `CANVAS_ROOT_ELEMENT_ID` held here with a drift guard in the console specs.
 * `tools/scripts/backfill-media-refs.mjs` mirrors this same grammar for the
 * same reason. So: copy, name it a copy, and PIN it —
 * `apps/console/specs/email-media-src-drift.spec.ts` runs both implementations
 * over a shared table of inputs and fails if they ever disagree. That spec
 * lives in the console because the console is allowed to import both.
 *
 * ## What it does
 *
 * A picked image is stored as `media:{scope}/{mediaId}` and resolves to the
 * SITE-RELATIVE path `/api/media/cdn/{scope}/{mediaId}`. A browser has a page
 * to resolve that against; an inbox does not. So the reference is resolved and
 * then prefixed with the origin of whichever host is sending.
 */

const MEDIA_REF_PREFIX = 'media:'
const MEDIA_CDN_ROUTE = '/api/media/cdn'
const ORG_SCOPE_PREFIX = 'org:'
/** Mirrors `SEGMENT` in media-ref.ts, which mirrors the CDN's own grammar. */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/

/** Mirrors `isMediaCdnScope`. */
function isCdnScope(scope: string): boolean {
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return SEGMENT.test(scope)
  const parts = scope.slice(ORG_SCOPE_PREFIX.length).split(':')
  if (parts.length < 1 || parts.length > 2) return false
  return parts.every((part) => SEGMENT.test(part))
}

/** Mirrors `hostQualifiedScope`. */
function hostQualified(scope: string, hostId: string | undefined | null) {
  if (!hostId || !SEGMENT.test(hostId)) return scope
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return scope
  const orgId = scope.slice(ORG_SCOPE_PREFIX.length).split(':')[0]
  if (!orgId || !SEGMENT.test(orgId)) return scope
  return `${ORG_SCOPE_PREFIX}${orgId}:${hostId}`
}

/** Mirrors `resolveMediaSrc`. */
export function resolveEmailMediaSrc(
  value: string | undefined | null,
  hostId?: string | null,
): string | undefined {
  if (!value) return undefined
  if (!value.startsWith(MEDIA_REF_PREFIX)) return value
  const rest = value.slice(MEDIA_REF_PREFIX.length)
  // The scope may contain ':' but never '/', so the FIRST slash is the
  // boundary and the media id is everything after it.
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const scope = rest.slice(0, slash)
  const mediaId = rest.slice(slash + 1)
  if (!isCdnScope(scope) || !SEGMENT.test(mediaId)) return undefined
  return `${MEDIA_CDN_ROUTE}/${hostQualified(scope, hostId)}/${mediaId}`
}

/** Mirrors `hostPublicOrigin`. */
export function hostEmailOrigin(
  host: { cname?: string | null; subdomain?: string | null } | null | undefined,
): string | undefined {
  if (host?.cname) return `https://${host.cname}`
  if (host?.subdomain) return `https://${host.subdomain}.aglyn.app`
  return undefined
}
