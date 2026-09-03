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
// Deep import, NOT the barrel (AGL-1151): `@aglyn/shared-data-enums` re-exports
// `firebase-auth`, whose `AuthErrorCodes` is a VALUE import of `firebase/auth`.
// This bundle is `alwaysOn`, so the barrel put the whole Firebase auth client
// into the chunk every published tenant page loads — a database/identity SDK
// shipped and evaluated to render static HTML that authenticates nobody. Three
// breakpoint symbols are the entire reason this module reaches for that
// library; they live here, one file away from the barrel.
import {
  parseBreakpointSpan,
  SPAN_BREAKPOINTS,
  type SpanBreakpoint,
} from '@aglyn/shared-data-enums/breakpoint-span'
import MuiGrid from '@mui/material/Grid'
import { forwardRef, type ReactNode } from 'react'
import {
  semanticElementAttribute,
  semanticElementProp,
} from '../utils/element-picker'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiGrid'

/**
 * Breakpoint keys MUI's responsive `size`/`offset` objects accept.
 *
 * Re-exported from `@aglyn/shared-data-enums` rather than declared twice
 * (AGL-2486): the attributes panel's breakpoint row and this parser have to
 * agree on the list, and two copies is how they stop agreeing.
 */
export const BREAKPOINTS = SPAN_BREAKPOINTS
export type Breakpoint = SpanBreakpoint

export interface GridElementProps {
  /** Flex container behavior; items are its direct Grid children. */
  container?: boolean
  /**
   * Column span. Persisted as one string: a bare span (`6`), the keywords
   * `auto`/`grow`, or per-breakpoint pairs (`xs:12 md:6`). Authored through
   * the breakpoint row in the attributes panel (AGL-2486); the stored
   * format is unchanged from when it was a text box.
   */
  size?: string | number
  /** Empty columns before the item; same syntax as `size`, minus `grow`. */
  offset?: string | number
  spacing?: number | string
  rowSpacing?: number | string
  columnSpacing?: number | string
  /** Total columns in the container; MUI's default is 12. */
  columns?: number | string
  /**
   * Container flow. MUI supports `row`/`row-reverse` ONLY — Grid subdivides
   * a layout into columns, and `column`/`column-reverse` are documented as
   * unsupported (use a Stack for a vertical layout).
   */
  direction?: 'row' | 'row-reverse'
  /** `flex-wrap` for the container; MUI's default is `wrap`. */
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  children?: ReactNode
}

/**
 * Parses the authored span syntax into what MUI v6+ Grid expects.
 *
 * MUI dropped the `item` prop and the per-breakpoint `xs=`/`md=` props in
 * v6; v9 (installed here) takes a single `size` that is either a value or
 * a `{ xs, md, … }` object. One STORED string covers both, and this parser
 * owns the translation:
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
  // The reading itself is `parseBreakpointSpan` in `@aglyn/shared-data-enums`
  // (AGL-2486), shared with the attributes panel's breakpoint row so the
  // editor and the renderer cannot disagree about a stored string. This
  // function keeps its own signature and its "unparseable means unset"
  // contract: `raw` is what the editor hands back untouched, and what MUI
  // must never receive.
  const span = parseBreakpointSpan(value as string | number)
  if (span.raw !== undefined) return undefined
  if (span.base !== undefined) return span.base
  return span.values && Object.keys(span.values).length
    ? (span.values as Record<string, number | 'auto' | 'grow'>)
    : undefined
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
      direction,
      wrap,
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
        // A CLEARED select persists as `null`, and MUI resolves both of these
        // as responsive values — `null.xs` throws during SSR and 500s the
        // published page (the AGL-1226 shape). `undefined` is what "cleared"
        // has to mean by the time it reaches MUI.
        {...dropClearedProps({ direction, wrap })}
        {...dropClearedProps(rest)}
        {...semanticElementProp((rest as { component?: unknown }).component)}
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
  'How many columns this cell takes. Set **All** for every screen size, or ' +
  'give individual breakpoints a value — `xs` applies from the smallest ' +
  'screens up and each larger breakpoint overrides it. `auto` fits the ' +
  'content, `grow` takes the remaining space.'

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
    semanticElementAttribute('this grid'),
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
      // A row of breakpoint controls rather than a text box (AGL-2486). The
      // STORED value is the same string it always was; only the way it is
      // authored changed. `xs:12 md:2` was a developer syntax documented
      // nowhere but this tooltip, so the responsive capability was there and
      // effectively unreachable.
      component: Aglyn.FieldComponentType.BREAKPOINT_SPAN,
      condition: ITEM_ONLY,
    },
    {
      name: 'offset',
      label: 'Offset',
      description:
        'Empty columns before this cell. `auto` pushes the cell to the ' +
        'right; `grow` is a span keyword and not an offset, so it is not ' +
        'offered here.',
      component: Aglyn.FieldComponentType.BREAKPOINT_SPAN,
      // MUI's GridOffset is `'auto' | number`: a zero offset is a real
      // choice, and `grow` is not one at all.
      allowGrow: false,
      minSpan: 0,
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
    {
      name: 'direction',
      label: 'Direction',
      // The option that is NOT offered is the point of this field. MUI's own
      // API doc: "Only `row` and `row-reverse` are supported. `column` and
      // `column-reverse` are not supported, because the Grid component is
      // designed to subdivide layouts into columns, not rows." Offering them
      // would be a control that silently does nothing.
      description:
        'Sets the `flex-direction` for the row. Only Row and Row Reversed ' +
        'are supported — Grid divides a layout into columns, so a column ' +
        'direction does nothing. Use a Stack for a vertical layout.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'row', label: 'Row' },
        { value: 'row-reverse', label: 'Row Reversed' },
      ],
      condition: CONTAINER_ONLY,
    },
    {
      name: 'wrap',
      label: 'Wrap',
      description:
        'Whether cells that do not fit move onto a new line. Default Wrap; ' +
        'No Wrap keeps every cell on one line and lets them shrink instead.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'wrap', label: 'Wrap' },
        { value: 'nowrap', label: 'No Wrap' },
        { value: 'wrap-reverse', label: 'Wrap Reversed' },
      ],
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
