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

import type * as Aglyn from '@aglyn/aglyn'
import { getMdiIconPath } from '@aglyn/shared-data-mdi'
import { IconSelectControl } from '@aglyn/shared-ui-jsx-forms'
import { useCallback } from 'react'

export interface ComponentIconFieldProps {
  value?: Aglyn.ReusableComponentIcon
  onChange: (icon: Aglyn.ReusableComponentIcon) => void
  helperText?: string
}

/**
 * Picks the icon a reusable component is drawn with (AGL-1193) — the same
 * picker the besigner's Attributes panel uses, wired to plain state rather
 * than to a form library.
 *
 * Emits the id AND its resolved SVG path. That denormalization is the whole
 * point (AGL-1212): the ~2.9 MB icon catalog only loads on picker surfaces,
 * so a hierarchy row that had to resolve the id would draw a "help" glyph
 * with full confidence. Resolving here is safe because the catalog is loaded
 * — this component is what loaded it.
 */
export function ComponentIconField(props: ComponentIconFieldProps) {
  const { value, onChange, helperText } = props

  const handleChange = useCallback(
    (iconId: string) => {
      onChange(iconId ? { iconId, iconPath: getMdiIconPath(iconId) } : {})
    },
    [onChange],
  )

  return (
    <IconSelectControl
      value={value?.iconId ?? ''}
      onChange={handleChange}
      label="Icon"
      helperText={helperText}
    />
  )
}
ComponentIconField.displayName = 'ComponentIconField'

export default ComponentIconField
