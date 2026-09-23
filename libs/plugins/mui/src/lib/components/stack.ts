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
import {
  mdiViewColumn,
  mdiViewSequential,
} from '@aglyn/shared-data-mdi'
import MuiDivider from '@mui/material/Divider'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import type { CSSProperties, ReactElement } from 'react'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { colorSchemeAttribute } from '../utils/color-scheme-attribute'
import {
  applySemanticElement,
  semanticElementAttribute,
  semanticElementLabelAttribute,
} from '../utils/element-picker'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

/**
 * The dividers the `divider` attribute can name (AGL-2486).
 *
 * MUI's own `divider` prop takes a NODE, which an attributes panel cannot
 * author — so the persisted value is a style name and this file builds the
 * element. Anything else (an author's stray string, a paste) renders no
 * divider rather than the literal text between every pair of children.
 */
const DIVIDER_STYLES = {
  line: {},
  dashed: { borderStyle: 'dashed' },
} as const

export type StackDivider = keyof typeof DIVIDER_STYLES

// justifyContent/alignItems/flexWrap are not direct StackProps in MUI v6+;
// pass them through sx.
type StackWithFlexProps = Omit<StackProps, 'divider'> & {
  justifyContent?: CSSProperties['justifyContent']
  alignItems?: CSSProperties['alignItems']
  flexWrap?: CSSProperties['flexWrap']
  /** Divider STYLE name, not a node — see {@link DIVIDER_STYLES}. */
  divider?: StackDivider | string
  /**
   * A repeat's directives (AGL-103, AGL-181). The published page's
   * composition consumes them before anything renders; a surface that renders
   * the stored node as written, like a component editor, still hands them over.
   */
  repeatDataset?: string
  repeatLimit?: number | string
  repeatFilter?: string
  repeatSort?: string
}

/**
 * A Stack's divider runs ACROSS the flow, so its orientation is the
 * opposite of the stack's own axis. A responsive `direction` (an array or
 * object) is not authorable here, so only the string form is inspected;
 * anything else falls back to MUI's default horizontal rule.
 */
function buildDivider(
  divider: unknown,
  direction: unknown,
): ReactElement | undefined {
  if (typeof divider !== 'string') return undefined
  // `hasOwnProperty`, not a truthiness test on the lookup: `"constructor"`
  // and friends resolve through Object.prototype and would sail past one.
  if (!Object.prototype.hasOwnProperty.call(DIVIDER_STYLES, divider)) {
    return undefined
  }
  const style = DIVIDER_STYLES[divider as StackDivider]
  const horizontal =
    typeof direction === 'string' && direction.startsWith('row')
  return createElement(MuiDivider, {
    orientation: horizontal ? 'vertical' : 'horizontal',
    // Without it a vertical divider collapses to zero height in a flex row.
    flexItem: horizontal,
    sx: style,
  })
}

/**
 * Displays that make a Stack the flex container MUI's `spacing` assumes.
 */
const FLEX_DISPLAYS = new Set(['flex', 'inline-flex'])

/**
 * Whether an author's `sx` takes the Stack out of flex at any breakpoint
 * (AGL-3214).
 *
 * A function `sx` cannot be read without a theme, so it counts as flex and
 * the stack keeps MUI's own behaviour.
 */
function hasNonFlexDisplay(sx: unknown): boolean {
  if (Array.isArray(sx)) return sx.some(hasNonFlexDisplay)
  if (!sx || typeof sx !== 'object') return false
  const display = (sx as Record<string, unknown>).display
  const notFlex = (value: unknown) =>
    typeof value === 'string' && !FLEX_DISPLAYS.has(value)
  if (typeof display === 'string') return notFlex(display)
  // Responsive, in either of the forms the styles panel writes: an array of
  // breakpoint values, or a `{ xs, md }` map.
  if (Array.isArray(display)) return display.some(notFlex)
  if (display && typeof display === 'object')
    return Object.values(display).some(notFlex)
  return false
}

const Stack = forwardRef<HTMLDivElement, StackWithFlexProps>(
  // repeatDataset/repeatLimit are compose-time attributes (AGL-103): the
  // tenant expands them before render; strip so they never hit the DOM.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ justifyContent, alignItems, flexWrap, divider, useFlexGap, repeatDataset, repeatLimit, repeatFilter, repeatSort, sx, ...props }, ref) =>
    createElement(MuiStack, {
      ref,
      sx: [
        { justifyContent, alignItems, flexWrap },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ],
      // The stored value is a style NAME; MUI wants a node (AGL-2486).
      divider: buildDivider(divider, props.direction),
      // A cleared `direction` persists as null, and MUI resolves it as a
      // responsive value — `null.xs` throws during SSR and 500s the page.
      // Same class as the AGL-1226 button colour, different sharp edge.
      // Last, so an author's element wins over anything `props` carried
      // (AGL-2525). A stack IS the nav row on most sites; before this it
      // could only be wrapped in one.
      ...applySemanticElement(dropClearedProps(props) as Record<string, unknown>),
      // After the spread, so the element picker cannot carry a `useFlexGap`
      // past it. `spacing` reaches children as `margin-left` unless this is
      // on, and those margins assume flex: on a grid they land INSIDE the
      // track, so every item but the first sits a spacing-step right of its
      // column and the left gutter goes ragged (AGL-3214). `gap` is correct
      // for grid, multi-column and flex alike, and an author's own `sx` gap
      // still wins over it. A cleared switch persists as null, which is why
      // this reads `??` and not `||` — an author's explicit OFF stands.
      useFlexGap: useFlexGap ?? (hasNonFlexDisplay(sx) || undefined),
    }),
)

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiStack'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Stack',
  description:
    'Lays children out in a row or column with even spacing — the workhorse for most layouts.',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: {
    path: mdiViewColumn.path,
    sx: { color: '#2196f3' },
  },
  attributes: [
    semanticElementAttribute('this stack'),
    semanticElementLabelAttribute(),
    {
      name: 'direction',
      label: 'Direction',
      description:
        'Defines the directional flow using the `flex-direction` style property. It is applied for all screen sizes.',
      component: Aglyn.FieldComponentType.SELECT,
      // "Default" deleted (AGL-1453): unpersistable, and a second name for
      // `column`, MUI Stack's own default, already on the list.
      options: [
        { value: 'column', label: 'Column' },
        { value: 'column-reverse', label: 'Column Reversed' },
        { value: 'row', label: 'Row' },
        { value: 'row-reverse', label: 'Row Reversed' },
      ],
    },
    {
      name: 'justifyContent',
      label: 'Justify Content',
      description:
        'Defines how the browser distributes space between and around content items along the main-axis of the container.',
      component: Aglyn.FieldComponentType.SELECT,
      // "Default" deleted (AGL-1453). Unpersistable, and a second name for
      // `flex-start`: CSS's initial `justify-content` is `normal`, which on a
      // flex container — which a Stack always is — behaves as `flex-start`.
      //
      // Deleted rather than sentinelled for a second reason specific to this
      // prop: `justifyContent` is destructured out ABOVE and pushed into
      // `sx`, so it never passes through `dropClearedProps`. It is the one
      // attribute on this component the guard does not cover, so the right
      // move is to stop minting values it would have to catch.
      options: [
        { value: 'flex-start', label: 'Flex Start' },
        { value: 'center', label: 'Center' },
        { value: 'flex-end', label: 'Flex End' },
        { value: 'space-between', label: 'Space Between' },
        { value: 'space-around', label: 'Space Around' },
        { value: 'space-evenly', label: 'Space Evenly' },
      ],
    },
    {
      name: 'alignItems',
      label: 'Align Items',
      description:
        'Defines how the browser distributes space between and around ' +
        'content items along the cross-axis of the container — the axis ' +
        'across the Direction.',
      component: Aglyn.FieldComponentType.SELECT,
      // No "Default" sentinel (AGL-1453): `stretch` is CSS's own initial
      // `align-items` and is already on the list, and like `justifyContent`
      // this prop is pushed into `sx` rather than through
      // `dropClearedProps`, so an unpersistable `''` would not be caught.
      options: [
        { value: 'stretch', label: 'Stretch' },
        { value: 'flex-start', label: 'Flex Start' },
        { value: 'center', label: 'Center' },
        { value: 'flex-end', label: 'Flex End' },
        { value: 'baseline', label: 'Baseline' },
      ],
    },
    {
      name: 'spacing',
      label: 'Spacing',
      description: 'Defines the space/gap between its immediate children.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'useFlexGap',
      label: 'Use flex gap',
      description:
        'Space children with the CSS `gap` property instead of margins. ' +
        'Required for Spacing to survive wrapping, and it leaves child ' +
        'margins alone — but `gap` is unsupported in some older browsers.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'flexWrap',
      label: 'Wrap',
      description:
        'Whether children that do not fit move onto a new line. Turn on ' +
        'Use flex gap as well, or Spacing is applied as margins and the ' +
        'wrapped rows get an uneven gap.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'nowrap', label: 'No Wrap' },
        { value: 'wrap', label: 'Wrap' },
        { value: 'wrap-reverse', label: 'Wrap Reversed' },
      ],
    },
    {
      name: 'divider',
      label: 'Divider',
      description:
        'Draws a rule between each pair of children, across the ' +
        'Direction. Clear the field for no divider.',
      component: Aglyn.FieldComponentType.SELECT,
      // MUI's own prop takes a node; the persisted value is a style name and
      // the component builds the element. No `''` option (AGL-1453) — "no
      // divider" is the field's ✕, which persists as cleared.
      options: [
        { value: 'line', label: 'Line' },
        { value: 'dashed', label: 'Dashed' },
      ],
    },
    // No Repeat fields: every element's Attributes panel draws the same Repeat
    // section (AGL-3111), writing the props a Stack has always stored.
    colorSchemeAttribute(),
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Stack Horizontal',
    icon: {
      path: mdiViewColumn.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.LAYOUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { direction: 'row' },
    },
  },
  {
    $id: generatePresetId(ID, 'vertical'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Stack Vertical',
    icon: {
      path: mdiViewSequential.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.LAYOUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { direction: 'column' },
    },
  },
]

export default Stack
