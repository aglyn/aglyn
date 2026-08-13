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

import * as Aglyn from '@aglyn/aglyn'
import { mdiFormatListNumbered } from '@aglyn/shared-data-mdi'
import MuiPagination from '@mui/material/Pagination'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_DISABLED, FIELD_SIZE } from '../constants/field-presets'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiPagination'

export interface PaginationElementProps {
  count?: number | string
  defaultPage?: number | string
  color?: 'primary' | 'secondary' | 'standard'
  shape?: 'circular' | 'rounded'
  size?: 'small' | 'medium' | 'large'
  variant?: 'text' | 'outlined'
  siblingCount?: number | string
  boundaryCount?: number | string
  showFirstButton?: boolean
  showLastButton?: boolean
  hidePrevButton?: boolean
  hideNextButton?: boolean
  disabled?: boolean
  /**
   * Accepted and dropped. The element is self-closing (see `flags`), so the
   * editor never authors children — but the renderer builds elements from
   * persisted props, and a stray child from an older document would reach
   * MUI's Pagination and render beside the page list. Declared because the
   * implementation deliberately discards it (AGL-1323).
   */
  children?: ReactNode
}

/** Number-typed attribute fields round-trip as strings. */
function toCount(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round(parsed)
}

/**
 * Pagination control (https://mui.com/material-ui/react-pagination/).
 *
 * Uncontrolled: it tracks and highlights the page a visitor picks, but
 * it does not by itself fetch or filter anything — pair it with an
 * interaction, or with a repeat that reads the page. That is stated in
 * the element's own description too, because a page-picker that looks
 * wired and isn't is worse than one that says what it is.
 *
 * The `size` here is MUI's own three-value scale; the shared FIELD_SIZE
 * preset also offers `inherit`, which Pagination does not accept, so the
 * shared field is narrowed rather than re-declared.
 */
const PaginationElement = forwardRef<HTMLElement, PaginationElementProps>(
  (props, ref) => {
    const {
      count,
      defaultPage,
      siblingCount,
      boundaryCount,
      children: _children,
      ...spread
    } = props
    // A cleared `color`/`size` persists as null; MUI capitalizes both and
    // throws during SSR, 500ing the page (AGL-1226).
    const rest = dropClearedProps(spread)
    const total = toCount(count, 10)
    return (
      <MuiPagination
        ref={ref}
        count={total}
        // Out-of-range defaults make MUI drop the selection entirely.
        defaultPage={Math.min(Math.max(toCount(defaultPage, 1), 1), total)}
        siblingCount={toCount(siblingCount, 1)}
        boundaryCount={toCount(boundaryCount, 1)}
        {...rest}
      />
    )
  },
)
PaginationElement.displayName = 'AglynPagination'

export const schema: Aglyn.ComponentSchema<PaginationElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Pagination',
  description:
    'Page picker. It highlights the chosen page; wire an interaction to ' +
    'make it change what the page shows.',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiFormatListNumbered.path, sx: { color: '#2196f3' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'count',
      label: 'Pages',
      description: 'Total number of pages. Default 10.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'defaultPage',
      label: 'Starting page',
      description: 'The page selected when a visitor arrives. Default 1.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'variant',
      label: 'Variant',
      description: 'Outlined draws a border around each page item.',
      component: Aglyn.FieldComponentType.SELECT,
      // REAL SENTINELS here, not deletions (AGL-1453) — the opposite call
      // from Button's and Typography's "Default" options, for a reason that
      // is visible in the lists themselves: those name MUI's default among
      // their choices, so `''` was a duplicate. These four offered ONLY the
      // non-default alternative, so `''` was the sole route back — and it
      // could not persist (AGL-1191). Picking Outlined, Rounded, Primary or
      // Small was a one-way door: the "(default)" option reverted on save and
      // the field snapped back to what it was.
      //
      // Each sentinel is MUI Pagination's own literal default for that prop
      // (`Pagination.js`: `variant = 'text'`, `shape = 'circular'`,
      // `color = 'standard'`, `size = 'medium'`), so the labels stop lying
      // and a stored value renders exactly what an unset one did.
      options: [
        { value: 'text', label: 'Text (default)' },
        { value: 'outlined', label: 'Outlined' },
      ],
    },
    {
      name: 'shape',
      label: 'Shape',
      description: 'Rounded squares instead of circles.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'circular', label: 'Circular (default)' },
        { value: 'rounded', label: 'Rounded' },
      ],
    },
    {
      name: 'color',
      label: 'Theme color',
      description: 'Color of the selected page item.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'standard', label: 'Standard (default)' },
        { value: 'primary', label: 'Primary' },
        { value: 'secondary', label: 'Secondary' },
      ],
    },
    {
      // Narrowed from the shared preset: Pagination has no `inherit`
      // size, and offering it would render nothing different.
      ...FIELD_SIZE,
      options: [
        { value: 'medium', label: 'Medium (default)' },
        { value: 'small', label: 'Small' },
        { value: 'large', label: 'Large' },
      ],
    },
    {
      name: 'siblingCount',
      label: 'Sibling pages',
      description:
        'How many page numbers to show either side of the current one.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'boundaryCount',
      label: 'Boundary pages',
      description:
        'How many page numbers to always show at the start and end.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'showFirstButton',
      label: 'Show first-page button?',
      description: 'Adds a jump-to-first control.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'showLastButton',
      label: 'Show last-page button?',
      description: 'Adds a jump-to-last control.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'hidePrevButton',
      label: 'Hide previous button?',
      description: 'Removes the previous-page arrow.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'hideNextButton',
      label: 'Hide next button?',
      description: 'Removes the next-page arrow.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    FIELD_DISABLED,
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Pagination',
    pluginId: BUNDLE_ID,
    description: 'Page picker with previous/next arrows',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { count: 10, color: 'primary' },
    },
  },
]

export default PaginationElement
