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
import { mdiPageLayoutHeader } from '@aglyn/shared-data-mdi'
import MuiAppBar, { type AppBarProps } from '@mui/material/AppBar'
import { type SxProps, type Theme } from '@mui/material/styles'
import useScrollTrigger from '@mui/material/useScrollTrigger'
import { createElement, forwardRef, type Ref } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  applySemanticElement,
  semanticElementAttribute,
  semanticElementLabelAttribute,
} from '../utils/element-picker'
import { FIELD_COLOR_ALT1, FIELD_POSITION } from '../constants/field-presets'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'
import { ID as toolbarId } from './toolbar'

export interface AglynAppBarProps extends AppBarProps {
  /**
   * Compacts the bar's Toolbar Content to the dense height once the page
   * has scrolled, and back at the top. Meant for a pinned (sticky/fixed)
   * bar, where the full height costs the reader a band of every screen.
   */
  shrinkOnScroll?: boolean
}

/** Scroll distance before a shrinking bar compacts. */
const SHRINK_THRESHOLD = 16

/**
 * The scrolled state rides a data attribute, not a re-styled sx, so the
 * server render and every scroll position share one emotion class.
 */
const shrinkSx: SxProps<Theme> = (theme) => ({
  '& .MuiToolbar-root': {
    transition: theme.transitions.create('min-height', {
      duration: theme.transitions.duration.shorter,
    }),
  },
  '&[data-scrolled] .MuiToolbar-root': {
    // MUI's dense toolbar height.
    minHeight: theme.spacing(6),
  },
})

function withShrinkSx(sx: AppBarProps['sx']): AppBarProps['sx'] {
  return [shrinkSx, ...(Array.isArray(sx) ? sx : [sx])] as AppBarProps['sx']
}

function renderAppBar(props: AppBarProps, ref: Ref<HTMLElement>) {
  return createElement(MuiAppBar, {
    // Unset leaves MUI's own default, which is `header` — the banner
    // landmark every site's chrome depends on (AGL-2525). A resolver that
    // answered `div` for "unset" would have stripped it the moment the
    // picker appeared.
    ...applySemanticElement(dropClearedProps(props) as Record<string, unknown>),
    ref,
  })
}

/**
 * Its own component so the scroll listener exists only on a bar that asked
 * to shrink — a hook behind a prop check would break the rules of hooks.
 */
const ShrinkingAppBar = forwardRef<HTMLElement, AppBarProps>((props, ref) => {
  const scrolled = useScrollTrigger({
    disableHysteresis: true,
    threshold: SHRINK_THRESHOLD,
  })
  return renderAppBar(
    {
      ...props,
      sx: withShrinkSx(props.sx),
      ...({ 'data-scrolled': scrolled ? '' : undefined } as AppBarProps),
    },
    ref,
  )
})
ShrinkingAppBar.displayName = 'AglynShrinkingAppBar'

/**
 * MUI's AppBar behind the cleared-prop guard (AGL-1226).
 *
 * It was exported raw, which left BOTH of its authorable attributes exposed:
 * `color` and `position` are each run through MUI's `capitalize`, so clearing
 * either one persists a null that throws during SSR and 500s the page. A
 * wrapper is the only place to intercept it, since the schema's props reach
 * MUI directly. `createElement` rather than JSX keeps this a `.ts` file.
 */
const AppBar = forwardRef<HTMLElement, AglynAppBarProps>(
  ({ shrinkOnScroll, ...props }, ref) =>
    shrinkOnScroll
      ? createElement(ShrinkingAppBar, { ...props, ref })
      : renderAppBar(props, ref),
)
AppBar.displayName = 'AglynAppBar'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiAppBar'

export const schema: Aglyn.ComponentSchema<AglynAppBarProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'App Bar',
  description:
    'The bar across the top of the site — put a Toolbar Content inside it.',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: {
    path: mdiPageLayoutHeader.path,
    sx: { color: '#2196f3' },
  },
  attributes: [
    semanticElementAttribute('this bar'),
    semanticElementLabelAttribute(),
    FIELD_COLOR_ALT1,
    FIELD_POSITION,
    {
      name: 'shrinkOnScroll',
      description:
        'Compacts the bar to the dense height once the page scrolls, and ' +
        'restores it at the top. Pair with a Sticky or Fixed position.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Shrink when scrolled?',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'App Bar',
    pluginId: BUNDLE_ID,
    description: 'An app bar preset with the app bar and toolbar content nodes',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      nodes: [
        {
          $id: null,
          componentId: toolbarId,
          pluginId: BUNDLE_ID,
          props: {},
        },
      ],
    },
  },
]

export default AppBar
