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
  /**
   * Where the image comes from (AGL-72). Either a **media reference** —
   * `media:{scope}/{mediaId}`, what "Browse media" now stores (AGL-1215) —
   * or any URL, which covers both the legacy values already in published
   * documents and an author-typed hotlink. `resolveMediaSrc` decides.
   */
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
    src: storedSrc,
    alt,
    objectFit,
    width,
    height,
    radius,
    screenId,
    href: externalHref,
    // Never forward children to the <img> below — React throws on ANY
    // children value reaching a void element, which 500'd whole pages
    // when a renderer passed empty JSX children through (AGL-579).
    children: _children,
    // Pull `sx` out of the spread: the literals below are composed AFTER
    // `{...rest}`, so leaving it there REPLACED every style the author set
    // from the Styles panel. The hero mockups' 16px radius and drop shadow
    // were being discarded on every published page (AGL-1238).
    sx: nodeSxProp,
    ...rest
  } = props as ImageProps & { children?: unknown; sx?: unknown }
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(nodeSxProp) ? nodeSxProp : nodeSxProp ? [nodeSxProp] : []
  // Optional link mode (AGL-339): screen id first (rename-safe), external
  // URL as fallback; suppressed in the besigner canvas like Screen Link.
  const { href: resolvedHref, suppressNavigation } =
    Aglyn.useScreenLink(screenId)
  const safeExternalHref =
    externalHref && SAFE_HREF.test(externalHref.trim())
      ? externalHref.trim()
      : undefined
  const linkHref = screenId ? resolvedHref : safeExternalHref
  /**
   * Resolve the stored value to a URL (AGL-1215). A media reference becomes
   * a CDN URL here rather than in the document, so the route shape stays an
   * app concern; every other value — a legacy firebasestorage URL, a legacy
   * `/api/media/cdn/…` path, an author-typed hotlink — passes through.
   *
   * `useSite().hostId` is the site being rendered: present on the tenant,
   * absent in the besigner canvas and Preview. When it is there it names the
   * asking site in the org scope, which is what lets ONE reference in a
   * layout or reusable component resolve on each site that uses it.
   */
  const { hostId } = Aglyn.useSite()
  const src = Aglyn.resolveMediaSrc(storedSrc, { hostId })
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
        sx={[{
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
        }, ...nodeSx]}
      >
        {'Image — choose a source'}
      </Box>
    )
  }
  // CDN URLs (AGL-175) carry WebP variants selected by `?w=`; widths
  // without a variant fall back to the original server-side, so a static
  // srcSet is safe for any CDN-form URL. Asked of the RESOLVED url, so a
  // reference and a legacy stored path both keep their WebP variants.
  const isCdnUrl = Aglyn.isMediaCdnUrl(src)
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
      sx={[
        {
          display: 'block',
          width: width || '100%',
          height: height || 'auto',
          objectFit: objectFit || 'cover',
          borderRadius: radius != null ? `${radius}px` : undefined,
        },
        ...nodeSx,
      ]}
    />,
  )
})
Image.displayName = 'Image'

export const schema: Aglyn.ComponentSchema<ImageProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Image',
  category: Aglyn.ComponentCategory.MEDIA,
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
      // "Browse media" is the path an author should take (AGL-1215) — it
      // stores a reference to the asset, which survives moves, replaces and
      // any future change to how media is delivered. Typing a URL stays
      // supported for hotlinking somebody else's image; nobody should ever
      // be pasting one of OUR paths in here.
      description:
        'Pick from your media library with "Browse media", or paste the ' +
        'URL of an image hosted somewhere else.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Image source',
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
      description: 'Width of the image — a number plus a unit, e.g. 100% or 320px.',
      component: Aglyn.FieldComponentType.CSS_DIMENSION,
      label: 'Width',
    },
    {
      name: 'height',
      description: 'Height of the image. Leave empty for auto.',
      component: Aglyn.FieldComponentType.CSS_DIMENSION,
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
    category: Aglyn.ComponentCategory.MEDIA,
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
