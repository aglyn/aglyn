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
import { type SxProps, type Theme, useTheme } from '@mui/material/styles'
import useForkRef from '@mui/utils/useForkRef'
import { forwardRef, type ReactNode, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { imageSizes, layoutBandWidths } from '../utils/image-sizes'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'image'

/**
 * The node ids of the images that load eagerly: the first image the LAYOUT
 * chain renders and the first image the SCREEN renders, each in document
 * order (AGL-2486).
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
 * So the lead images get `loading="eager"` and the rest get
 * `fetchpriority="low"`, which is the browser-level knob that stops
 * below-the-fold images competing with the ones above them.
 *
 * ONE lead image was not enough. On any site whose header carries a logo, the
 * first image in document order is that logo, so the screen's own hero — the
 * element Lighthouse names as the LCP on aglyn.com's solution pages at
 * 375x812 — stayed `lazy` + `low`: undiscovered until layout, then fetched
 * behind every script on the page (measured 2026-09-08: 1.5 s of load delay
 * and 1.5 s of load time for a 13 KB image). Composition namespaces layout
 * nodes by origin ({@link Aglyn.isLayoutComposedNodeId}), so the walk keeps
 * one lead PER ORIGIN: the layout's first image (the logo) and the screen's
 * first image (the hero). A layout image further down — a mega-menu
 * illustration, the footer mark — is still deferred, as is every later
 * screen image. In the besigner canvas nothing is layout-composed, so the
 * screen's first image is the only lead, exactly as before.
 *
 * Only the SCREEN's lead can get `fetchpriority="high"` and a preload, and
 * only when nothing says it renders small (AGL-3485); the reasoning is at the
 * `fetchPriority` prop below. The layout's lead is the header logo on any
 * site that has one, which is why "first image" alone was never evidence.
 *
 * Resolved from the tree rather than a render-order counter on purpose: the
 * renderer walks the tree in document order on the server AND on hydrate, but
 * a mutable counter would double-count under React's concurrent re-renders
 * and hand the priority to a different image on the client than the one the
 * HTML gave it. A pure function of the tree cannot disagree with itself — and
 * it is deliberately NOT memoized on the root object, because the canvas
 * mutates that tree in place while an author works.
 *
 * The walk STOPS once both leads are known — on a page with a header logo
 * and a hero that is O(nodes above the hero), a dozen or two on a normal
 * page — and at the first image on a screen with no layout.
 *
 * An image with no `src` renders a placeholder box and no `<img>` at all, so
 * it cannot be the LCP element and is skipped.
 */
export function leadImageNodeIds(
  root: Aglyn.NodeSchema | undefined,
): readonly string[] {
  let layoutLead: string | undefined
  let screenLead: string | undefined
  const walk = (node: Aglyn.NodeSchema | undefined): boolean => {
    if (!node) return false
    if (node.componentId === ID) {
      const props = (node.resolvedProps ?? node.props ?? {}) as Record<
        string,
        unknown
      >
      if (String(props['src'] ?? '').trim()) {
        if (Aglyn.isLayoutComposedNodeId(node.$id)) {
          if (!layoutLead) layoutLead = node.$id
        } else if (!screenLead) {
          screenLead = node.$id
        }
        if (layoutLead && screenLead) return true
      }
    }
    for (const child of node.children ?? []) {
      if (walk(child)) return true
    }
    return false
  }
  walk(root)
  return [layoutLead, screenLead].filter((id): id is string => Boolean(id))
}

/**
 * The breakpoint band the theme says is in effect. Asked of the THEME, not of
 * the window: the Besigner canvas pins its theme's breakpoint helpers to the
 * previewed device (`createDevicePinnedTheme`), so on a pinned device this is
 * the device's band, and in Fluid Responsive it is the window's — which is
 * the band the canvas's own layout is answering to either way.
 */
function themeBand(theme: Theme): Aglyn.RenderedWidthBand {
  if (typeof window === 'undefined' || !window.matchMedia) return 'xs'
  for (const band of [...Aglyn.RENDERED_WIDTH_BANDS].reverse()) {
    if (band === 'xs') break
    const query = theme.breakpoints.up(band).replace(/^@media\s*/, '')
    if (window.matchMedia(query).matches) return band
  }
  return 'xs'
}

/**
 * The width of the page an element is laid out in. On the canvas that is the
 * shadow host the page renders into — narrower than the window, and the width
 * a share of "the viewport" has to be taken of.
 */
function pageWidthOf(element: HTMLElement): number {
  const root = element.getRootNode()
  const host =
    typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot
      ? (root.host as HTMLElement)
      : document.documentElement
  return host.clientWidth
}

/**
 * Records how wide this image renders on the Besigner canvas, per band, for
 * the save to write onto the node (AGL-3485, `rendered-widths.ts`). Inert
 * everywhere but the canvas. A `ResizeObserver` on the image and on the page
 * re-records as the author changes the layout, resizes the window or switches
 * device — a device switch also rebuilds the pinned theme, which re-runs this.
 */
function useRenderedWidthRecorder(
  nodeId: string,
  enabled: boolean,
): (element: HTMLElement | null) => void {
  const theme = useTheme()
  const [element, setElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled || !element || !nodeId) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      const percent = Aglyn.renderedWidthPercent(
        element.getBoundingClientRect().width,
        pageWidthOf(element),
      )
      if (percent !== undefined) {
        Aglyn.recordRenderedWidth(nodeId, themeBand(theme), percent)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const root = element.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
      observer.observe(root.host)
    }
    return () => observer.disconnect()
  }, [enabled, element, nodeId, theme])
  return setElement
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
   * The author's own `sizes` attribute, used exactly as typed (AGL-3485).
   * Empty — the normal case — lets the element work it out: see
   * `utils/image-sizes.ts`.
   */
  sizes?: string
  /**
   * How wide the image rendered on the Besigner canvas, per breakpoint band,
   * as a share of the page: written by the editor's save, never by an author
   * (AGL-3485, `rendered-widths.ts`).
   */
  renderedWidths?: Aglyn.RenderedWidths
  /**
   * The asset's current content hash, laid on by the composition from its
   * media document like the pixel pair below (AGL-3485). It makes the URL the
   * VERSIONED one, which every cache may keep for a year; a replace changes
   * it, and so the URL.
   */
  mediaVersion?: string
  /**
   * The asset's own pixel dimensions, copied off the media document when the
   * image was picked (AGL-2486), and read from the asset again when the page
   * is composed, so a replace with a different shape reaches every page that
   * places it (AGL-2833).
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
   * Read from the node like any other prop, so this element never fetches a
   * media document: the composition has already laid the asset's current
   * pair over the pick's (`media-asset-facts.ts`), and the pick's copy is
   * what renders wherever that read cannot answer. `srcSet` still selects
   * which variant is downloaded; these only say what shape it will be.
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
    sizes: authoredSizes,
    renderedWidths,
    mediaVersion,
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
   * lead images: the layout's first and the screen's first.
   *
   * `leafIdsMatch` rather than `===`: a reusable component instance suffixes
   * its leaf ids, so the id in the tree and the id in the context are the
   * same leaf spelled two ways (the markdown block resolves the same way).
   */
  const nodeId = Aglyn.useNodeId()
  const leadIds = nodeId ? leadImageNodeIds(Aglyn.canvas.rootNode) : []
  const isLeadImage = leadIds.some((leadId) =>
    Aglyn.leafIdsMatch(leadId, nodeId),
  )
  const screenLeadId = leadIds.find((id) => !Aglyn.isLayoutComposedNodeId(id))
  const isScreenLead =
    screenLeadId !== undefined && Aglyn.leafIdsMatch(screenLeadId, nodeId)
  const eager = loading === 'eager' || (loading == null && isLeadImage)
  // The canvas measures; nothing else does (AGL-3485).
  const { editorInert } = Aglyn.useScreenLink(undefined)
  const recordRef = useRenderedWidthRecorder(nodeId, Boolean(editorInert))
  const imageRef = useForkRef(ref, recordRef)
  /**
   * Resolve the stored value to a URL (AGL-1215). A media reference becomes
   * a CDN URL here rather than in the document, so the route shape stays an
   * app concern; every other value — a legacy firebasestorage URL, a legacy
   * `/api/media/cdn/…` path, an author-typed hotlink — passes through.
   *
   * `useSite().hostId` is the site being rendered: present on the tenant and
   * in Preview, absent in the besigner canvas. When it is there it names the
   * asking site in the org scope, which is what lets ONE reference in a
   * layout or reusable component resolve on each site that uses it.
   */
  const { hostId } = Aglyn.useSite()
  // With the asset's version when the composition read one (AGL-3485): the
  // versioned URL is the one every cache may keep, and a replace moves it.
  const src = Aglyn.resolveMediaSrc(storedSrc, {
    hostId,
    version: mediaVersion,
  })
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
    // The labeled box is for the author, so only editing surfaces draw it; a
    // published page renders the bare element.
    if (!suppressNavigation) return <Box ref={ref} {...rest} sx={nodeSx} />
    return (
      <Box
        ref={imageRef}
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
  // reference and a legacy stored path both keep their WebP variants. Any
  // other url has no candidates, and so no `sizes` either.
  //
  // The asset's own width caps the list (AGL-3486): the widest candidate is
  // the source, described truthfully, never a `1920w` for a 1000px photo that
  // the CDN can only answer with the same 1000 pixels.
  const srcSet = Aglyn.mediaCdnSrcSet(src, {
    sourceWidth:
      typeof intrinsicWidth === 'number' &&
      Number.isFinite(intrinsicWidth) &&
      intrinsicWidth > 0
        ? intrinsicWidth
        : undefined,
  })
  /**
   * How wide the image will render, for `sizes` (AGL-3485): the author's own
   * value, else per breakpoint a pixel width or height the element states (in
   * its attributes or its `sx`, responsive values included), what the
   * Besigner measured, and what the layout around it states. See
   * `utils/image-sizes.ts` for the order and for why none of it disturbs
   * layout the way `sizes="auto"` did (AGL-2486).
   *
   * The layout is read off the canvas tree this image is rendered from, which
   * the tenant fills on the server too, so the published HTML carries it.
   */
  const resolvedSizes = imageSizes({
    sizes: authoredSizes,
    width,
    height,
    sx: nodeSxProp,
    intrinsicWidth,
    intrinsicHeight,
    renderedWidths,
    layoutWidths: nodeId
      ? layoutBandWidths(Aglyn.canvas.getNode(nodeId) as never)
      : undefined,
  })
  /**
   * The page's hero: the SCREEN's lead image, loading eagerly, that nothing
   * says renders small. It gets `fetchpriority="high"`, which its preload
   * carries too (AGL-3485) — see `fetchPriority`. Only on a published page:
   * an editing surface has no first paint to win.
   */
  const hero =
    isScreenLead && eager && !resolvedSizes.small && !suppressNavigation
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
  const sizes = srcSet ? resolvedSizes.sizes : undefined
  return wrapLink(
    <Box
      ref={imageRef}
      component="img"
      src={src}
      // EVERY CANDIDATE IS A `?w=` URL, and the bare one is gone (2026-08-26).
      // Why that is worth 335 KB against 4 KB, and why each candidate merges
      // its width into the url's existing query, are documented where the list
      // and the builder live — `MEDIA_CDN_VARIANT_WIDTHS` and `mediaCdnSrcSet`
      // in `media-ref.ts`.
      //
      // Called rather than restated so the Markdown and entry-body renderers
      // can ask for the same list (AGL-3149). Building it here is the reason
      // they had none: a candidate list inside a component is a candidate list
      // no other component can have.
      srcSet={srcSet}
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
      // A delivery win may not be paid for in layout, which is why every
      // answer `imageSizes` gives is a real width of the slot (AGL-3485): the
      // author's own value, a definite pixel length, a span of a parent of
      // definite width, or the width the Besigner MEASURED this image at —
      // a fixed point, since an image whose intrinsic width is its measured
      // width lays out at its measured width. `100vw`, the value every
      // published document was authored against, is now only the last resort
      // for a band nothing describes.
      sizes={sizes}
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
      // `high` is a claim that this image outranks everything else in flight,
      // including the stylesheet and the webfont a TEXT LCP is waiting on, and
      // it went wrong once (AGL-2486): spent on "the first `<img>` in document
      // order", which is the HEADER LOGO on any site whose header has one.
      // Measured on aglyn.com at 375x812, the logo carrying it was 145x44 =
      // 6,380 px² against an `<h1>` of 38,893 px² that Lighthouse named as the
      // LCP — the hint made the real LCP arrive later.
      //
      // So it goes only to the page's HERO (AGL-3485), on two pieces of
      // evidence that did not exist then:
      //
      // - it is the SCREEN's lead image. The layout's lead — the logo — never
      //   qualifies, because composition says which origin each node has;
      // - nothing says it renders small. A pixel width of 240 or less, or under
      //   40% of the page in every band the Besigner measured or the layout
      //   states, marks a logo or an icon, and those keep the browser's `auto`.
      //
      // The preload is React's own: a server render emits
      // `<link rel="preload" as="image">` in the head for every image that is
      // not lazy, carrying its `srcset`, its `sizes` and this `fetchpriority`
      // — so the hero's request starts with the head, for the same bytes the
      // `<img>` will ask for, and nothing here restates it.
      //
      // Every other lead image — the layout's, or a small one — keeps
      // `loading="eager"` (the discovery fix that earned AGL-2486's win) and
      // the browser's own in-viewport ranking.
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
        ? {
            loading: 'eager' as const,
            ...(hero ? { fetchPriority: 'high' as const } : {}),
          }
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
    // Static: may sit in a subtree that keeps its server HTML (AGL-3581).
    lazyHydration: Aglyn.FEATURE_FLAG.ENABLED,
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
      // AGL-3485. Empty is the answer for nearly everyone: the image works
      // out how big it renders from where it sits on the page, measured as
      // the page is built. This is the override for someone who knows the
      // HTML attribute and wants to say it themselves.
      name: 'sizes',
      description:
        'Leave empty — the image works out how big it shows on every ' +
        'screen size from where you place it, and downloads a file that ' +
        'size. Advanced: an HTML sizes value used exactly as typed, e.g. ' +
        '(min-width: 900px) 33vw, 100vw.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Sizes',
    },
    {
      name: 'loading',
      description:
        'Lazy waits to load the image until a visitor scrolls near it; ' +
        'pick Eager for the first image at the top of a page so it ' +
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
        'Optional: navigate to this page when the image is clicked — ' +
        'follows the published path like a Page Link.',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Link to page',
    },
    {
      name: 'href',
      description:
        'Makes the image a link to somewhere off this site. Ignored while ' +
        'Link to page names one. Leave both blank and the image is not ' +
        'clickable at all.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
      // A bare `#fragment` saves and goes nowhere (AGL-2867).
      resolveProps: Aglyn.bareFragmentLinkFieldProps,
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
