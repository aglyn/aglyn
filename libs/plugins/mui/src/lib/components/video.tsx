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
import { mdiPlay, mdiVideo } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import type { SxProps } from '@mui/material/styles'
import {
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useState,
  type ReactNode,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

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
   */
  src?: string
  /**
   * The still shown before playback, and the element's entire first paint
   * once `preload` is `none`. A media reference or a URL, like `src`.
   */
  poster?: string
  /**
   * The video's title (AGL-2741). Serves three jobs at once and is deliberate
   * about it: the `<video>`'s tooltip, the accessible name a screen reader
   * announces for the player, and `VideoObject.name` in the page's structured
   * data. One sentence an author writes once.
   */
  title?: string
  /**
   * What the video is about — `VideoObject.description`, which Google
   * requires for a video rich result. Never rendered as visible text; the
   * element is a player, not a caption.
   */
  description?: string
  /**
   * When the video was first published, as `YYYY-MM-DD`. The other field
   * Google requires, and the one nothing else on the page can supply: a
   * screen's own publish date is when the PAGE went up, which for a film
   * embedded months later is simply a different fact.
   */
  uploadDate?: string
  /**
   * Running time in seconds. Copied off the media document when the DAM's
   * video pipeline publishes one (`Aglyn.videoMediaProps`), typed by the
   * author otherwise, and omitted from the schema when neither happened.
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
   */
  lightbox?: boolean
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
   * the same reason, as `image.tsx`.
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
 * Video element (AGL-162, AGL-2741): plays a media-library upload or any URL,
 * poster first.
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
    title,
    // Structured-data-only fields. Every one of them MUST be destructured:
    // what is left in `rest` is spread onto the `<video>`, where a
    // `description` or an `uploadDate` becomes an invalid DOM attribute in
    // the published HTML.
    description: _description,
    uploadDate: _uploadDate,
    durationSeconds: _durationSeconds,
    lightbox,
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
  const src = Aglyn.resolveMediaSrc(storedSrc, { hostId })
  const posterBase = Aglyn.resolveMediaSrc(storedPoster, { hostId })
  const poster = Aglyn.mediaVariantSrc(storedPoster, {
    hostId,
    width: POSTER_REQUEST_WIDTH,
  })
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
  const { editorInert } = Aglyn.useScreenLink(undefined)
  if (!src) {
    return (
      <Box
        ref={ref}
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
        {'Video — set a source URL'}
      </Box>
    )
  }
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
   * Poster-first, dialog on click (AGL-2744).
   *
   * Requires a poster, and falls back to the inline player without one rather
   * than rendering a button with no face. That is not a limitation to work
   * around — a lightbox trigger with nothing to show is a blank rectangle
   * that claims to be a film.
   */
  if (lightbox && poster) {
    return (
      <Box
        ref={ref}
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
          // `editorInert ? undefined : handler`.
          onClick={editorInert ? undefined : openLightbox}
          // Arming on hover and on focus, not on click, is what makes the
          // dialog open on the same frame as the press — and it costs a
          // visitor who never approaches the poster nothing at all.
          onPointerEnter={editorInert ? undefined : arm}
          onFocus={editorInert ? undefined : arm}
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
                ? Aglyn.MEDIA_CDN_VARIANT_WIDTHS.map(
                    (variant) => `${posterBase}?w=${variant} ${variant}w`,
                  ).join(', ')
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
              width: 64,
              height: 64,
              borderRadius: '50%',
              color: 'common.white',
              bgcolor: 'rgba(0, 0, 0, 0.55)',
              boxShadow: 6,
              // Gated in CSS rather than behind a JS branch, so toggling the
              // OS setting after load resolves in BOTH directions — the same
              // reason `element-animation-assets` puts every rule it has
              // inside this query.
              '@media (prefers-reduced-motion: no-preference)': {
                transition: 'transform 150ms, background-color 150ms',
                'button:hover &, button:focus-visible &': {
                  transform: 'translate(-50%, -50%) scale(1.08)',
                  bgcolor: 'rgba(0, 0, 0, 0.75)',
                },
              },
            }}
          >
            <MdiIcon path={mdiPlay.path} sx={{ fontSize: 36, ml: '4px' }} />
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
            />
          </Suspense>
        ) : null}
      </Box>
    )
  }
  return (
    <Box
      ref={ref}
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
        'paste the URL of a video hosted somewhere else.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Video source',
    },
    {
      name: 'poster',
      description:
        'The still shown before anyone presses play. Pick one with ' +
        '"Browse media" — with a poster set, none of the video is ' +
        'downloaded until a visitor asks for it.',
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
        'A sentence or two about what the video shows. Never displayed on ' +
        'the page — search engines need it to list the video in results.',
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
        'page.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Open in a lightbox',
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
