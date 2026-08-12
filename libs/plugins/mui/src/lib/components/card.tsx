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
import { mdiCardOutline, mdiCardText, mdiGestureTap } from '@aglyn/shared-data-mdi'
import MuiCard from '@mui/material/Card'
import MuiCardActions from '@mui/material/CardActions'
import MuiCardContent from '@mui/material/CardContent'
import MuiCardHeader from '@mui/material/CardHeader'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'
import { toElevation } from './paper'

// Component ids are persisted in screen documents; never rename.
export const CARD_ID: Aglyn.ComponentId = 'muiCard'
export const CARD_HEADER_ID: Aglyn.ComponentId = 'muiCardHeader'
export const CARD_CONTENT_ID: Aglyn.ComponentId = 'muiCardContent'
export const CARD_ACTIONS_ID: Aglyn.ComponentId = 'muiCardActions'

export interface CardElementProps {
  variant?: 'elevation' | 'outlined'
  /** Shadow depth, 0–24; ignored on the outlined variant. */
  elevation?: number | string
  children?: ReactNode
}

export interface CardHeaderElementProps {
  title?: string
  subheader?: string
}

export interface CardActionsElementProps {
  /** If true, the 8px gap between action buttons is removed. */
  disableSpacing?: boolean
  children?: ReactNode
}

/**
 * Card (https://mui.com/material-ui/react-card/) — a Paper with card
 * padding conventions. Composed from separate Header/Content/Actions
 * elements rather than a single element with a dozen text props, so the
 * pieces are individually selectable, stylable and reorderable on the
 * canvas like everything else.
 */
const CardElement = forwardRef<HTMLDivElement, CardElementProps>(
  (rawProps, ref) => {
    // See PaperElement: cleared props are dropped before anything reads
    // them, so `rest` cannot carry a `null` into MUI (AGL-1451).
    const props = dropClearedProps(rawProps)
    const { variant, elevation, children, ...rest } = props
    const outlined = variant === 'outlined'
    return (
      <MuiCard
        ref={ref}
        variant={outlined ? 'outlined' : 'elevation'}
        // Same trap as Paper: a string elevation indexes MUI's shadow
        // array and yields a completely flat card.
        elevation={outlined ? undefined : toElevation(elevation)}
        {...rest}
      >
        {children}
      </MuiCard>
    )
  },
)
CardElement.displayName = 'AglynCard'

/**
 * Card header. `title`/`subheader` are plain strings: MUI wraps each in
 * its own Typography, and passing children instead would drop the
 * heading/subheading type scale a card header exists to provide.
 */
export const CardHeaderElement = forwardRef<
  HTMLDivElement,
  CardHeaderElementProps
>((props, ref) => {
  const { title, subheader, ...rest } = props as CardHeaderElementProps & {
    children?: unknown
  }
  // A header with neither string is invisible and unselectable on the
  // canvas; a placeholder keeps the node reachable.
  delete (rest as { children?: unknown }).children
  return (
    <MuiCardHeader
      ref={ref}
      title={title || (subheader ? undefined : 'Card title')}
      subheader={subheader || undefined}
      {...rest}
    />
  )
})
CardHeaderElement.displayName = 'AglynCardHeader'

export const CardContentElement = forwardRef<
  HTMLDivElement,
  { children?: ReactNode }
>((props, ref) => <MuiCardContent ref={ref} {...props} />)
CardContentElement.displayName = 'AglynCardContent'

export const CardActionsElement = forwardRef<
  HTMLDivElement,
  CardActionsElementProps
>((props, ref) => <MuiCardActions ref={ref} {...props} />)
CardActionsElement.displayName = 'AglynCardActions'

/** Elevation only means anything on the (default) `elevation` variant. */
const ELEVATION_ONLY = { when: 'variant', is: 'outlined', notMatch: true }

export const cardSchema: Aglyn.ComponentSchema<CardElementProps> = {
  $id: CARD_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Card',
  description:
    'Surface that groups a header, content and actions about one subject.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiCardOutline.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'variant',
      label: 'Variant',
      description:
        'Elevation raises the card with a shadow; outlined draws a border ' +
        'instead and has no shadow.',
      component: Aglyn.FieldComponentType.SELECT,
      // Same call as Paper (AGL-1451): a real sentinel, because `elevation`
      // is MUI's own value for the other half of this two-way choice and is
      // what the Elevation control is conditioned on. `''` could not
      // persist (AGL-1191).
      options: [
        { value: 'elevation', label: 'Elevation (default)' },
        { value: 'outlined', label: 'Outlined' },
      ],
    },
    {
      name: 'elevation',
      label: 'Elevation',
      description: 'Shadow depth from 0 (flat) to 24.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: ELEVATION_ONLY,
    },
  ],
}

export const cardHeaderSchema: Aglyn.ComponentSchema<CardHeaderElementProps> = {
  $id: CARD_HEADER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Card Header',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiCardText.path, sx: { color: '#2196f3' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'title',
      label: 'Title',
      description: 'The card heading.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'subheader',
      label: 'Subheader',
      description: 'Secondary line under the title.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const cardContentSchema: Aglyn.ComponentSchema = {
  $id: CARD_CONTENT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Card Content',
  description: 'The padded body region of a card.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiCardText.path, sx: { color: '#2196f3' } },
}

export const cardActionsSchema: Aglyn.ComponentSchema<CardActionsElementProps> =
  {
    $id: CARD_ACTIONS_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Card Actions',
    description: 'The button row at the bottom of a card.',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: { path: mdiGestureTap.path, sx: { color: '#2196f3' } },
    attributes: [
      {
        name: 'disableSpacing',
        label: 'Disable spacing?',
        description: 'If true, the gap between action buttons is removed.',
        component: Aglyn.FieldComponentType.SWITCH,
      },
    ],
  }

export const cardPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(CARD_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Card',
    pluginId: BUNDLE_ID,
    description: 'Image, heading, body text and an action button',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: cardSchema.icon,
    data: {
      $id: null,
      componentId: CARD_ID,
      pluginId: BUNDLE_ID,
      props: {},
      // Node-level sx (AGL-1346) — the record the Styles panel edits.
      sx: { maxWidth: 360 },
      nodes: [
        // The existing Image element rather than MUI's CardMedia: it
        // already carries the media-CDN srcSet, the lazy loading and the
        // empty-source placeholder (AGL-74/175), none of which is worth
        // re-implementing for a card.
        {
          $id: null,
          componentId: 'image',
          pluginId: BUNDLE_ID,
          props: { alt: '', height: '160px', objectFit: 'cover' },
        },
        {
          $id: null,
          componentId: CARD_HEADER_ID,
          pluginId: BUNDLE_ID,
          props: { title: 'Card title', subheader: 'Supporting line' },
        },
        {
          $id: null,
          componentId: CARD_CONTENT_ID,
          pluginId: BUNDLE_ID,
          nodes: [
            {
              $id: null,
              componentId: 'muiTypography',
              pluginId: BUNDLE_ID,
              props: {
                variant: 'body2',
                children:
                  'A short description of whatever this card is about.',
              },
            },
          ],
        },
        {
          $id: null,
          componentId: CARD_ACTIONS_ID,
          pluginId: BUNDLE_ID,
          nodes: [
            {
              $id: null,
              componentId: 'muiScreenLink',
              pluginId: BUNDLE_ID,
              props: { children: 'Learn more', renderAs: '', size: 'small' },
            },
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId(CARD_ID, 'outlined'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Card Outlined',
    pluginId: BUNDLE_ID,
    description: 'Text-only card with a border instead of a shadow',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: cardSchema.icon,
    data: {
      $id: null,
      componentId: CARD_ID,
      pluginId: BUNDLE_ID,
      props: { variant: 'outlined' },
      sx: { maxWidth: 360 },
      nodes: [
        {
          $id: null,
          componentId: CARD_CONTENT_ID,
          pluginId: BUNDLE_ID,
          nodes: [
            {
              $id: null,
              componentId: 'muiTypography',
              pluginId: BUNDLE_ID,
              props: { variant: 'h6', children: 'Card title' },
            },
            {
              $id: null,
              componentId: 'muiTypography',
              pluginId: BUNDLE_ID,
              props: {
                variant: 'body2',
                children: 'A short description of this card.',
              },
            },
          ],
        },
      ],
    },
  },
]

export default CardElement
