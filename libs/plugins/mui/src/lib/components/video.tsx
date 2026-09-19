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
import {
  readStoredVisitorConsent,
  VISITOR_CONSENT_CHANGED_EVENT,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import {
  wistiaMediaId,
  wistiaPlayerSrc,
} from '@aglyn/aglyn/app-utils/wistia-embed'
import { mdiPlay, mdiVideo } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import type { SxProps } from '@mui/material/styles'
import useEventCallback from '@mui/utils/useEventCallback'
import useForkRef from '@mui/utils/useForkRef'
import {
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { useVideoPlaybackBeacon } from './video-playback-beacon'
import { VideoPlayerFrame } from './video-player-frame'

/**
 * The lightbox, behind a lazy boundary rather than a plain import (AGL-2744).
 *
 * `video-lightbox.tsx` is the only module in the tenant's component graph that
 * names `@mui/material/Dialog`, and `plugin.ts` imports every element in this
 * bundle eagerly — so naming it here would put the whole MUI Dialog stack on
 * every published page of every customer site, which is precisely what
 * AGL-1290 took OFF those pages by withholding `dialog-confirm` and
 * `navigation-drawer` from the shared JSX barrel.
 *
 * Behind `lazy()` it is a chunk nothing on a first paint requests: not on a
 * page without a video, not on a page with one, only for a visitor who has
 * asked to watch. Same shape as `product-detail.tsx`'s Payment Element, for
 * the same reason.
 */
const VideoLightbox = lazy(() =>
  import('./video-lightbox').then((module) => ({
    default: module.VideoLightbox,
  })),
)

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'video'

/**
 * The width the poster is requested at.
 *
 * `<video poster>` takes ONE url and no `srcset`, so unlike `image.tsx` there
 * is no candidate list to hand the browser and no `sizes` to resolve against —
 * a single width has to serve every viewport. Asking for it is what turns a
 * 335 KB PNG poster into the 4 KB WebP the DAM already generated.
 *
 * Read from `@aglyn/aglyn` rather than restated: the page's `thumbnailUrl`
 * asks for the same width, and a crawler that fetches a different image from
 * the one a visitor sees is describing a different picture.
 */
const POSTER_REQUEST_WIDTH = Aglyn.MEDIA_CDN_POSTER_WIDTH

/** How much of a video the browser may fetch before anyone asks for it. */
export type VideoPreload = 'none' | 'metadata' | 'auto'

/**
 * What `preload` an unset field resolves to, given the rest of the node.
 *
 * Exported for the spec, because the whole point of this element is what it
 * does NOT download and a rule that is only asserted through rendered markup
 * is a rule three refactors from being an accident.
 *
 * * **Autoplay wins first.** A video that starts on its own needs its bytes
 *   by definition; `none` there is a hint every browser overrides anyway, and
 *   stating it would only mislead the next reader.
 * * **A poster buys `none`.** This is the saving the element exists for — the
 *   poster carries the first paint at image cost, and not one byte of video
 *   is fetched until a visitor presses play.
 * * **No poster keeps `metadata`.** With neither a poster nor metadata a
 *   `<video>` paints a black rectangle, so deferring an unpostered video
 *   trades a real transfer for a real regression. `metadata` is also what
 *   every document authored before this rendered, which is what makes the
 *   change safe for sites already published.
 */
export function resolveVideoPreload(options: {
  preload?: unknown
  poster?: unknown
  autoPlay?: unknown
}): VideoPreload {
  const { preload, poster, autoPlay } = options ?? {}
  if (preload === 'none' || preload === 'metadata' || preload === 'auto')
    return preload
  if (autoPlay) return 'auto'
  return poster ? 'none' : 'metadata'
}

export interface VideoProps {
  /**
   * Where the video comes from. Either a **media reference** —
   * `media:{scope}/{mediaId}`, what "Browse media" stores (AGL-1215) — or any
   * URL. `resolveMediaSrc` decides, exactly as it does for an image.
   *
   * A Wistia link is read differently (AGL-2826): the element keeps only the
   * media id and plays Wistia's own player, which loads when a visitor
   * presses play and never before, unless {@link loadPlayer} loads it with the
   * page. See `wistia-embed.ts`.
   */
  src?: string
  /**
   * The still shown before playback, and the element's entire first paint
   * once `preload` is `none`. A media reference or a URL, like `src`.
   *
   * Optional even for a poster-first placement: when the DAM captured a frame
   * at upload, {@link posterFromSource} says so and the element derives the
   * poster from the video's own reference.
   */
  poster?: string
  /**
   * The chosen asset has a poster the DAM generated (AGL-2749), served at
   * `?poster=1` on the video's own reference.
   *
   * Written by the pick, never by an author, and it is a flag rather than a
   * url on purpose: the url can be derived from `src` by anybody, but only
   * the media document knows whether it resolves to anything. A video
   * uploaded before AGL-2742 answers 404, and this is what keeps that 404 out
   * of an `<img>` and out of the page's `thumbnailUrl`.
   */
  posterFromSource?: boolean
  /**
   * The video's title (AGL-2741). Serves three jobs at once and is deliberate
   * about it: the `<video>`'s tooltip, the accessible name a screen reader
   * announces for the player, and `VideoObject.name` in the page's structured
   * data. One sentence an author writes once.
   */
  title?: string
  /**
   * What the video is about — `VideoObject.description`, which Google
   * recommends for a video rich result but does not require, so a blank one
   * drops only this field from the structured data. Never rendered as
   * visible text; the element is a player, not a caption.
   */
  description?: string
  /**
   * When the video was first published, as `YYYY-MM-DD`. Google requires it
   * beside the title and the poster, and it is the one nothing else on the
   * page can supply: a screen's own publish date is when the PAGE went up,
   * which for a film embedded months later is simply a different fact.
   *
   * The day is what an author types; the page's `VideoObject` publishes it as
   * that day at noon UTC, because Google reads `uploadDate` as a date-time
   * with a zone (`uploadDateTime` in the VideoObject builder).
   */
  uploadDate?: string
  /**
   * Running time in seconds. Copied off the media document when the DAM's
   * video pipeline publishes one (`Aglyn.videoMediaProps`) and read from the
   * asset again when the page is composed, so a replace reaches it
   * (AGL-2807); typed by the author otherwise, and omitted from the schema
   * when neither happened.
   */
  durationSeconds?: number
  /**
   * Show the poster as a play button and open the film in a dialog
   * (AGL-2744).
   *
   * Default OFF, so every document published before this keeps rendering the
   * inline player it was authored against. Requires a poster — there is
   * nothing to click without one — and falls back to inline playback when
   * there is none, rather than rendering a button with no face.
   *
   * A Wistia poster waits for a press whether this is on or off; the switch
   * decides only where its player opens, in the dialog or in place of the
   * poster. A Wistia player that {@link loadPlayer} put in the page stays in
   * the page either way.
   */
  lightbox?: boolean
  /**
   * Load a Wistia video's player with the page (AGL-2962), in place of the
   * poster and without autoplay, for a visitor whose stored consent grants
   * analytics.
   *
   * For a page built to show this one film. A search engine lists a video
   * only from a page whose main content it is, and it can only find a player
   * that is in the page once the page has loaded; a poster that must be
   * pressed first is the case Search Console reports as "Cannot determine
   * video position and size".
   *
   * Default OFF, so every document published before this renders the poster
   * it was authored against. No effect on any other source: a library film or
   * a video URL already renders its `<video>` into the page's HTML. The
   * page-load state below says who gets the player and when.
   */
  loadPlayer?: boolean
  /** Captions file — a WebVTT (`.vtt`) URL or media reference. */
  captionsSrc?: string
  /** What the captions track is called in the player's menu. */
  captionsLabel?: string
  /** BCP-47 language tag for the captions, e.g. `en`. */
  captionsLang?: string
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
  /**
   * Play inline on a phone rather than taking over the screen. Defaults ON,
   * which is what this element has always rendered — it is a control now
   * because a full-screen takeover is a legitimate choice for a film and
   * there was no way to ask for it.
   */
  playsInline?: boolean
  /** See {@link resolveVideoPreload}; unset is decided from the node. */
  preload?: VideoPreload
  /** CSS width (e.g. "100%", "640px"); defaults to 100%. */
  width?: string
  /** CSS height (e.g. "360px"); defaults to auto. */
  height?: string
  /**
   * The asset's own pixel dimensions, copied off the media document when the
   * video was picked (AGL-2741) — the same pair, by the same route and for
   * the same reason, as `image.tsx` — and read from the asset again when the
   * page is composed, so a replace with a different shape resizes the player
   * (AGL-2807).
   *
   * NOT author controls, which is why neither appears in the schema below.
   * They describe the file; the CSS `width`/`height` above describe the
   * placement. Here they become a CSS `aspect-ratio` rather than the HTML
   * attribute pair an `<img>` gets, because a `<video>`'s `width`/`height`
   * content attributes are used dimensions, not a ratio — writing them would
   * pin the element to the file's pixel size instead of reserving its shape.
   *
   * The stake is higher than it is for an image. An `<img>` with no ratio is
   * zero-height until its bytes decode; a `<video preload="none">` with no
   * ratio is zero-height until somebody presses play, which on most pages is
   * never.
   */
  intrinsicWidth?: number
  /** See `intrinsicWidth` — the two are only ever used as a pair. */
  intrinsicHeight?: number
  /** Border radius in px. */
  radius?: number
  /**
   * Authored node styles, handed over by the renderer rather than typed
   * into an attribute — recomposed below so the Styles panel's values are
   * merged rather than replaced (AGL-1284).
   */
  sx?: SxProps
  /**
   * Accepted and dropped. The element is `selfClosing`, so the besigner never
   * gives it children; the `<track>` below is the renderer's own child and
   * anything arriving through the tree would land beside it.
   */
  children?: ReactNode
}

/**
 * Video element (AGL-162, AGL-2741): plays a media-library upload, any URL or
 * a Wistia video (AGL-2826), poster first.
 *
 * The default is now to download NOTHING until a visitor asks. A poster is an
 * image — a few tens of kilobytes through the DAM's WebP variants, edge-cached
 * — while the video behind it is not edge-cacheable at all and is measured in
 * megabytes. `preload` decides which of those a page pays for on first paint,
 * and {@link resolveVideoPreload} explains what an unset field resolves to.
 *
 * An empty src shows a labeled placeholder so the element stays selectable in
 * the editor.
 */
const Video = forwardRef<HTMLElement, VideoProps>((props, ref) => {
  const {
    src: storedSrc,
    poster: storedPoster,
    posterFromSource,
    title,
    // Structured-data-only fields. Every one of them MUST be destructured:
    // what is left in `rest` is spread onto the `<video>`, where a
    // `description` or an `uploadDate` becomes an invalid DOM attribute in
    // the published HTML.
    description: _description,
    uploadDate: _uploadDate,
    durationSeconds: _durationSeconds,
    lightbox,
    loadPlayer,
    captionsSrc,
    captionsLabel,
    captionsLang,
    autoPlay,
    loop,
    muted,
    controls,
    playsInline,
    preload,
    width,
    height,
    intrinsicWidth,
    intrinsicHeight,
    radius,
    children: _children,
    // Pulled out of the spread: the literals below are composed AFTER
    // `{...rest}`, so leaving it there REPLACES every style the author set
    // from the Styles panel (AGL-1240, the same trap image.tsx documents).
    sx: nodeSxProp,
    ...rest
  } = props
  const nodeSx = Array.isArray(nodeSxProp)
    ? nodeSxProp
    : nodeSxProp
      ? [nodeSxProp]
      : []
  // Both fields are media-picker targets, so both can hold a media
  // reference (AGL-1215) as well as any of the URL forms that predate it.
  // Resolving here is not optional: the picker hands back one string for
  // whichever attribute asked for it, so every field it can write to has to
  // understand the same value.
  const { hostId } = Aglyn.useSite()
  /**
   * The delivery copy, not the master (AGL-2753).
   *
   * `videoDeliverySrc` is `resolveMediaSrc` plus `?r=auto`, which asks the CDN
   * for the best encoding it holds instead of naming one. The element cannot
   * name one: renditions are produced out of band by
   * `tools/scripts/generate-video-renditions.mjs`, minutes or days after the
   * upload, so at pick time an asset usually has none and a copied list would
   * be empty for exactly the videos it exists to serve. Asking rather than
   * naming is what lets an encoding made tomorrow reach a video placed today,
   * with no re-pick and nothing rewritten in a published document.
   *
   * Nothing here is conditional on the asset having renditions, because the
   * URL degrades to the master by construction — which is the file this
   * served before, so a page cannot get worse by adopting it.
   */
  const src = Aglyn.videoDeliverySrc(storedSrc, { hostId })
  // Two candidates, one rule, shared with the page's `thumbnailUrl`: the
  // author's own poster wins, and the DAM's generated frame is used only when
  // the node records that one exists (AGL-2749).
  const posterFor = (width?: number) =>
    Aglyn.videoPosterSrc({
      hostId,
      poster: storedPoster,
      src: storedSrc,
      generated: posterFromSource,
      width,
    })
  /** Full size — what an `<img>` wants beside a `srcSet` of widths. */
  const posterBase = posterFor()
  /** One width — what `<video poster>` and a `thumbnailUrl` have to take. */
  const poster = posterFor(POSTER_REQUEST_WIDTH)
  const captions = Aglyn.resolveMediaSrc(captionsSrc, { hostId })
  /**
   * The lightbox's two pieces of state, and they are deliberately two.
   *
   * `open` is what the dialog reads. `armed` is whether the chunk has been
   * ASKED for, which happens on the first hover or focus rather than on the
   * click — so by the time a visitor's pointer has travelled from the poster
   * to the play badge, the module is usually already there and the dialog
   * opens on the same frame as the click. A visitor who never goes near the
   * poster never arms it and never fetches it, which is the whole bargain.
   *
   * `armed` never goes back to false. Re-mounting `lazy()` after a close
   * would not re-download anything (the module is resolved), and leaving it
   * mounted is what lets a second open be instant.
   */
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const arm = useCallback(() => setArmed(true), [])
  const closeLightbox = useCallback(() => setOpen(false), [])
  const openLightbox = useCallback(() => {
    setArmed(true)
    setOpen(true)
  }, [])
  /**
   * The besigner canvas is inert (AGL-830): opening a focus-trapping dialog
   * inside the editor would steal the author's keyboard mid-edit, and the
   * click on a poster there means "select this node", not "watch this".
   * The trigger still RENDERS as a button, because what an author sees on the
   * canvas has to be what a visitor gets.
   */
  const { editorInert, suppressNavigation } = Aglyn.useScreenLink(undefined)
  /**
   * What a play is counted against (AGL-2781): the site, the asset the STORED
   * value names, and whether this surface is an editor. Handed to the
   * lightbox as data rather than as handlers, because a play there belongs to
   * one open of the dialog and only the dialog knows when that begins.
   */
  const playback = { hostId, src: storedSrc, suppressed: suppressNavigation }
  const playbackHandlers = useVideoPlaybackBeacon(playback)
  /**
   * A Wistia video (AGL-2826), and the player address a press produced.
   *
   * Unless the page loads the player (see `pageLoadSrc` below), nothing of
   * Wistia's renders before that press. The poster is a button, as it is for
   * the lightbox, so a visitor who only looks at the page makes no request to
   * Wistia and is handed no storage by it. `playerSrc` stays empty until the
   * press, and setting it is what brings the frame in.
   */
  const wistiaId = wistiaMediaId(storedSrc)
  const [playerSrc, setPlayerSrc] = useState<string>()
  /**
   * The press. Consent is read here and not during render: the record lives
   * in this browser's storage, which a cached page cannot vary on, and a
   * visitor may answer the banner between the first paint and the click.
   *
   * Wistia records the viewing only when this visitor's analytics consent is
   * on record. A visitor without that record — still deciding, refused,
   * opted out by GPC, or visiting a site that runs no consent banner — gets
   * the player with `doNotTrack`.
   */
  const playWistia = useCallback(() => {
    setPlayerSrc(
      wistiaPlayerSrc(storedSrc, {
        doNotTrack: !readStoredVisitorConsent(hostId)?.analytics,
        muted: Boolean(muted),
        loop: Boolean(loop),
      }),
    )
  }, [storedSrc, hostId, muted, loop])
  /**
   * The player address "Load the player with the page" produced (AGL-2962):
   * Wistia's player without autoplay, in place of the poster before anyone has
   * pressed anything, so a search engine rendering the page finds the player
   * in it.
   *
   * Only for a visitor whose stored consent grants analytics, which is why the
   * address never carries `doNotTrack`. The unpressed frame is not free of
   * storage: measured on 2026-09-14 in headless Chrome, it set no cookie but
   * wrote two keys to its own `localStorage`, a random resume key and a record
   * of its load times, with `doNotTrack` on as well as off. A visitor in a
   * prior-consent region has to say yes before that. Everyone else keeps the
   * poster, and a press on it loads the player as it does with the switch
   * off, `doNotTrack` included.
   *
   * Set from an effect and never during render, for the reason a press reads
   * consent at the click: the record is in this browser's storage, which the
   * server HTML and the first paint cannot vary on, so both are the poster for
   * every visitor. The effect reads the record on mount and again on every
   * consent change, because the decision can land after the element mounts:
   * the implied default is recorded when the region lookup answers, and a
   * banner is answered whenever the visitor gets to it. A withdrawal before
   * any press on the element puts the poster back, even over a film started
   * from the play button inside Wistia's frame, which the element cannot see.
   *
   * Never on the besigner canvas, where the poster button is inert too, and
   * never for a Wistia video without a poster, which has no first paint to
   * give. A press ends it: from then on the pressed address is the one in the
   * frame, and a later change of consent moves nothing, as it moves nothing
   * for a player a press loaded with the switch off.
   */
  const [pageLoadSrc, setPageLoadSrc] = useState<string>()
  useEffect(() => {
    if (!loadPlayer || !wistiaId || !poster || editorInert || playerSrc) {
      return undefined
    }
    const sync = () =>
      setPageLoadSrc(
        readStoredVisitorConsent(hostId)?.analytics
          ? wistiaPlayerSrc(storedSrc, {
              autoPlay: false,
              muted: Boolean(muted),
              loop: Boolean(loop),
            })
          : undefined,
      )
    sync()
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
  }, [
    loadPlayer,
    wistiaId,
    poster,
    editorInert,
    playerSrc,
    hostId,
    storedSrc,
    muted,
    loop,
  ])
  /** Read through the switch, so switching it off removes a loaded player. */
  const loadedSrc = loadPlayer ? pageLoadSrc : undefined
  /**
   * The address of the Wistia player standing in place of the poster, if one
   * is: a pressed player while the lightbox is off, and a player the page
   * loaded whatever the lightbox is set to. The pressed address outranks the
   * loaded one, because it is the one that plays.
   */
  const inPlaceSrc =
    wistiaId && (!lightbox || loadedSrc) ? (playerSrc ?? loadedSrc) : undefined
  /**
   * What pressing the poster does. The poster's own button and a press sent
   * from outside the element both call this one function, so the two cannot
   * come to disagree about what a press is.
   *
   * A player the page loaded is already in place, so a press plays it there
   * and never opens the lightbox.
   */
  const press = () => {
    if (wistiaId) playWistia()
    if (lightbox && !loadedSrc) openLightbox()
  }
  /**
   * A press sent from outside the element (AGL-2867) — a "Play a video"
   * interaction on a button elsewhere on the page — answered as the markup
   * rendered below would answer a press on it, branch for branch:
   *
   * - nothing that can play (no source, or a Wistia video with no poster):
   *   nothing happens;
   * - a Wistia player a press put in place of its poster: it is playing
   *   already;
   * - a Wistia player the page loaded and nothing has pressed: `press()`,
   *   whose autoplaying address replaces the loaded one. That is what the play
   *   button inside the frame does, and the element cannot reach that button
   *   across Wistia's origin, so a film already started from it starts over;
   * - a poster that is a button: that button's own press, which reads consent
   *   at that moment and is the only thing that ever loads the lightbox chunk
   *   or a player the page did not load;
   * - the inline player: `play()`, which is what a press on it does.
   *
   * Inert on the besigner canvas, as the poster button is, for the same
   * reason: nothing may load a player or open a dialog inside the editor.
   *
   * `useEventCallback`, not React's `useEffectEvent`: in the React this repo
   * runs, an effect event declared in a `forwardRef` component is never
   * handed the implementation from later renders, so a listener added once
   * would go on answering with the props of the first one.
   */
  const answerVideoCommand = useEventCallback((element: HTMLElement) => {
    if (editorInert || !src) return
    if (wistiaId && !poster) return
    if (inPlaceSrc && playerSrc) return
    if ((lightbox || wistiaId) && poster) return press()
    if (element instanceof HTMLVideoElement) {
      // A play the browser refuses (a trigger that was not a press, on an
      // unmuted film) is the browser's decision to make, not an error.
      void Promise.resolve(element.play()).catch(() => undefined)
    }
  })
  /**
   * The element's own DOM root, which receives the command. State rather than
   * a ref object, because the root is a different element in different
   * branches — the inline `<video>`, or the box around a poster — and the
   * listener has to follow it.
   */
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const rootRef = useForkRef(ref, setRoot)
  useEffect(() => {
    if (!root) return undefined
    return Aglyn.subscribeVideoCommands(root, () => answerVideoCommand(root))
  }, [root, answerVideoCommand])
  /**
   * The labeled box the element shows when it has nothing it can play. The
   * label is for the author, so only editing surfaces draw it; a published
   * page renders the bare element.
   */
  const placeholder = (label: string) =>
    suppressNavigation ? (
      <Box
        ref={rootRef}
        {...rest}
        sx={[
          {
            width: width || '100%',
            height: height || 180,
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
        {label}
      </Box>
    ) : (
      <Box ref={rootRef} {...rest} sx={nodeSx} />
    )
  if (!src) return placeholder('Video — set a source URL')
  /**
   * The reserved box, as a ratio rather than a size.
   *
   * Both-or-neither and finite-and-positive for the reasons `image.tsx` gives
   * at its own pair: a lone dimension describes no shape, and a capture may
   * legitimately be `0` or missing. Suppressed when the author pinned a
   * `height`, because then the box is already definite and a ratio would only
   * fight the value they typed.
   */
  const usable = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  const aspectRatio =
    !height && usable(intrinsicWidth) && usable(intrinsicHeight)
      ? `${intrinsicWidth} / ${intrinsicHeight}`
      : undefined
  const track = captions ? (
    // `default` so the track is selected without the visitor hunting for it
    // in the player's menu. A captions file an author took the trouble to
    // attach is one they meant people to see, and the browser still offers
    // the switch that turns it off.
    <track
      kind="captions"
      src={captions}
      srcLang={captionsLang || undefined}
      label={captionsLabel || undefined}
      default
    />
  ) : null
  /**
   * A Wistia video with no poster has nothing to press, and the alternative —
   * loading the player up front for every visitor — is the request this
   * element exists to withhold. So it says what it needs instead, with "Load
   * the player with the page" on as well: the poster is that switch's server
   * HTML and first paint, and what every visitor without analytics consent
   * goes on seeing.
   */
  if (wistiaId && !poster) {
    return placeholder('Video — add a poster image to play this Wistia video')
  }
  /**
   * The Wistia player in place of the poster: after a press when the lightbox
   * is off, or loaded with the page (AGL-2962). The wrapper is the same element
   * the poster sat in, so the node's styles and ref stay where they were and
   * only its contents change.
   */
  if (inPlaceSrc) {
    return (
      <Box
        ref={rootRef}
        {...rest}
        sx={[
          {
            display: 'block',
            position: 'relative',
            width: width || '100%',
            height: height || 'auto',
          },
          ...nodeSx,
        ]}
      >
        <VideoPlayerFrame
          // A press on a player the page loaded mounts a new frame rather than
          // handing the loaded one a new address. Navigating a frame that has
          // already loaded a document adds an entry to the tab's history, so
          // Back would first take the frame back to the unpressed player
          // instead of leaving the page. Measured on 2026-09-14 in Chrome 154:
          // a new `src` on a loaded frame took `history.length` from 1 to 2,
          // and a new frame element in its place added nothing.
          key={playerSrc ? 'pressed' : 'loaded'}
          src={inPlaceSrc}
          title={title}
          aspectRatio={aspectRatio}
          height={height}
          radius={radius}
          // Focus follows a press into the player. A player the page loaded
          // takes none: nobody asked for it, and focusing a frame as the page
          // loads would scroll the page to it and take the keyboard with it.
          focusOnMount={Boolean(playerSrc)}
        />
      </Box>
    )
  }
  /**
   * Poster-first, dialog on click (AGL-2744).
   *
   * Requires a poster, and falls back to the inline player without one rather
   * than rendering a button with no face. That is not a limitation to work
   * around — a lightbox trigger with nothing to show is a blank rectangle
   * that claims to be a film.
   *
   * A Wistia video takes this branch until a player stands in place of its
   * poster (AGL-2826), which includes the server HTML and first paint of one
   * that loads its player with the page. With the lightbox off its press swaps
   * the player in above, and the lazy dialog is never armed, because nothing is
   * going to open it.
   */
  if ((lightbox || wistiaId) && poster) {
    const playsInPlace = Boolean(wistiaId) && !lightbox
    return (
      <Box
        ref={rootRef}
        {...rest}
        sx={[
          {
            display: 'block',
            position: 'relative',
            width: width || '100%',
            height: height || 'auto',
          },
          ...nodeSx,
        ]}
      >
        <Box
          component="button"
          type="button"
          // Inert on the canvas: a focus-trapping dialog opened inside the
          // editor would take the author's keyboard away mid-edit, and the
          // click there means "select this node". Same shape as the Drawer's
          // `editorInert ? undefined : handler`. It is also why a hosted
          // player never loads into the canvas.
          onClick={editorInert ? undefined : press}
          // Arming on hover and on focus, not on click, is what makes the
          // dialog open on the same frame as the press — and it costs a
          // visitor who never approaches the poster nothing at all.
          onPointerEnter={editorInert || playsInPlace ? undefined : arm}
          onFocus={editorInert || playsInPlace ? undefined : arm}
          // The button IS the play control, so it says so. Without a title it
          // still announces its purpose rather than reading as an image.
          aria-label={title ? `Play video: ${title}` : 'Play video'}
          sx={{
            // A button reset: the poster is the control, so none of the
            // browser's own chrome should show through it.
            appearance: 'none',
            border: 0,
            p: 0,
            m: 0,
            display: 'block',
            width: '100%',
            font: 'inherit',
            color: 'inherit',
            background: 'none',
            cursor: editorInert ? 'default' : 'pointer',
            position: 'relative',
            overflow: 'hidden',
            borderRadius: radius != null ? `${radius}px` : undefined,
            // The focus ring is the theme's, not a literal: a keyboard
            // visitor has to be able to see where they are on a poster of
            // unknown brightness.
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.dark',
              outlineOffset: 2,
            },
          }}
        >
          <Box
            component="img"
            src={posterBase}
            // The poster is an `<img>` here rather than a `<video poster>`,
            // which is the one advantage this mode has over the inline one:
            // an `<img>` takes the DAM's whole candidate list, so a phone
            // downloads `?w=320` where the inline player has to be handed a
            // single width for every viewport.
            srcSet={
              Aglyn.isMediaCdnUrl(posterBase)
                ? Aglyn.MEDIA_CDN_VARIANT_WIDTHS.map((variant) => {
                    // Built through the same rule as the src, not by pasting
                    // `?w=` onto it: a generated poster's url already carries
                    // `?poster=1`, so a hand-appended query would produce
                    // `?poster=1?w=320` and 404 every candidate.
                    const candidate = posterFor(variant)
                    return candidate ? `${candidate} ${variant}w` : ''
                  })
                    .filter(Boolean)
                    .join(', ')
                : undefined
            }
            sizes={Aglyn.isMediaCdnUrl(posterBase) ? '100vw' : undefined}
            // Empty by design. The button's `aria-label` already names the
            // film and its purpose; alt text here would make a screen reader
            // read the same thing twice, once as a control and once as a
            // picture.
            alt=""
            // No `loading` hint, deliberately — see `deferred-images.spec`,
            // where this element is exempt. A poster is the entire visual of
            // a media element an author placed on purpose, and a browser
            // fetches `<video poster>` eagerly too, so deferring it would be
            // a regression against what this element rendered yesterday
            // rather than a saving.
            decoding="async"
            sx={{
              display: 'block',
              width: '100%',
              height: height || 'auto',
              objectFit: 'cover',
              aspectRatio,
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // A poster is a frame of unknown brightness, and this control
              // has to separate from all of them. A solid disc does; the
              // translucent scrim it replaced sank into any dark frame.
              width: { xs: 64, sm: 80, md: 96 },
              height: { xs: 64, sm: 80, md: 96 },
              borderRadius: '50%',
              // The site's accent, not a literal. A play control is the one
              // mark on a poster that should read as the brand's, so it takes
              // the theme's primary the way every other accented glyph does.
              color: 'primary.main',
              bgcolor: 'common.white',
              boxShadow: 6,
              // Gated in CSS rather than behind a JS branch, so toggling the
              // OS setting after load resolves in BOTH directions — the same
              // reason `element-animation-assets` puts every rule it has
              // inside this query.
              '@media (prefers-reduced-motion: no-preference)': {
                transition: 'transform 150ms, color 150ms',
                'button:hover &, button:focus-visible &': {
                  transform: 'translate(-50%, -50%) scale(1.08)',
                  color: 'primary.dark',
                },
              },
            }}
          >
            <MdiIcon
              path={mdiPlay.path}
              sx={{ fontSize: { xs: 32, sm: 40, md: 48 }, ml: '4px' }}
            />
          </Box>
        </Box>
        {armed ? (
          // `fallback={null}`: the poster is still on screen underneath, so
          // there is nothing to cover and a spinner would only flash. The
          // chunk is usually resolved before the click anyway.
          <Suspense fallback={null}>
            <VideoLightbox
              open={open}
              onClose={closeLightbox}
              title={title}
              src={src}
              poster={poster}
              aspectRatio={aspectRatio}
              loop={loop}
              muted={muted}
              captions={track}
              playback={playback}
              embedSrc={wistiaId ? playerSrc : undefined}
            />
          </Suspense>
        ) : null}
      </Box>
    )
  }
  return (
    <Box
      ref={rootRef}
      component="video"
      src={src}
      poster={poster || undefined}
      title={title || undefined}
      autoPlay={Boolean(autoPlay)}
      loop={Boolean(loop)}
      // Browsers block unmuted autoplay.
      muted={Boolean(muted) || Boolean(autoPlay)}
      controls={controls !== false}
      playsInline={playsInline !== false}
      preload={resolveVideoPreload({ preload, poster, autoPlay })}
      {...rest}
      // After the spread, so a stray prop from the tree cannot unwire the
      // counters.
      onPlay={playbackHandlers.onPlay}
      onTimeUpdate={playbackHandlers.onTimeUpdate}
      onEnded={playbackHandlers.onEnded}
      sx={[
        {
          display: 'block',
          width: width || '100%',
          height: height || 'auto',
          aspectRatio,
          borderRadius: radius != null ? `${radius}px` : undefined,
        },
        ...nodeSx,
      ]}
    >
      {track}
    </Box>
  )
})
Video.displayName = 'Video'

/**
 * The caption fields say nothing until there is a captions file to label.
 *
 * `isNotEmpty` rather than an inverted `is: ''` — the two are not the same
 * question for a field nobody has touched. An unset attribute is `undefined`,
 * which is not equal to `''`, so `{ is: '', notMatch: true }` would read as
 * "not empty" and show both controls on every fresh Video element.
 */
const HAS_CAPTIONS = { when: 'captionsSrc', isNotEmpty: true }

export const schema: Aglyn.ComponentSchema<VideoProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Video',
  description: 'Plays a video file from your media library or any URL.',
  category: Aglyn.ComponentCategory.MEDIA,
  icon: {
    path: mdiVideo.path,
    sx: { color: '#7b1fa2' },
  },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'src',
      description:
        'Pick the film from your media library with "Browse media", or ' +
        'paste the URL of a video hosted somewhere else. A Wistia media ' +
        "link plays in Wistia's player, which loads when a visitor presses " +
        'play. Load the player with the page can load it sooner.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Video source',
    },
    {
      name: 'poster',
      description:
        'The still shown before anyone presses play. Videos from your media ' +
        'library already have one; pick a different image here to override ' +
        'it. A poster is what keeps the video off the wire until it is asked for. ' +
        'A Wistia video needs one: it is the button a visitor presses.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Poster image',
    },
    {
      name: 'title',
      description:
        'Names the video for screen readers, for the tooltip, and for ' +
        'search engines. Write it as a headline, not a file name.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Video title',
    },
    {
      name: 'description',
      description:
        'A sentence or two about what the video shows, different for each ' +
        'video. Never displayed on the page. Search engines read it, and ' +
        'can still list the video in results when it is blank.',
      component: Aglyn.FieldComponentType.TEXTAREA,
      label: 'Video description',
    },
    {
      name: 'uploadDate',
      description:
        'The day the video was first published, as YYYY-MM-DD. Search ' +
        'engines need this and cannot use the page date instead.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Publication date',
    },
    {
      name: 'durationSeconds',
      description:
        'How long the video runs, in seconds. Filled in from the media ' +
        'library when it knows; otherwise type it, or leave it blank.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Duration (seconds)',
      type: 'number',
    },
    {
      name: 'lightbox',
      description:
        'Show the poster as a play button and open the film full size in a ' +
        'dialog. Needs a poster image; without one the player stays in the ' +
        "page. A Wistia video's poster waits for a press either way, and the " +
        'video plays in place of the poster when this is off. A Wistia player ' +
        'that loads with the page stays in the page.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Open in a lightbox',
    },
    {
      name: 'loadPlayer',
      description:
        "For a Wistia video: show Wistia's player as soon as the page loads, " +
        'instead of a poster to press, to visitors whose privacy choices ' +
        'allow analytics. Everyone else still gets the poster. Use it on a ' +
        'page built to show this one video, so search engines can find the ' +
        'player. The player stays in the page even with the lightbox on.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Load the player with the page',
    },
    {
      name: 'preload',
      description:
        'How much to fetch before anyone presses play. Leave unset and a ' +
        'video with a poster fetches nothing at all.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Preload',
      // Real sentinels, never `''` (AGL-1451): each of these is a member of
      // the declared `VideoPreload` union, so a video switched to Metadata
      // can be switched back.
      options: [
        { value: 'none', label: 'Nothing until play (default with a poster)' },
        { value: 'metadata', label: 'Length and dimensions only' },
        { value: 'auto', label: 'As much as the browser likes' },
      ],
    },
    {
      name: 'controls',
      description: 'Show the browser playback controls (on by default).',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'Controls',
    },
    {
      name: 'autoPlay',
      description: 'Start playback automatically (mutes the video).',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'Autoplay',
    },
    {
      name: 'loop',
      description: 'Restart the video when it ends.',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'Loop',
    },
    {
      name: 'muted',
      description: 'Play without sound.',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'Muted',
    },
    {
      name: 'playsInline',
      description:
        'Keep the video in the page on a phone instead of taking over the ' +
        'whole screen (on by default).',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'Play inline on phones',
    },
    {
      name: 'captionsSrc',
      description:
        'A WebVTT captions file (.vtt) for this video — pick it with ' +
        '"Browse media" or paste its URL.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Captions file',
    },
    {
      name: 'captionsLabel',
      description:
        'What to call the captions track in the player menu, e.g. English.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Captions label',
      condition: HAS_CAPTIONS,
    },
    {
      name: 'captionsLang',
      description:
        'The language code of the captions, e.g. en or es — it tells the ' +
        'browser which track to offer.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Captions language',
      condition: HAS_CAPTIONS,
    },
    {
      name: 'width',
      description:
        'Width of the player — a number plus a unit, e.g. 100% or 640px.',
      component: Aglyn.FieldComponentType.CSS_DIMENSION,
      label: 'Width',
    },
    {
      name: 'height',
      description: 'Height of the player. Leave empty for auto.',
      component: Aglyn.FieldComponentType.CSS_DIMENSION,
      label: 'Height',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Video',
    pluginId: BUNDLE_ID,
    description: 'Video from your media library or any URL',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: {
      path: mdiVideo.path,
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

export default Video
