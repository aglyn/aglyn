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

import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import type { PreviewKind } from '../constants/preview-state'
import { buildRoute, Route } from '../constants/route-links'

/*
 * WHERE A STAFF VIEW OF A SITE LINKS TO (AGL-3378).
 *
 * The customer console's previews live under `/[orgSlug]/hosts/[host]/…`,
 * which resolves the org and the site from the READER's memberships — a
 * staffer who is not a member of the site gets a 404 there. The staff
 * preview route mounts the same `DocumentPreview` with the site id from its
 * own URL instead; the rules already let staff read every site's documents.
 */

/** The preview kinds, in the order a staff page lists them. */
export const STAFF_PREVIEW_KINDS: readonly PreviewKind[] = [
  'screen',
  'layout',
  'component',
  'template',
  'form',
]

export const isPreviewKind = (value: unknown): value is PreviewKind =>
  typeof value === 'string' && (STAFF_PREVIEW_KINDS as readonly string[]).includes(value)

/**
 * The staff preview of one of a site's documents. Without a version it
 * renders the document's current one — the draft the besigner last saved.
 */
export function staffSitePreviewHref(
  hostId: string,
  kind: PreviewKind,
  docId: string,
  versionId?: string | null,
): string {
  const path = buildRoute(Route.ADMIN_SITE_PREVIEW, { hostId, kind, docId })
  return versionId ? `${path}?version=${encodeURIComponent(versionId)}` : path
}

/**
 * The screen a site serves at its root: the one its routing map publishes at
 * `SCREEN_ROOT_PATH`. Null for a site that publishes no home page.
 */
export function homeScreenId(
  screens: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  if (!screens || typeof screens !== 'object') return null
  for (const [screenId, slug] of Object.entries(screens)) {
    if (slug === SCREEN_ROOT_PATH) return screenId
  }
  return null
}
