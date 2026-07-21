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

import { ICON_VARIANT_HOST } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Avatar from '@mui/material/Avatar'

export interface HostIconProps {
  /**
   * The host doc; its `seo.favicon` is preferred when set. Taken as `unknown`
   * and narrowed below: host docs come through as `DocumentData`, which shares
   * no declared property with a favicon-shaped type and so trips TypeScript's
   * weak-type check.
   */
  host?: unknown
  /** Favicon box size in px (the fallback glyph uses `fontSize`). */
  size?: number
  fontSize?: 'inherit' | 'small' | 'medium' | 'large'
  /** Tint for the fallback glyph — e.g. marking the current site. */
  color?: 'inherit' | 'primary' | 'secondary'
}

/**
 * A site's icon: its favicon when the site has one (AGL-630/647), otherwise
 * the generic host glyph. Shared by the site switcher and the sites list so
 * a site looks the same wherever it's listed.
 */
export function HostIcon(props: HostIconProps) {
  const { host, size = 20, fontSize = 'small', color } = props
  const favicon = (host as { seo?: { favicon?: string } } | null | undefined)
    ?.seo?.favicon
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
