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
import type { SxProps } from '@mui/material/styles'
import { forwardRef, type ReactNode } from 'react'
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
  /**
   * Explicit decorative choice (AGL-1305): ON forces `alt=""` (and drops
   * the tooltip) no matter what the alt field says, so screen readers skip
   * the image. Distinct from simply leaving alt unset, which also renders
   * `alt=""` today but records no intent.
   */
  decorative?: boolean
  /** Tooltip shown on hover — the native img `title` attribute. */
  title?: string
  /** Native loading hint; unset stays lazy, exactly as before AGL-1305. */
  loading?: 'lazy' | 'eager'
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
  /**
   * Authored node styles, handed over by the renderer rather than typed into
   * an attribute — recomposed below so the author's Styles-panel values are
   * merged rather than replaced (AGL-1240).
   */
  sx?: SxProps
  /**
   * Accepted and dropped: an `<img>` is a void element and React throws on
   * ANY children value reaching one, which 500'd whole pages (AGL-579).
   * Declared because the implementation deliberately discards it (AGL-1323).
   */
  children?: ReactNode
}

/**
 * Image element (AGL-74): renders a plain img with fit/size/radius
 * controls; an empty src shows a labeled placeholder so the element stays
 * visible and selectable in the editor.
 */
const Image = forwardRef<HTMLElement, ImageProps>((props, ref) => {
  const {
    src: storedSrc,
    alt,
    decorative,
    title,
    loading,
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
    // were being discarded on every published page (AGL-1240).
    sx: nodeSxProp,
    ...rest
  } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(nodeSxProp)
    ? nodeSxProp
    : nodeSxProp
      ? [nodeSxProp]
      : []
  // Optional link mode (AGL-339): screen id first (rename-safe), external
  // URL as fallback; suppressed in the besigner canvas like Screen Link.
  // Shared with every other linking element since AGL-1335, so a `Link`
  // component prop bound here behaves as it does on a Button.
  const { href: linkHref, suppressNavigation } = Aglyn.useLinkTarget(
    screenId,
    externalHref,
  )
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
        sx={[
          {
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
          },
          ...nodeSx,
        ]}
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
      // Unset alt keeps rendering `alt=""` exactly as it always has —
      // existing documents must not change output (AGL-1305). Decorative
      // ON forces `alt=""` over any alt text and suppresses the tooltip,
      // so the a11y intent is explicit rather than an accident of blank.
      alt={decorative ? '' : (alt ?? '')}
      title={decorative ? undefined : title || undefined}
      loading={loading === 'eager' ? 'eager' : 'lazy'}
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

/** Alt text and tooltip make no sense on an explicitly decorative image. */
const NOT_DECORATIVE = { when: 'decorative', is: true, notMatch: true }

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
      description: 'Describes the image for screen readers and search engines.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Alt text',
      // Hidden while Decorative is on — the renderer forces alt="" then,
      // but the text is kept on the node so toggling back restores it.
      condition: NOT_DECORATIVE,
    },
    {
      name: 'decorative',
      description:
        'Turn on when the image is purely decorative so screen readers ' +
        'skip it — no alt text is needed then.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Decorative image',
    },
    {
      name: 'title',
      description:
        'Optional tooltip shown when a visitor hovers over the image.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Tooltip',
      condition: NOT_DECORATIVE,
    },
    {
      name: 'objectFit',
      description: 'How the image fills its box.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Fit',
      // Both selects on this element take real sentinels (AGL-1451):
      // `cover` and `lazy` are members of their own declared prop unions
      // and the values the render already falls back to. As `''` neither
      // could persist (AGL-1191) — an image switched to Contain or Eager
      // could not be switched back.
      options: [
        { value: 'cover', label: 'Cover (default)' },
        { value: 'contain', label: 'Contain' },
        { value: 'fill', label: 'Fill' },
        { value: 'none', label: 'None' },
        { value: 'scale-down', label: 'Scale down' },
      ],
    },
    {
      name: 'width',
      description:
        'Width of the image — a number plus a unit, e.g. 100% or 320px.',
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
      name: 'loading',
      description:
        'Lazy waits to load the image until a visitor scrolls near it; ' +
        'pick Eager for the first image at the top of a screen so it ' +
        'shows immediately.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Loading',
      options: [
        { value: 'lazy', label: 'Lazy (default)' },
        { value: 'eager', label: 'Eager' },
      ],
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
