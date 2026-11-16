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

import { getMdiIconPath } from '@aglyn/shared-data-mdi'
import { IconSelectControl } from '@aglyn/shared-ui-jsx-forms/components/icon-select.component'
import type { DatasetIconValue } from '../model/dataset-icon-field'

export interface DatasetIconPickerProps {
  iconId: string
  disabled?: boolean
  /** The pick with its path, or `undefined` when the picker was cleared. */
  onPick: (icon: DatasetIconValue | undefined) => void
}

/**
 * The icon library, as the Besigner's Icon element offers it (AGL-4190).
 *
 * Its own chunk, loaded by the record editor's Icon field only when opened.
 * The path is looked up here, at the moment of the pick, for the reason the
 * Besigner stores `iconPath` beside an Icon's `iconId` (AGL-1212): this is
 * the one moment the catalog is certainly loaded, since the picker needed it
 * to offer the icon.
 */
export default function DatasetIconPicker({ iconId, disabled, onPick }: DatasetIconPickerProps) {
  return (
    <IconSelectControl
      value={iconId}
      aria-disabled={disabled || undefined}
      onChange={(picked: string) => {
        if (disabled) return
        if (!picked) {
          onPick(undefined)
          return
        }
        const iconPath = getMdiIconPath(picked)
        onPick(iconPath ? { iconId: picked, iconPath } : { iconId: picked })
      }}
    />
  )
}
