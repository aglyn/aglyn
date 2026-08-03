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
import { mdiViewGrid, mdiViewGridOutline } from '@aglyn/shared-data-mdi'
import MuiGrid from '@mui/material/Grid'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiGrid'

/** Breakpoint keys MUI's responsive `size`/`offset` objects accept. */
export const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
export type Breakpoint = (typeof BREAKPOINTS)[number]

export interface GridElementProps {
  /** Flex container behavior; items are its direct Grid children. */
  container?: boolean
  /**
   * Column span, authored as text. Accepts a bare span (`6`), the
   * keywords `auto`/`grow`, or per-breakpoint pairs (`xs:12 md:6`).
   */
  size?: string | number
  /** Empty columns before the item; same syntax as `size`. */
  offset?: string | number
  spacing?: number | string
  rowSpacing?: number | string
  columnSpacing?: number | string
  /** Total columns in the container; MUI's default is 12. */
  columns?: number | string
  children?: ReactNode
}

/**
 * Parses the authored span syntax into what MUI v6+ Grid expects.
 *
 * MUI dropped the `item` prop and the per-breakpoint `xs=`/`md=` props in
 * v6; v9 (installed here) takes a single `size` that is either a value or
 * a `{ xs, md, … }` object. Exposing five separate breakpoint fields in
 * the inspector for one concept is worse than one field, so the field is
 * text and this parser owns the translation:
 *
 *   `6`           → 6
 *   `auto`        → 'auto'
 *   `grow`        → 'grow'
 *   `xs:12 md:6`  → { xs: 12, md: 6 }
 *
 * Anything unparseable returns `undefined` rather than a partial object:
 * a half-applied breakpoint map is a layout that silently differs from
 * what the author typed.
 */
export function parseSpan(
  value: unknown,
): number | 'auto' | 'grow' | Record<string, number | 'auto' | 'grow'> | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const text = String(value).trim()
  if (!text) return undefined
  if (text === 'auto' || text === 'grow') return text
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)

  const pairs = text.split(/[\s,]+/).filter(Boolean)
  const result: Record<string, number | 'auto' | 'grow'> = {}
  for (const pair of pairs) {
    const match = /^([a-z]+)\s*[:=]\s*(auto|grow|-?\d+(?:\.\d+)?)$/i.exec(pair)
    if (!match) return undefined
    const key = (match[1] ?? '').toLowerCase()
    if (!BREAKPOINTS.includes(key as Breakpoint)) return undefined
    const raw = match[2] ?? ''
    result[key] =
      raw === 'auto' || raw === 'grow'
        ? (raw as 'auto' | 'grow')
        : Number(raw)
  }
  return Object.keys(result).length ? result : undefined
}

/**
 * Same syntax as `parseSpan`, minus `grow`.
 *
 * MUI's `GridOffset` is `'auto' | number` only — a `grow` offset is not
 * a wider gap, it is a value the layout cannot use, so it is dropped
 * here rather than passed through to be ignored.
 */
export function parseOffset(value: unknown) {
  const parsed = parseSpan(value)
  if (parsed === 'grow') return undefined
  if (parsed && typeof parsed === 'object') {
    const kept = Object.fromEntries(
      Object.entries(parsed).filter(([, span]) => span !== 'grow'),
    )
    return Object.keys(kept).length
      ? (kept as Record<string, number | 'auto'>)
      : undefined
  }
  return parsed as number | 'auto' | undefined
}

/** Spacing/columns arrive as strings from number fields; MUI wants numbers. */
function toNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Responsive 12-column grid (https://mui.com/material-ui/react-grid/).
 * One element covers both roles, matching MUI v6+: switch **Container**
 * on for the row, leave it off and set a **Span** for each cell.
 */
const GridElement = forwardRef<HTMLDivElement, GridElementProps>(
  (props, ref) => {
    const {
      container,
      size,
      offset,
      spacing,
      rowSpacing,
      columnSpacing,
      columns,
      children,
      ...rest
    } = props
    return (
      <MuiGrid
        ref={ref}
        container={!!container}
        size={parseSpan(size)}
        offset={parseOffset(offset)}
        // Spacing props only apply to containers; MUI ignores them on
        // items, so no need to strip them here.
        spacing={toNumber(spacing)}
        rowSpacing={toNumber(rowSpacing)}
        columnSpacing={toNumber(columnSpacing)}
        columns={toNumber(columns)}
        {...rest}
      >
        {children}
      </MuiGrid>
    )
  },
)
GridElement.displayName = 'AglynGrid'

/** Container-only props: MUI ignores these on an item. */
const CONTAINER_ONLY = { when: 'container', is: true }
/** Item-only props: a container spans its parent, not a column count. */
const ITEM_ONLY = { when: 'container', is: true, notMatch: true }

const SPAN_HELP =
  'A column span (1–12), `auto` to fit the content, `grow` to take the ' +
  'remaining space, or per-breakpoint pairs like `xs:12 md:6`.'

export const schema: Aglyn.ComponentSchema<GridElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Grid',
  description:
    'Responsive 12-column layout. Turn on Container for the row; give ' +
    'each cell a Span.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: { path: mdiViewGrid.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'container',
      label: 'Container?',
      description:
        'If true, this grid lays its direct Grid children out in columns. ' +
        'Leave it off for a cell inside another grid.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'size',
      label: 'Span',
      description: SPAN_HELP,
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      condition: ITEM_ONLY,
    },
    {
      name: 'offset',
      label: 'Offset',
      description:
        'Empty columns before this cell. Same syntax as Span, e.g. ' +
        '`md:2` — `auto` pushes the cell to the right, and `grow` is not ' +
        'an offset.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      condition: ITEM_ONLY,
    },
    {
      name: 'spacing',
      label: 'Spacing',
      description:
        'Gap between cells, in theme spacing units (1 = 8px by default).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: CONTAINER_ONLY,
    },
    {
      name: 'rowSpacing',
      label: 'Row spacing',
      description: 'Vertical gap only; overrides Spacing.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: CONTAINER_ONLY,
    },
    {
      name: 'columnSpacing',
      label: 'Column spacing',
      description: 'Horizontal gap only; overrides Spacing.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: CONTAINER_ONLY,
    },
    {
      name: 'columns',
      label: 'Columns',
      description: 'Total columns the row is divided into. Default 12.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: CONTAINER_ONLY,
    },
  ],
}

const cell = (size: string, text: string) => ({
  $id: null,
  componentId: ID,
  pluginId: BUNDLE_ID,
  props: { size },
  nodes: [
    {
      $id: null,
      componentId: 'muiTypography',
      pluginId: BUNDLE_ID,
      props: { variant: 'body2', children: text },
    },
  ],
})

export const presets: Aglyn.PresetSchema[] = [
  {
    // Ships as a working responsive row, not a bare container: an empty
    // grid renders as nothing at all on the canvas.
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Grid',
    pluginId: BUNDLE_ID,
    description: 'Responsive row — three columns that stack on mobile',
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { container: true, spacing: 2 },
      nodes: [
        cell('xs:12 md:4', 'Column one'),
        cell('xs:12 md:4', 'Column two'),
        cell('xs:12 md:4', 'Column three'),
      ],
    },
  },
  {
    $id: generatePresetId(ID, 'cell'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Grid Cell',
    pluginId: BUNDLE_ID,
    description: 'A single cell to add to an existing grid row',
    category: Aglyn.ComponentCategory.LAYOUT,
    icon: { path: mdiViewGridOutline.path, sx: { color: '#2196f3' } },
    data: cell('xs:12 md:6', 'Cell'),
  },
]

export default GridElement
