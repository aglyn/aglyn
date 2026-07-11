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
import { mdiImage } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'image'

export interface ImageProps {
  /** Image URL — usually a media-library download URL (AGL-72). */
  src?: string
  alt?: string
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
  /** CSS width (e.g. "100%", "320px"); defaults to 100%. */
  width?: string
  /** CSS height (e.g. "240px"); defaults to auto. */
  height?: string
  /** Border radius in px. */
  radius?: number
  /** Target screen id — resolved rename-safe like Screen Link (AGL-339). */
  screenId?: string
  /** External URL, used only when no `screenId` is set. */
  href?: string
}

// Only navigable protocols — mirrors ScreenLink's hardening.
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i

/**
 * Image element (AGL-74): renders a plain img with fit/size/radius
 * controls; an empty src shows a labeled placeholder so the element stays
 * visible and selectable in the editor.
 */
const Image = forwardRef<HTMLElement, ImageProps>((props, ref) => {
  const {
    src,
    alt,
    objectFit,
    width,
    height,
    radius,
    screenId,
    href: externalHref,
    ...rest
  } = props
  // Optional link mode (AGL-339): screen id first (rename-safe), external
  // URL as fallback; suppressed in the besigner canvas like Screen Link.
  const { href: resolvedHref, suppressNavigation } =
    Aglyn.useScreenLink(screenId)
  const safeExternalHref =
    externalHref && SAFE_HREF.test(externalHref.trim())
      ? externalHref.trim()
      : undefined
  const linkHref = screenId ? resolvedHref : safeExternalHref
  const wrapLink = (element: JSX.Element) =>
    linkHref && !suppressNavigation ? (
      <AppLink
        componentVariant="naked"
        href={linkHref}
        style={{ display: 'block' }}
      >
        {element}
      </AppLink>
    ) : (
      element
    )
  if (!src) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          width: width || '100%',
          height: height || 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: radius != null ? `${radius}px` : undefined,
          color: 'text.secondary',
          fontSize: 12,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {'Image — set a source URL'}
      </Box>
    )
  }
  // CDN URLs (AGL-175) carry WebP variants selected by `?w=`; widths
  // without a variant fall back to the original server-side, so a static
  // srcSet is safe for any CDN-form URL.
  const isCdnUrl = src.includes('/api/media/cdn/')
  return wrapLink(
    <Box
      ref={ref}
      component="img"
      src={src}
      srcSet={
        isCdnUrl
          ? [320, 640, 1280]
              .map((variant) => `${src}?w=${variant} ${variant}w`)
              .concat(`${src} 1920w`)
              .join(', ')
          : undefined
      }
      sizes={isCdnUrl ? '100vw' : undefined}
      alt={alt ?? ''}
      loading="lazy"
      {...rest}
      sx={{
        display: 'block',
        width: width || '100%',
        height: height || 'auto',
        objectFit: objectFit || 'cover',
        borderRadius: radius != null ? `${radius}px` : undefined,
      }}
    />,
  )
})
Image.displayName = 'Image'

export const schema: Aglyn.ComponentSchema<ImageProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Image',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: {
    path: mdiImage.path,
    sx: { color: '#7b1fa2' },
  },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'src',
      description:
        'Image URL. Upload files on the host Media page and use "Copy URL".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Source URL',
    },
    {
      name: 'alt',
      description:
        'Describes the image for screen readers and search engines.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Alt text',
    },
    {
      name: 'objectFit',
      description: 'How the image fills its box.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Fit',
      options: [
        { value: '', label: 'Cover (default)' },
        { value: 'contain', label: 'Contain' },
        { value: 'fill', label: 'Fill' },
        { value: 'none', label: 'None' },
        { value: 'scale-down', label: 'Scale down' },
      ],
    },
    {
      name: 'width',
      description: 'CSS width, e.g. 100% or 320px.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Width',
    },
    {
      name: 'height',
      description: 'CSS height, e.g. 240px. Leave empty for auto.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Height',
    },
    {
      name: 'screenId',
      description:
        'Optional: navigate to this screen when the image is clicked — ' +
        'follows the published path like a Screen Link.',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Link to screen',
    },
    {
      name: 'href',
      description: 'External URL used only when no screen is selected.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Image',
    pluginId: BUNDLE_ID,
    description: 'Image from your media library or any URL',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: {
      path: mdiImage.path,
      sx: { color: '#7b1fa2' },
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default Image
