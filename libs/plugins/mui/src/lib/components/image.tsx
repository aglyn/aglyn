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

/**
 * The node id of the first image on the page, in document order (AGL-2486).
 *
 * Every image used to render `loading="lazy"` — the hero included. That is
 * the worst possible default for the one image that is almost always the LCP
 * element: a lazy image is not fetched until layout has run and the browser
 * has decided it is near the viewport, and it is fetched at LOW priority when
 * it finally is. Lighthouse reports that as "LCP request discovery", and it is
 * also why an image four sections down could finish before the one the reader
 * is looking at: with everything lazy and everything low, nothing outranked
 * anything, so the order was whatever the network felt like.
 *
 * So the first image gets `loading="eager"` and the rest get
 * `fetchpriority="low"`, which is the browser-level knob that stops
 * below-the-fold images competing with the one above it.
 *
 * The first image does NOT get `fetchpriority="high"` any more, and the
 * reasoning is at the `fetchPriority` prop below. Short version: this
 * function answers "which image is first", which was being read as "which
 * element is the LCP", and on any site with a logo in its header those are
 * different elements — measured on aglyn.com, where the logo took the hint
 * and the `<h1>` was the LCP at six times its area.
 *
 * Resolved from the tree rather than a render-order counter on purpose: the
 * renderer walks the tree in document order on the server AND on hydrate, but
 * a mutable counter would double-count under React's concurrent re-renders
 * and hand the priority to a different image on the client than the one the
 * HTML gave it. A pure function of the tree cannot disagree with itself.
 *
 * The walk STOPS at the first image, so it is O(nodes above the hero) — a
 * dozen nodes on a normal page — rather than a full traversal per image.
 *
 * An image with no `src` renders a placeholder box and no `<img>` at all, so
 * it cannot be the LCP element and is skipped.
 */
export function firstImageNodeId(
  root: Aglyn.NodeSchema | undefined,
): string | undefined {
  const walk = (node: Aglyn.NodeSchema | undefined): string | undefined => {
    if (!node) return undefined
    if (node.componentId === ID) {
      const props = (node.resolvedProps ?? node.props ?? {}) as Record<
        string,
        unknown
      >
      if (String(props['src'] ?? '').trim()) return node.$id
    }
    for (const child of node.children ?? []) {
      const found = walk(child)
      if (found) return found
    }
    return undefined
  }
  return walk(root)
}

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
  /**
   * The asset's own pixel dimensions, copied off the media document when the
   * image was picked (AGL-2486).
   *
   * NOT author controls, which is why neither appears in the schema below:
   * they describe the file, and the CSS `width`/`height` above describe the
   * placement. The pair becomes the `<img>`'s intrinsic `width`/`height`
   * attributes, which is the only thing that lets the browser reserve the
   * right box before the bytes arrive — with `width: 100%; height: auto` the
   * element is otherwise zero-height until the image decodes, and every image
   * on the page shifts the layout as it lands.
   *
   * An attribute pair is a RATIO here, not a size: CSS wins for the used
   * dimensions either way, so a stale value costs nothing but a reservation
   * of the wrong shape. Both must be present and positive or neither is
   * emitted — one alone gives the browser no ratio and would be read as a
   * real dimension.
   *
   * Written by the media picker, and read from the node like any other prop,
   * so nothing on the render path has to fetch a media document. `srcSet`
   * still selects which variant is downloaded; these only say what shape it
   * will be.
   */
  intrinsicWidth?: number
  /** See `intrinsicWidth` — the two are only ever used as a pair. */
  intrinsicHeight?: number
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
    intrinsicWidth,
    intrinsicHeight,
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
   * Eagerness (AGL-2486). An explicit author choice always wins — including
   * an explicit `lazy`, so someone who deliberately deferred the top image
   * keeps that. Only an UNSET `loading` is decided here, and only for the
   * first image on the page.
   *
   * `leafIdsMatch` rather than `===`: a reusable component instance suffixes
   * its leaf ids, so the id in the tree and the id in the context are the
   * same leaf spelled two ways (the markdown block resolves the same way).
   */
  const nodeId = Aglyn.useNodeId()
  const leadImageId = firstImageNodeId(Aglyn.canvas.rootNode)
  const isLeadImage =
    Boolean(nodeId) &&
    Boolean(leadImageId) &&
    Aglyn.leafIdsMatch(leadImageId as string, nodeId)
  const eager = loading === 'eager' || (loading == null && isLeadImage)
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
  /** A CSS width that is a plain pixel value, and therefore a real `sizes`. */
  const pinnedWidth = /^\d+(?:\.\d+)?px$/.test(String(width ?? '').trim())
    ? String(width).trim()
    : undefined
  /**
   * The intrinsic attribute pair, or nothing.
   *
   * Both-or-neither: the browser derives an aspect-ratio only from the pair,
   * and a lone `width` is read as a real dimension instead — which would
   * reserve a box of the wrong shape rather than no box at all. Finite and
   * positive because a media document may carry `0` or a partial capture
   * (dimensions are best-effort at upload), and `width="0"` collapses the
   * element.
   */
  const usable = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  const intrinsicAttributes =
    usable(intrinsicWidth) && usable(intrinsicHeight)
      ? { width: intrinsicWidth, height: intrinsicHeight }
      : undefined
  return wrapLink(
    <Box
      ref={ref}
      component="img"
      src={src}
      // EVERY CANDIDATE IS A `?w=` URL, and the bare one is gone (2026-08-26).
      //
      // The list used to be a literal `[320, 640, 1280]` with the BARE url
      // appended as `1920w` — the only candidate that is never WebP. With
      // `sizes="100vw"` below, any retina desktop needs more effective pixels
      // than 1280w offers, so that bare candidate is precisely the one most
      // desktop visitors download: measured on aglyn.com, 335 KB / 305 KB /
      // 164 KB PNG originals where the WebP variants are 4 KB / 4 KB / 5 KB.
      // Since ~94% of a media serve is bandwidth (AGL-1442), this was the
      // largest remaining media cost AND the page weight a visitor feels.
      //
      // `?w=1920` is byte-identical to the bare url until a 1920 variant
      // exists — `serveMediaCdn` serves the original for a width an asset does
      // not have — so this ships zero regression and picks up the saving the
      // moment the backfill runs, with no document or component change.
      //
      // Reading `MEDIA_CDN_VARIANT_WIDTHS` rather than restating it is the
      // other half: the literal here is why adding a width to the generator
      // never used to reach the markup.
      srcSet={
        isCdnUrl
          ? Aglyn.MEDIA_CDN_VARIANT_WIDTHS.map(
              (variant) => `${src}?w=${variant} ${variant}w`,
            ).join(', ')
          : undefined
      }
      // `sizes` is NOT only a delivery hint, and treating it as one broke every
      // fluid image (AGL-2486). With `w` descriptors the browser derives the
      // image's density-corrected INTRINSIC size from `sizes`, so `sizes` is
      // what a CSS `width: 100%` resolves against whenever the containing block
      // is content-sized — shrink-to-fit, inline-block, a flex item sized on its
      // content. Measured in Chrome at a 1200px viewport with the author CSS
      // `width:100%;height:auto;display:block`:
      //
      //   parent                        sizes=100vw   sizes=auto
      //   inline-block (shrink-to-fit)     1184px        300px
      //   block / fixed-width flex          900px        900px
      //
      // 300px is the spec's default object size, used because resolving `auto`
      // against a content-sized parent is circular. So `sizes="auto"` — which
      // genuinely does pick a better candidate, `?w=320` instead of a 357 KB
      // original in a 158px slot — rendered those images tiny and centred in
      // their box, on the canvas, in _preview and on published sites alike.
      //
      // A delivery win may not be paid for in layout, so this is back to
      // `100vw`: it overfetches, but it is the value every published document
      // was authored against. A pinned pixel width is still the better answer
      // where the author gave one, because it is a definite length and cannot
      // be circular. Getting image delivery right for fluid images needs the
      // media pipeline (a WebP variant at source width) or real intrinsic
      // `width`/`height` attributes from media metadata — neither of which
      // perturbs layout the way `sizes` does.
      sizes={isCdnUrl ? (pinnedWidth ?? '100vw') : undefined}
      // Unset alt keeps rendering `alt=""` exactly as it always has —
      // existing documents must not change output (AGL-1305). Decorative
      // ON forces `alt=""` over any alt text and suppresses the tooltip,
      // so the a11y intent is explicit rather than an accident of blank.
      alt={decorative ? '' : (alt ?? '')}
      title={decorative ? undefined : title || undefined}
      // The ordering signal, ONE-DIRECTIONAL on purpose (AGL-2486).
      //
      // `low` on every deferred image, so a footer image cannot be fetched
      // ahead of the section the reader is in. That half is safe in a way the
      // other half is not: deprioritising an image that is provably not being
      // looked at cannot starve whatever the LCP turns out to be.
      //
      // The lead image gets NO `fetchpriority` — the browser's `auto` — where
      // it used to get `high`. `high` is not a statement about this image, it
      // is a claim that this image outranks everything else in flight,
      // including the stylesheet and the webfont that a TEXT LCP is waiting
      // on. We are not in a position to make that claim: the only evidence
      // behind it was "first `<img>` in document order", and document order's
      // first image is the HEADER LOGO on any site whose header has one.
      //
      // Measured on aglyn.com at a 375x812 viewport, which is what sent this
      // back: the element carrying `fetchpriority="high"` was the logo at
      // 145x44 = 6,380 px², while the `<h1>` under it was 343x113 =
      // 38,893 px² — six times the area, and the element Lighthouse named as
      // the LCP. So the hint was being spent to make a text LCP arrive later.
      //
      // `auto` is not a retreat to the old behaviour. The old bug was that
      // everything was `lazy`, so the lead image was not discovered until
      // after layout; it still gets `loading="eager"` above, which is the
      // discovery fix and the part that actually earned the win. What goes is
      // only the RANKING claim, back to Chrome's own in-viewport heuristic —
      // which decides after layout, with the viewport and the geometry this
      // function provably does not have.
      //
      // Deliberately not replaced with a size heuristic: nothing here knows
      // the rendered size. `width`/`height` are optional author CSS strings,
      // routinely `100%`, and a logo constrained by its container measures
      // small while declaring nothing. A guess that fails the same way is not
      // an improvement on a guess.
      //
      // An author who genuinely has an image LCP should be able to SAY so —
      // but not through this control. The `loading` field is labelled
      // "Loading" and described in terms of lazy versus eager; an author
      // picking Eager for the top image is not asserting a priority ranking,
      // and reading one out of that choice is how the logo got `high` in the
      // first place. A real priority affordance needs its own control and its
      // own words. After September 1.
      // Decoding off the main thread for the deferred ones — they have no
      // paint deadline, and decoding them synchronously is main-thread time
      // spent on pixels nobody is looking at yet. The eager image keeps the
      // browser's default (`auto`) so it is free to decode in time to paint.
      //
      // The deferred set is `DEFERRED_IMAGE_ATTRIBUTES` rather than three
      // literals because every OTHER `<img>` a published page renders has to
      // land in the same rank to be ranked at all — a product grid, an event
      // list, a cart line. Those carried no hint whatsoever and so were
      // fetched EAGERLY, ahead of anything this component deferred. The set
      // is documented at its definition; the reasoning for each member is
      // the two paragraphs above and the two below.
      {...(eager
        ? { loading: 'eager' as const }
        : Aglyn.DEFERRED_IMAGE_ATTRIBUTES)}
      // Ahead of `{...rest}` so an author who has typed a literal width or
      // height attribute onto the node still wins, and ahead of `sx` because
      // these are ATTRIBUTES: the CSS block below sets the used size, and
      // these only supply the ratio it is laid out against. `Box` in this
      // version applies `styleFunctionSx` alone — it has no system-props
      // layer — so both forward to the `<img>` rather than becoming CSS.
      {...intrinsicAttributes}
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
  description:
    'A picture from your media library or any URL, with fit, size and an optional link.',
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
      // AGL-1896: "Browse media" now fills this in from the asset's own alt
      // text when it is empty, so the description says where the value came
      // from — otherwise a field that populates itself reads as a bug.
      description:
        'Describes the image for screen readers and search engines. ' +
        'Filled in from the media library when you pick a file that has ' +
        'alt text; anything you type here wins for this placement only.',
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
      description:
        'Makes the image a link to somewhere off this site. Ignored while ' +
        'Link to screen names one. Leave both blank and the image is not ' +
        'clickable at all.',
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
