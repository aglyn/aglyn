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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { ICON_VARIANT_HOST } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Avatar from '@mui/material/Avatar'

export interface HostIconProps {
  /**
   * A host doc OR a `hostMemberships` projection row — this component serves
   * both, and they spell the favicon differently (AGL-1071):
   *
   * - host doc: nested, `seo.favicon`, alongside the rest of the SEO block
   * - projection row: flat, `favicon`, like its `displayName` / `subdomain`
   *
   * Both carry `$id` — the host doc id either way — which is what qualifies an
   * org-scoped media reference to the site asking for it (see below).
   *
   * Taken as `unknown` and narrowed below: host docs come through as
   * `DocumentData`, which shares no declared property with a favicon-shaped
   * type and so trips TypeScript's weak-type check.
   */
  host?: unknown
  /** Favicon box size in px (the fallback glyph uses `fontSize`). */
  size?: number
  fontSize?: 'inherit' | 'small' | 'medium' | 'large'
  /** Tint for the fallback glyph — e.g. marking the current site. */
  color?: 'inherit' | 'primary' | 'primary'
}

/**
 * A site's icon: its favicon when the site has one (AGL-630/647), otherwise
 * the generic host glyph. Shared by the site switcher and the sites list so
 * a site looks the same wherever it's listed.
 */
export function HostIcon(props: HostIconProps) {
  const { host, size = 20, fontSize = 'small', color } = props
  // Accept both shapes. Reading only `seo.favicon` is why the switcher showed
  // the generic glyph for every site while the sites list — same component,
  // real host docs — showed favicons fine (AGL-1071).
  const source = host as
    | { $id?: string; seo?: { favicon?: string }; favicon?: string }
    | null
    | undefined
  const stored = source?.seo?.favicon || source?.favicon
  /**
   * `seo.favicon` holds the same three generations `logoUrl` does — a raw
   * storage URL, an AGL-175 CDN path, and a `media:` reference (AGL-1407) —
   * and only the resolver knows all three. Handing the stored string straight
   * to `<Avatar src>` worked for exactly as long as no site's favicon held a
   * reference, which is why this component and the favicon card had to learn
   * to resolve BEFORE the back-fill converts the field: a reference reaching
   * an `<img src>` verbatim is a broken tile in the site switcher and the
   * sites list, on every site at once.
   *
   * The host id qualifies an ORG-scoped reference to the site asking for it
   * (`hostQualifiedScope`), so an asset restricted to particular sites still
   * resolves. Both shapes carry it as `$id`; a row that somehow lacks one
   * still resolves the org-wide form, which is what a favicon almost always
   * is.
   */
  const favicon = Aglyn.resolveMediaSrc(stored, { hostId: source?.$id })
  if (favicon) {
    return (
      <Avatar
        src={favicon}
        variant="rounded"
        sx={{ width: size, height: size }}
        slotProps={{ img: { loading: 'lazy' } }}
      />
    )
  }
  return (
    <MdiIcon path={ICON_VARIANT_HOST.path} fontSize={fontSize} color={color} />
  )
}

export default HostIcon
