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
import { ScrollReaction } from '@aglyn/shared-ui-jsx/components/scroll-reaction'
import MuiAppBar, { type AppBarProps } from '@mui/material/AppBar'
import { type SxProps, type Theme } from '@mui/material/styles'
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
import { UNDER_HEADER_ATTRIBUTE } from './section'
import { ID as toolbarId } from './toolbar'

export interface AglynAppBarProps extends AppBarProps {
  /**
   * Compacts the bar's Toolbar Content to the dense height once the page
   * has scrolled, and back at the top. Meant for a pinned (sticky/fixed)
   * bar, where the full height costs the reader a band of every screen.
   */
  shrinkOnScroll?: boolean
  /**
   * Slides the bar up out of view while the visitor scrolls down, and back
   * the moment they scroll up. Meant for a pinned (sticky/fixed) bar.
   */
  hideOnScroll?: boolean
  /**
   * Sits over a photo hero (AGL-3660): on a page whose first band runs under
   * the header (a Section with `underHeader`), the bar lies over that band
   * with no background of its own and its words in white, and scrolls away
   * with it; on every other page it is the bar it always was.
   */
  overHero?: boolean
}

/**
 * Over a page that opens under the header, the bar lies on the photo. One
 * rule the browser applies by what the page holds, so the server render, the
 * published page and every page of a layout share one class, and a page
 * without such a band is untouched.
 */
const overHeroSx: SxProps<Theme> = (theme) => ({
  [`body:has([${UNDER_HEADER_ATTRIBUTE}]) &`]: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
    borderBottom: 0,
    color: theme.palette.common.white,
  },
})

function withOverHeroSx(sx: AppBarProps['sx']): AppBarProps['sx'] {
  return [overHeroSx, ...(Array.isArray(sx) ? sx : [sx])] as AppBarProps['sx']
}

/** Scroll distance before a shrinking bar compacts. */
const SHRINK_THRESHOLD = 16
/** Scroll distance before a hiding bar may slide away — past its own height. */
const HIDE_THRESHOLD = 120

/**
 * Both scroll states ride data attributes, not a re-styled sx, so the
 * server render and every scroll position share one emotion class.
 */
const scrollSx: SxProps<Theme> = (theme) => ({
  transition: theme.transitions.create(['transform', 'box-shadow'], {
    duration: theme.transitions.duration.shorter,
  }),
  '& .MuiToolbar-root': {
    transition: theme.transitions.create('min-height', {
      duration: theme.transitions.duration.shorter,
    }),
  },
  '&[data-scrolled] .MuiToolbar-root': {
    // MUI's dense toolbar height.
    minHeight: theme.spacing(6),
  },
  '&[data-scroll-hidden]': {
    transform: 'translateY(-100%)',
  },
})

function withScrollSx(sx: AppBarProps['sx']): AppBarProps['sx'] {
  return [scrollSx, ...(Array.isArray(sx) ? sx : [sx])] as AppBarProps['sx']
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

interface ScrollAwareAppBarProps extends AppBarProps {
  shrink: boolean
  hide: boolean
}

/**
 * Its own component so the scroll listeners exist only on a bar that asked
 * to react — a hook behind a prop check would break the rules of hooks.
 * `ScrollReaction` answers both questions: past the threshold (shrink),
 * and scrolling down rather than up (hide), which is what MUI's scroll
 * trigger means by hysteresis.
 */
const ScrollAwareAppBar = forwardRef<HTMLElement, ScrollAwareAppBarProps>(
  ({ shrink, hide, ...props }, ref) =>
    createElement(ScrollReaction, {
      threshold: SHRINK_THRESHOLD,
      withHysteresis: { threshold: HIDE_THRESHOLD },
      children: ({ activeWithHysteresis, activeWithoutHysteresis }) =>
        renderAppBar(
          {
            ...props,
            sx: withScrollSx(props.sx),
            ...({
              'data-scrolled':
                shrink && activeWithoutHysteresis ? '' : undefined,
              'data-scroll-hidden':
                hide && activeWithHysteresis ? '' : undefined,
            } as AppBarProps),
          },
          ref,
        ),
    }),
)
ScrollAwareAppBar.displayName = 'AglynScrollAwareAppBar'

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
  ({ shrinkOnScroll, hideOnScroll, overHero, ...rest }, ref) => {
    const props = overHero ? { ...rest, sx: withOverHeroSx(rest.sx) } : rest
    return shrinkOnScroll || hideOnScroll
      ? createElement(ScrollAwareAppBar, {
          ...props,
          shrink: Boolean(shrinkOnScroll),
          hide: Boolean(hideOnScroll),
          ref,
        })
      : renderAppBar(props, ref)
  },
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
    {
      name: 'hideOnScroll',
      description:
        'Slides the bar up out of view while the visitor scrolls down, and ' +
        'back as soon as they scroll up. Pair with a Sticky or Fixed position.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Hide while scrolling down?',
    },
    {
      name: 'overHero',
      description:
        'On a page whose first band is set to run under the header, the bar ' +
        'sits over that photo with no background and white words. Other ' +
        'pages keep the bar as it is.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Sit over a photo hero?',
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
