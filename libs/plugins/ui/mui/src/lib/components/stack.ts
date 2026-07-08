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
import MuiStack, { type StackProps } from '@mui/material/Stack'
import type { CSSProperties } from 'react'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// justifyContent/alignItems are no longer direct StackProps in MUI v6+; pass them through sx.
type StackWithFlexProps = StackProps & {
  justifyContent?: CSSProperties['justifyContent']
  alignItems?: CSSProperties['alignItems']
  /** Repeatable marker (AGL-103); consumed at compose time, not by MUI. */
  repeatDataset?: string
  repeatLimit?: number | string
  /** Query config (AGL-181); compose-time, not rendered. */
  repeatFilter?: string
  repeatSort?: string
}

const Stack = forwardRef<HTMLDivElement, StackWithFlexProps>(
  // repeatDataset/repeatLimit are compose-time attributes (AGL-103): the
  // tenant expands them before render; strip so they never hit the DOM.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ justifyContent, alignItems, repeatDataset, repeatLimit, repeatFilter, repeatSort, sx, ...props }, ref) =>
    createElement(MuiStack, {
      ref,
      sx: [{ justifyContent, alignItems }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])],
      ...props,
    }),
)

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiStack'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Stack',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: {
    path: mdiViewColumn.path,
    sx: { color: '#2196f3' },
  },
  attributes: [
    {
      name: 'direction',
      label: 'Direction',
      description:
        'Defines the directional flow using the `flex-direction` style property. It is applied for all screen sizes.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Default' },
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
      options: [
        { value: '', label: 'Default' },
        { value: 'flex-start', label: 'Flex Start' },
        { value: 'center', label: 'Center' },
        { value: 'flex-end', label: 'Flex End' },
        { value: 'space-between', label: 'Space Between' },
        { value: 'space-around', label: 'Space Around' },
        { value: 'space-evenly', label: 'Space Evenly' },
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
      name: 'repeatDataset',
      label: 'Repeat over dataset',
      description:
        'Dataset name (Dashboard → Data). The children act as an item ' +
        'template rendered once per record on the published site; use ' +
        '{{item.field}} inside them for record values.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'repeatLimit',
      label: 'Repeat limit',
      description: 'Maximum records rendered (blank = all, capped at 100).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'repeatFilter',
      label: 'Repeat filter',
      description:
        'Optional "field op value" filter, e.g. "price <= 20", ' +
        '"tier == plus", or "tags contains red". Ops: == != > >= < <= ' +
        'contains. Applies to the first 100 records.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'repeatSort',
      label: 'Repeat sort',
      description:
        'Optional "field" or "field desc" ordering, e.g. "price desc".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
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
