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
  mdiMusic,
  mdiMusicNote,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiSkipPrevious,
  mdiVolumeHigh,
  mdiVolumeOff,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import type { SxProps } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  formatTrackTime,
  musicCoverSrc,
  musicTrackSource,
  trackLabel,
  type MusicTrackFields,
} from './music-sources'

// Component ids are persisted in screen documents; never rename.
export const MUSIC_PLAYER_ID: Aglyn.ComponentId = 'musicPlayer'
export const MUSIC_TRACK_ID: Aglyn.ComponentId = 'musicTrack'

/** What the player says when a track cannot be played. */
export const TRACK_UNAVAILABLE = 'This track is unavailable'

/** What the editor shows on a player with nothing to play. */
export const ADD_YOUR_TRACKS =
  'Music player — add your tracks: choose audio from your media library with ' +
  'Browse media, or add Track elements for a playlist.'

/** A track the player knows about: its fields and, for a Track element, where it sits. */
interface RegisteredTrack {
  id: string
  fields: MusicTrackFields
  element: HTMLElement | null
}

interface MusicPlayerContextValue {
  register: (track: RegisteredTrack) => () => void
  select: (id: string) => void
  currentId: string | null
  playing: boolean
  editorInert: boolean
  /** The 1-based position of a registered track, for its row's label. */
  positionOf: (id: string) => number
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null)
MusicPlayerContext.displayName = 'MusicPlayerContext'

/** The player's own track: the one its `src` names, ahead of any Track element. */
const OWN_TRACK_ID = 'own'

/** Tracks in page order: the player's own first, then its Track elements as the DOM orders them. */
function inPageOrder(tracks: readonly RegisteredTrack[]): RegisteredTrack[] {
  return [...tracks].sort((a, b) => {
    if (a.id === OWN_TRACK_ID) return -1
    if (b.id === OWN_TRACK_ID) return 1
    if (!a.element || !b.element) return 0
    return a.element.compareDocumentPosition(b.element) &
      Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1
  })
}

export interface MusicPlayerProps extends MusicTrackFields {
  /** A heading above the player: an album, an EP, "Listen". */
  heading?: string
  /** Authored node styles, merged rather than replaced (AGL-1284). */
  sx?: SxProps
  /** Track elements, for a playlist. */
  children?: ReactNode
}

/**
 * Music player (AGL-3716): plays the site owner's own tracks, one or a
 * playlist, from the media library or from an address the author confirmed
 * they hold the rights to (`music-sources.ts` has the rule).
 *
 * The controls are the player's own, not the browser's: play and pause,
 * previous and next for a playlist, a seek bar with the time, and volume with
 * mute — every one a real button or range input, so a keyboard and a screen
 * reader work them as they would any other. There is no download control:
 * the `<audio>` element draws no controls of its own, says `nodownload` for a
 * browser that would, and refuses its context menu.
 *
 * On the besigner canvas the player is inert, as Video is (AGL-830): it
 * draws exactly what a visitor gets and plays nothing.
 */
const MusicPlayer = forwardRef<HTMLElement, MusicPlayerProps>((props, ref) => {
  const {
    src,
    title,
    artist,
    image,
    rightsConfirmed,
    heading,
    children,
    sx: nodeSxProp,
    ...rest
  } = props
  const nodeSx = Array.isArray(nodeSxProp) ? nodeSxProp : nodeSxProp ? [nodeSxProp] : []
  const { hostId } = Aglyn.useSite()
  const { editorInert, suppressNavigation } = Aglyn.useScreenLink(undefined)
  const headingId = useId()

  const [registered, setRegistered] = useState<RegisteredTrack[]>([])
  const register = useCallback((track: RegisteredTrack) => {
    setRegistered((prev) => [...prev.filter((entry) => entry.id !== track.id), track])
    return () => setRegistered((prev) => prev.filter((entry) => entry.id !== track.id))
  }, [])

  const tracks = useMemo(() => {
    const own: RegisteredTrack[] = src
      ? [{ id: OWN_TRACK_ID, fields: { src, title, artist, image, rightsConfirmed }, element: null }]
      : []
    return inPageOrder([...own, ...registered])
  }, [src, title, artist, image, rightsConfirmed, registered])

  const [currentId, setCurrentId] = useState<string | null>(null)
  const index = Math.max(0, tracks.findIndex((track) => track.id === currentId))
  const current = tracks[index] ?? null
  const source = current ? musicTrackSource(current.fields, { hostId }) : null
  const cover = current ? musicCoverSrc(current.fields.image, { hostId }) : undefined

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  /** Tracks the CDN or the address refused: a takedown, a deleted file, a dead link. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  /** Play the next track once its source is in, after a press or an end. */
  const autoplayNext = useRef(false)

  const playable = Boolean(current && source?.state === 'ready' && !failed.has(current.id))
  const sourceUrl = source?.state === 'ready' ? source.url : null

  const select = useCallback(
    (id: string) => {
      if (editorInert) return
      autoplayNext.current = true
      setCurrentId(id)
    },
    [editorInert],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted, playable])

  // A new track starts at the top, and plays when a press or an end asked for it.
  useEffect(() => {
    setTime(0)
    setDuration(0)
    setPlaying(false)
    const audio = audioRef.current
    if (!audio || !playable || !autoplayNext.current) return
    autoplayNext.current = false
    void Promise.resolve(audio.play()).catch(() => setPlaying(false))
  }, [current?.id, sourceUrl, playable])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (editorInert || !audio || !playable) return
    if (audio.paused) void Promise.resolve(audio.play()).catch(() => setPlaying(false))
    else audio.pause()
  }, [editorInert, playable])

  const step = useCallback(
    (delta: number) => {
      const next = tracks[index + delta]
      if (next) select(next.id)
    },
    [tracks, index, select],
  )

  const onSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    const value = Number(event.target.value)
    if (!audio || !Number.isFinite(value)) return
    audio.currentTime = value
    setTime(value)
  }

  const context = useMemo<MusicPlayerContextValue>(
    () => ({
      register,
      select,
      currentId: current?.id ?? null,
      playing,
      editorInert,
      positionOf: (id) => tracks.findIndex((track) => track.id === id) + 1,
    }),
    [register, select, current?.id, playing, editorInert, tracks],
  )

  const rootRef = ref
  const hasChildren = Boolean(children) && (!Array.isArray(children) || children.length > 0)
  const empty = !tracks.length && !hasChildren

  if (empty) {
    // Nothing to play: the editor says what to add, a visitor sees nothing.
    return suppressNavigation ? (
      <Box
        ref={rootRef}
        {...rest}
        data-empty-music-player=""
        sx={[
          {
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 2,
            color: 'text.secondary',
            fontSize: 13,
            textAlign: 'center',
          },
          ...nodeSx,
        ]}
      >
        <MdiIcon path={mdiMusic.path} aria-hidden />
        <span>{ADD_YOUR_TRACKS}</span>
      </Box>
    ) : (
      <Box ref={rootRef} {...rest} sx={nodeSx} />
    )
  }

  const label = current ? trackLabel(current.fields, index) : ''
  const notice =
    current && !playable
      ? source?.state === 'unconfirmed' && suppressNavigation
        ? 'Confirm you own this audio or have a license to use it on your site, in the element settings, to play it.'
        : source?.state === 'empty' && suppressNavigation
          ? 'Choose this track’s audio from your media library with Browse media.'
          : TRACK_UNAVAILABLE
      : null
  const multiple = tracks.length > 1

  return (
    <MusicPlayerContext.Provider value={context}>
      <Box
        ref={rootRef}
        {...rest}
        component="section"
        aria-labelledby={heading ? headingId : undefined}
        aria-label={heading ? undefined : 'Music player'}
        sx={[
          {
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            p: { xs: 2, sm: 3 },
            borderRadius: 2,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            color: 'text.primary',
          },
          ...nodeSx,
        ]}
      >
        {heading ? (
          <Typography id={headingId} variant="h6" component="h2">
            {heading}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box
            sx={{
              flex: '0 0 auto',
              width: { xs: 64, sm: 88 },
              height: { xs: 64, sm: 88 },
              borderRadius: 1.5,
              overflow: 'hidden',
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            {cover ? (
              <Box
                component="img"
                src={cover}
                alt=""
                decoding="async"
                loading="lazy"
                draggable={false}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <MdiIcon path={mdiMusicNote.path} aria-hidden sx={{ fontSize: 36 }} />
            )}
          </Box>
          <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
            <Typography variant="subtitle1" component="p" noWrap sx={{ fontWeight: 600 }}>
              {current?.fields.title?.trim() || (current ? `Track ${index + 1}` : '')}
            </Typography>
            {current?.fields.artist?.trim() ? (
              <Typography variant="body2" component="p" color="text.secondary" noWrap>
                {current.fields.artist.trim()}
              </Typography>
            ) : null}
            {notice ? (
              <Typography variant="body2" component="p" role="status" color="text.secondary">
                {notice}
              </Typography>
            ) : null}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {multiple ? (
            <IconButton
              onClick={() => step(-1)}
              disabled={editorInert || index === 0}
              aria-label="Previous track"
            >
              <MdiIcon path={mdiSkipPrevious.path} />
            </IconButton>
          ) : null}
          <IconButton
            onClick={toggle}
            disabled={editorInert || !playable}
            aria-label={playing ? `Pause ${label}` : `Play ${label}`}
            sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}
          >
            <MdiIcon path={playing ? mdiPause.path : mdiPlay.path} />
          </IconButton>
          {multiple ? (
            <IconButton
              onClick={() => step(1)}
              disabled={editorInert || index >= tracks.length - 1}
              aria-label="Next track"
            >
              <MdiIcon path={mdiSkipNext.path} />
            </IconButton>
          ) : null}
          <Box
            component="span"
            aria-hidden
            sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'text.secondary', minWidth: 40, textAlign: 'right' }}
          >
            {formatTrackTime(time)}
          </Box>
          <Box
            component="input"
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(time, duration || 0)}
            onChange={onSeek}
            disabled={editorInert || !playable || !duration}
            aria-label={`Seek ${label}`}
            aria-valuetext={`${formatTrackTime(time)} of ${formatTrackTime(duration)}`}
            sx={{ flex: '1 1 120px', minWidth: 80, accentColor: 'currentColor' }}
          />
          <Box
            component="span"
            aria-hidden
            sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'text.secondary', minWidth: 40 }}
          >
            {formatTrackTime(duration)}
          </Box>
          <IconButton
            onClick={() => setMuted((value) => !value)}
            disabled={editorInert}
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
          >
            <MdiIcon path={muted || volume === 0 ? mdiVolumeOff.path : mdiVolumeHigh.path} />
          </IconButton>
          <Box
            component="input"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round((muted ? 0 : volume) * 100)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const next = Number(event.target.value) / 100
              setVolume(next)
              setMuted(next === 0)
            }}
            disabled={editorInert}
            aria-label="Volume"
            aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
            sx={{ width: 80, accentColor: 'currentColor' }}
          />
        </Box>

        {hasChildren ? (
          <Box
            component="ol"
            aria-label={heading ? `${heading} tracks` : 'Tracks'}
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            {children}
          </Box>
        ) : null}

        {playable && source?.state === 'ready' && !editorInert ? (
          <audio
            ref={audioRef}
            src={source.url}
            preload="metadata"
            // No download: the element draws no controls, and says so for a
            // browser that would offer one anyway.
            controlsList="nodownload noplaybackrate"
            onContextMenu={(event: SyntheticEvent) => event.preventDefault()}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
            onEnded={() => {
              setPlaying(false)
              const next = tracks[index + 1]
              if (next) select(next.id)
            }}
            onError={() => {
              // A takedown answers 410 and a deleted file 404: either way the
              // track cannot play, and the player says so without guessing why.
              if (!current) return
              setPlaying(false)
              setFailed((prev) => new Set(prev).add(current.id))
            }}
          />
        ) : null}
      </Box>
    </MusicPlayerContext.Provider>
  )
})
MusicPlayer.displayName = 'MusicPlayer'

export interface MusicTrackProps extends MusicTrackFields {
  sx?: SxProps
  children?: ReactNode
}

/**
 * One track of a playlist (AGL-3716): a row in the player's list that plays
 * it when pressed. It registers its fields with the player it sits in, which
 * plays the tracks in the order the page shows them.
 */
export const MusicTrack = forwardRef<HTMLLIElement, MusicTrackProps>((props, ref) => {
  const { src, title, artist, image, rightsConfirmed, sx: nodeSxProp, children: _children, ...rest } = props
  const nodeSx = Array.isArray(nodeSxProp) ? nodeSxProp : nodeSxProp ? [nodeSxProp] : []
  const player = useContext(MusicPlayerContext)
  const id = useId()
  const [element, setElement] = useState<HTMLLIElement | null>(null)
  const rowRef = useCallback(
    (node: HTMLLIElement | null) => {
      setElement(node)
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )
  const { suppressNavigation } = Aglyn.useScreenLink(undefined)
  const register = player?.register

  useEffect(() => {
    if (!register) return undefined
    return register({ id, fields: { src, title, artist, image, rightsConfirmed }, element })
  }, [register, id, src, title, artist, image, rightsConfirmed, element])

  const position = player?.positionOf(id) || 1
  const fields = { src, title, artist }
  const current = player?.currentId === id
  const label = trackLabel(fields, position - 1)
  return (
    <Box
      ref={rowRef}
      component="li"
      {...rest}
      aria-current={current ? 'true' : undefined}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderRadius: 1,
          bgcolor: current ? 'action.selected' : undefined,
        },
        ...nodeSx,
      ]}
    >
      <Box
        component="button"
        type="button"
        onClick={() => player?.select(id)}
        disabled={!player || player.editorInert}
        aria-label={`Play ${label}`}
        sx={{
          appearance: 'none',
          border: 0,
          background: 'none',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          px: 1,
          py: 0.75,
          cursor: player?.editorInert ? 'default' : 'pointer',
          borderRadius: 1,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          '&:disabled': { color: 'inherit' },
        }}
      >
        <Box component="span" aria-hidden sx={{ width: 24, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {current && player?.playing ? <MdiIcon path={mdiPlay.path} sx={{ fontSize: 18 }} /> : position}
        </Box>
        <Box component="span" sx={{ minWidth: 0, flex: '1 1 auto' }}>
          <Box component="span" sx={{ display: 'block', fontWeight: 500 }}>
            {title?.trim() || `Track ${position}`}
          </Box>
          {artist?.trim() ? (
            <Box component="span" sx={{ display: 'block', fontSize: 13, color: 'text.secondary' }}>
              {artist.trim()}
            </Box>
          ) : null}
          {!src && suppressNavigation ? (
            <Box component="span" sx={{ display: 'block', fontSize: 12, color: 'text.secondary' }}>
              {'Choose the audio from your media library with Browse media'}
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  )
})
MusicTrack.displayName = 'MusicTrack'

const RIGHTS_DESCRIPTION =
  'Needed only for audio pasted as a web address: confirm you made the ' +
  'recording or hold a license to publish it, or the player will not play ' +
  'it. Audio from your media library was confirmed when it was uploaded. ' +
  'Never link music by other artists without their permission.'

const trackAttributes = (noun: string): Aglyn.AglynAttributeSchema[] => [
  {
    name: 'src',
    label: 'Audio',
    description:
      `The ${noun}'s audio: pick an MP3, M4A, AAC, OGG or WAV you uploaded ` +
      'with "Browse media". Only upload music you own or have a license to use.',
    component: Aglyn.FieldComponentType.TEXT_FIELD,
    mediaKind: 'audio',
  },
  {
    name: 'title',
    label: 'Track title',
    description: 'The track’s name, shown in the player and read by screen readers.',
    component: Aglyn.FieldComponentType.TEXT_FIELD,
  },
  {
    name: 'artist',
    label: 'Artist',
    description: 'Who performs it, shown under the title.',
    component: Aglyn.FieldComponentType.TEXT_FIELD,
  },
  {
    name: 'image',
    label: 'Cover art',
    description: 'An image from your media library shown beside the track.',
    component: Aglyn.FieldComponentType.TEXT_FIELD,
    mediaKind: 'image',
  },
  {
    name: 'rightsConfirmed',
    label: 'I own this audio or have a license to use it on my site',
    description: RIGHTS_DESCRIPTION,
    component: Aglyn.FieldComponentType.SWITCH,
  },
]

const ICON = { path: mdiMusic.path, sx: { color: 'secondary.main' } }

export const schema: Aglyn.ComponentSchema<MusicPlayerProps> = {
  $id: MUSIC_PLAYER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Music player',
  description: 'Plays your own tracks from your media library, one or a playlist.',
  category: Aglyn.ComponentCategory.MEDIA,
  icon: ICON,
  restrictChildren: [Aglyn.LinealDirectiveFlag.LIMIT_TO, { components: [MUSIC_TRACK_ID] }],
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'An optional heading above the player, such as the album or EP name.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    ...trackAttributes('first track'),
  ],
}

export const trackSchema: Aglyn.ComponentSchema<MusicTrackProps> = {
  $id: MUSIC_TRACK_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Track',
  description: 'One track of a music player’s playlist.',
  category: Aglyn.ComponentCategory.MEDIA,
  icon: { path: mdiMusicNote.path, sx: { color: 'secondary.main' } },
  restrictParent: [Aglyn.LinealDirectiveFlag.LIMIT_TO, { components: [MUSIC_PLAYER_ID] }],
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: trackAttributes('track'),
}

const track = () => ({
  $id: null,
  componentId: MUSIC_TRACK_ID,
  pluginId: BUNDLE_ID,
  props: {},
})

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(MUSIC_PLAYER_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Music player',
    pluginId: BUNDLE_ID,
    description: 'One track from your media library',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: ICON,
    data: { $id: null, componentId: MUSIC_PLAYER_ID, pluginId: BUNDLE_ID, props: {} },
  },
  {
    $id: generatePresetId(MUSIC_PLAYER_ID, 'playlist'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Music playlist',
    pluginId: BUNDLE_ID,
    description: 'A player with three tracks to fill from your media library',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: ICON,
    data: {
      $id: null,
      componentId: MUSIC_PLAYER_ID,
      pluginId: BUNDLE_ID,
      props: {},
      nodes: [track(), track(), track()],
    },
  },
  {
    $id: generatePresetId(MUSIC_TRACK_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Track',
    pluginId: BUNDLE_ID,
    description: 'One more track for a music playlist',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: trackSchema.icon,
    data: track(),
  },
]

export default MusicPlayer
