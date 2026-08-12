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
import { mdiImageMultiple, mdiImageMultipleOutline } from '@aglyn/shared-data-mdi'
import MuiImageList from '@mui/material/ImageList'
import MuiImageListItem from '@mui/material/ImageListItem'
import MuiImageListItemBar from '@mui/material/ImageListItemBar'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const IMAGE_LIST_ID: Aglyn.ComponentId = 'muiImageList'
export const IMAGE_LIST_ITEM_ID: Aglyn.ComponentId = 'muiImageListItem'

export type ImageListVariant = 'standard' | 'quilted' | 'masonry' | 'woven'

export interface ImageListElementProps {
  cols?: number | string
  gap?: number | string
  /** Row height in px, or blank for `auto`. */
  rowHeight?: number | string
  variant?: ImageListVariant
  children?: ReactNode
}

export interface ImageListItemElementProps {
  /** Columns this tile spans (quilted lists). */
  cols?: number | string
  /** Rows this tile spans (quilted lists). */
  rows?: number | string
  /** Caption bar text; the bar is omitted entirely when both are blank. */
  title?: string
  subtitle?: string
  barPosition?: 'below' | 'top' | 'bottom'
  children?: ReactNode
}

/** Number fields round-trip as strings; MUI's grid math needs numbers. */
export function toCount(value: unknown, fallback?: number): number | undefined {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round(parsed)
}

/**
 * Image list (https://mui.com/material-ui/react-image-list/): a masonry
 * or quilted grid of images, denser than a Grid of cards.
 */
const ImageListElement = forwardRef<HTMLUListElement, ImageListElementProps>(
  (rawProps, ref) => {
    // Cleared props dropped before the resolvers below read them
    // (AGL-1451); `rest` also spreads straight into MUI.
    const props = dropClearedProps(rawProps)
    const { cols, gap, rowHeight, variant, children, ...rest } = props
    const resolvedVariant: ImageListVariant = (
      ['standard', 'quilted', 'masonry', 'woven'] as const
    ).includes(variant as ImageListVariant)
      ? (variant as ImageListVariant)
      : 'standard'
    const height = toCount(rowHeight)
    return (
      <MuiImageList
        ref={ref}
        variant={resolvedVariant}
        cols={toCount(cols, 3)}
        gap={toCount(gap, 4)}
        // A masonry list sizes rows from the images themselves; a fixed
        // rowHeight silently defeats the whole variant.
        rowHeight={resolvedVariant === 'masonry' ? 'auto' : height ?? 'auto'}
        {...rest}
        // MUI types ImageList's children as NonNullable; the renderer
        // always supplies the tile subtree.
        children={children as NonNullable<ReactNode>}
      />
    )
  },
)
ImageListElement.displayName = 'AglynImageList'

/**
 * One tile. The image itself is an ordinary Image element dropped
 * inside, so tiles keep the media-CDN srcSet, lazy loading and
 * empty-source placeholder (AGL-74/175) rather than a second, worse
 * image implementation living here.
 */
export const ImageListItemElement = forwardRef<
  HTMLLIElement,
  ImageListItemElementProps
>((rawProps, ref) => {
  const props = dropClearedProps(rawProps)
  const { cols, rows, title, subtitle, barPosition, children, ...rest } = props
  return (
    <MuiImageListItem
      ref={ref}
      cols={toCount(cols, 1)}
      rows={toCount(rows, 1)}
      {...rest}
    >
      {children}
      {title || subtitle ? (
        <MuiImageListItemBar
          title={title || undefined}
          subtitle={subtitle || undefined}
          position={barPosition || 'bottom'}
        />
      ) : null}
    </MuiImageListItem>
  )
})
ImageListItemElement.displayName = 'AglynImageListItem'

/** Row height is meaningless on masonry — MUI forces `auto` there. */
const NOT_MASONRY = { when: 'variant', is: 'masonry', notMatch: true }

export const imageListSchema: Aglyn.ComponentSchema<ImageListElementProps> = {
  $id: IMAGE_LIST_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Image List',
  description: 'Dense grid of images — standard, quilted, masonry or woven.',
  category: Aglyn.ComponentCategory.MEDIA,
  icon: { path: mdiImageMultiple.path, sx: { color: '#7b1fa2' } },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: [IMAGE_LIST_ITEM_ID] },
  ],
  attributes: [
    {
      name: 'variant',
      label: 'Variant',
      description:
        'Standard is a plain grid; quilted lets tiles span columns and ' +
        'rows; masonry keeps each image’s own aspect ratio; woven ' +
        'alternates tile sizes.',
      component: Aglyn.FieldComponentType.SELECT,
      // A real sentinel, not a deletion (AGL-1451): `standard` is one of
      // MUI's four named variants and the resolver above already accepts
      // it by name, so the option is a genuine choice — and the one an
      // author needs in order to move a list BACK off quilted or masonry.
      // Spelled `''` it could not persist (AGL-1191), so that move
      // silently reverted.
      options: [
        { value: 'standard', label: 'Standard (default)' },
        { value: 'quilted', label: 'Quilted' },
        { value: 'masonry', label: 'Masonry' },
        { value: 'woven', label: 'Woven' },
      ],
    },
    {
      name: 'cols',
      label: 'Columns',
      description: 'Number of columns. Default 3.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'gap',
      label: 'Gap',
      description: 'Space between tiles, in px. Default 4.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'rowHeight',
      label: 'Row height',
      description:
        'Row height in px. Leave blank to size rows from the images.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: NOT_MASONRY,
    },
  ],
}

export const imageListItemSchema: Aglyn.ComponentSchema<ImageListItemElementProps> =
  {
    $id: IMAGE_LIST_ITEM_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Image List Item',
    description: 'One tile of an image list, with an optional caption bar.',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: { path: mdiImageMultipleOutline.path, sx: { color: '#7b1fa2' } },
    attributes: [
      {
        name: 'title',
        label: 'Caption',
        description:
          'Caption bar text. Leave both caption fields blank for no bar.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'subtitle',
        label: 'Caption subtitle',
        description: 'Second line of the caption bar.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'barPosition',
        label: 'Caption position',
        description: 'Where the caption bar sits relative to the image.',
        component: Aglyn.FieldComponentType.SELECT,
        // `bottom` is MUI's own position value and the `|| 'bottom'`
        // fallback below already resolves to it, so the sentinel is the
        // value the code was reaching for anyway (AGL-1451).
        options: [
          { value: 'bottom', label: 'Bottom (default)' },
          { value: 'top', label: 'Top' },
          { value: 'below', label: 'Below the image' },
        ],
      },
      // The spans are read only by the quilted layout, but the variant
      // that decides that lives on the PARENT list. A `condition` is
      // evaluated against this node's own attribute form and cannot see
      // it, so these stay visible and say so in their help text — a
      // condition here would hide them permanently.
      {
        name: 'cols',
        label: 'Column span',
        description:
          'How many columns this tile spans. Only the parent list’s ' +
          'Quilted variant reads this.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
      {
        name: 'rows',
        label: 'Row span',
        description:
          'How many rows this tile spans. Only the parent list’s Quilted ' +
          'variant reads this.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
    ],
  }

const tile = (caption: string) => ({
  $id: null,
  componentId: IMAGE_LIST_ITEM_ID,
  pluginId: BUNDLE_ID,
  props: { title: caption },
  nodes: [
    {
      $id: null,
      componentId: 'image',
      pluginId: BUNDLE_ID,
      props: { alt: caption, height: '160px', objectFit: 'cover' },
    },
  ],
})

export const imageListPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(IMAGE_LIST_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Image List',
    pluginId: BUNDLE_ID,
    description: 'Three-column gallery with captioned tiles',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: imageListSchema.icon,
    data: {
      $id: null,
      componentId: IMAGE_LIST_ID,
      pluginId: BUNDLE_ID,
      props: { cols: 3, gap: 8, rowHeight: 160 },
      nodes: [tile('First image'), tile('Second image'), tile('Third image')],
    },
  },
  {
    $id: generatePresetId(IMAGE_LIST_ID, 'masonry'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Image List Masonry',
    pluginId: BUNDLE_ID,
    description: 'Gallery that keeps each image’s own aspect ratio',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: imageListSchema.icon,
    data: {
      $id: null,
      componentId: IMAGE_LIST_ID,
      pluginId: BUNDLE_ID,
      props: { variant: 'masonry', cols: 3, gap: 8 },
      nodes: [tile(''), tile(''), tile(''), tile('')],
    },
  },
  {
    $id: generatePresetId(IMAGE_LIST_ITEM_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Image List Item',
    pluginId: BUNDLE_ID,
    description: 'One more tile to add to an existing image list',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: imageListItemSchema.icon,
    data: tile(''),
  },
]

export default ImageListElement
