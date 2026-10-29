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

import {
  SITE_STYLE_PREVIEW_SIZE,
  SITE_STYLES,
} from '@aglyn/aglyn/app-utils/site-styles'
import { OptionCardGrid } from '@aglyn/shared-ui-jsx/components/option-card-grid.component'
import { useMemo } from 'react'

export interface SiteStylePickerProps {
  /** The style chosen, or `null` while none is. */
  value: string | null
  onChange: (styleId: string) => void
  /** Columns at each breakpoint. */
  columns?: { xs?: number; sm?: number; md?: number }
}

/**
 * The styles a new site can start in (AGL-4049), as cards with a picture of
 * each: the plain Create site dialog's own choice, drawn when no start
 * widget draws one. Nothing is chosen until a card is clicked; the list, the
 * pictures and their descriptions are core's `SITE_STYLES`.
 */
export function SiteStylePicker({ value, onChange, columns = { xs: 1, sm: 2, md: 3 } }: SiteStylePickerProps) {
  const options = useMemo(
    () =>
      SITE_STYLES.map((style) => ({
        id: style.id,
        title: style.name,
        description: style.blurb,
        image: { src: style.preview, alt: style.alt, ...SITE_STYLE_PREVIEW_SIZE },
      })),
    [],
  )
  return (
    <OptionCardGrid
      label="Style of site"
      data-create-area="style-cards"
      columns={columns}
      options={options}
      value={value}
      onChange={onChange}
    />
  )
}

export default SiteStylePicker
