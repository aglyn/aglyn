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
import { mdiFileDocumentOutline } from '@aglyn/shared-data-mdi'
import MuiPaper from '@mui/material/Paper'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiPaper'

export interface PaperElementProps {
  /** Shadow depth, 0–24. Ignored by MUI when `variant` is `outlined`. */
  elevation?: number | string
  variant?: 'elevation' | 'outlined'
  /** If true, corners are not rounded. */
  square?: boolean
  children?: ReactNode
}

/** MUI's shadow scale tops out at 24; anything above renders unshadowed. */
export const MAX_ELEVATION = 24

/**
 * Coerces a persisted elevation to the number MUI's shadow lookup needs.
 *
 * Number-typed attribute fields round-trip through the document as
 * strings often enough that this can't be assumed away: `elevation="3"`
 * indexes MUI's shadow array with a string and yields `undefined`, i.e. a
 * paper the author gave a shadow renders completely flat.
 */
export function toElevation(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(Math.max(Math.round(parsed), 0), MAX_ELEVATION)
}

/**
 * Surface primitive (https://mui.com/material-ui/react-paper/): the
 * themed background + shadow that Card, Accordion and Drawer are all
 * built on, exposed on its own for panels and callouts.
 */
const PaperElement = forwardRef<HTMLDivElement, PaperElementProps>(
  (rawProps, ref) => {
    // Cleared props dropped before anything reads them (AGL-1451): `square`
    // and everything else in `rest` spread straight into MUI, where a `null`
    // from the field's ✕ (AGL-1226) is a value rather than an absence.
    const props = dropClearedProps(rawProps)
    const { elevation, variant, children, ...rest } = props
    const resolved = toElevation(elevation)
    return (
      <MuiPaper
        ref={ref}
        // `outlined` has no shadow; passing an elevation alongside it is
        // silently ignored by MUI, so don't pretend otherwise.
        variant={variant === 'outlined' ? 'outlined' : 'elevation'}
        elevation={variant === 'outlined' ? undefined : resolved}
        {...rest}
      >
        {children}
      </MuiPaper>
    )
  },
)
PaperElement.displayName = 'AglynPaper'

/** Elevation only means anything on the (default) `elevation` variant. */
const ELEVATION_ONLY = { when: 'variant', is: 'outlined', notMatch: true }

export const schema: Aglyn.ComponentSchema<PaperElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Paper',
  description: 'Themed surface with a shadow or an outline.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiFileDocumentOutline.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'variant',
      label: 'Variant',
      description:
        'Elevation raises the surface with a shadow; outlined draws a ' +
        '1px border instead and has no shadow.',
      component: Aglyn.FieldComponentType.SELECT,
      // A real sentinel rather than a deletion (AGL-1451): unlike Container,
      // "elevation" is not a second name for something else in the list —
      // it is MUI's own variant value, the other half of a two-way choice,
      // and the one the Elevation control below is conditioned on. It was
      // spelled `''`, which the attributes form strips on change (AGL-1191),
      // so picking it reverted the field on save.
      options: [
        { value: 'elevation', label: 'Elevation (default)' },
        { value: 'outlined', label: 'Outlined' },
      ],
    },
    {
      name: 'elevation',
      label: 'Elevation',
      description:
        'Shadow depth from 0 (flat) to 24. In dark mode MUI also lightens ' +
        'the background as this rises.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      // Offering a shadow control on the outlined variant would be a
      // control that silently does nothing.
      condition: ELEVATION_ONLY,
    },
    {
      name: 'square',
      label: 'Square corners?',
      description: 'If true, the corners are not rounded.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Paper',
    pluginId: BUNDLE_ID,
    description: 'Raised surface for panels and callouts',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { elevation: 1 },
      // Node-level sx (AGL-1346) — the record the Styles panel edits.
      sx: { p: 2 },
      nodes: [
        {
          $id: null,
          componentId: 'muiTypography',
          pluginId: BUNDLE_ID,
          props: {
            variant: 'body1',
            children: 'Paper is a themed surface. Drop anything inside it.',
          },
        },
      ],
    },
  },
  {
    $id: generatePresetId(ID, 'outlined'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Paper Outlined',
    pluginId: BUNDLE_ID,
    description: 'Flat surface with a border instead of a shadow',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { variant: 'outlined' },
      sx: { p: 2 },
      nodes: [
        {
          $id: null,
          componentId: 'muiTypography',
          pluginId: BUNDLE_ID,
          props: {
            variant: 'body1',
            children: 'Outlined paper has a border and no shadow.',
          },
        },
      ],
    },
  },
]

export default PaperElement
