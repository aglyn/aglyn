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
'use client'

// By path: the facts rules stay out of every `@aglyn/aglyn` barrel, and the
// video-host resolver is not on one.
import {
  type MediaAssetDocument,
  mediaAssetDocumentPath,
  mediaAssetFactsFromDocument,
} from '@aglyn/aglyn/app-utils/media-asset-facts'
import {
  inheritedMediaAlt,
  videoMediaProps,
} from '@aglyn/aglyn/app-utils/media-metadata'
import {
  mediaPosterSrc,
  parseMediaRef,
} from '@aglyn/aglyn/app-utils/media-ref'
import {
  videoEmbedOf,
  videoEmbedProviderLabels,
} from '@aglyn/aglyn/plugin-manager/video-embed-provider'
import { mdiVideoOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { COVER_VIDEO_HINT } from '../../constants/media-size-hints'
import useFirestoreDoc from '../../hooks/use-firestore-doc'

/**
 * The poster variant the preview asks for. The card is a narrow column, so
 * 640 pixels covers it on a 2x screen, and an asset without that variant is
 * served its full poster instead.
 */
const PREVIEW_POSTER_WIDTH = 640

export interface EntryCoverVideoFieldProps {
  /** Media-library scope, and the site the preview resolves against. */
  hostId: string
  /** The stored value: a `media:` reference, or a pasted video link. */
  value: string
  onValueChange: (value: string) => void
  /**
   * How long the film runs, in seconds, as the editor holds it (AGL-3584):
   * what the watch page's `VideoObject` publishes as `duration`. Blank is
   * unknown.
   */
  duration: string
  onDurationChange: (value: string) => void
  /** Opens the page's ONE media picker, targeted at the featured video. */
  onChoose: () => void
}

/**
 * A library film's length in whole seconds as its document records it, or
 * `undefined` when it records none (AGL-3584). Through `videoMediaProps`, the
 * rule a Video element's own pick uses, so an entry and a placed Video agree
 * on how long the same film is.
 */
export function libraryVideoSeconds(assetVideo: unknown): number | undefined {
  return videoMediaProps({
    componentId: 'video',
    propName: 'src',
    assetVideo,
  }).durationSeconds
}

/**
 * What picking a library film writes into the entry editor, or `null` when
 * the picked asset is not a video (AGL-2954).
 *
 * `coverVideo` stores `src`, the asset's `media:` reference, so a folder move
 * or a replace reaches the entry the way it reaches a cover image.
 * `coverVideoDuration` becomes the film's measured length (AGL-3584), so the
 * watch page publishes a `duration` without the author typing one.
 *
 * ## The poster fill
 *
 * An entry's cover is what its list cards, its share card and its
 * `Article.image` show, and a video entry often has no picture of its own. So
 * when the entry has NO cover and the film's document records a captured
 * poster, the cover becomes that frame:
 *
 * * **Never over an existing cover.** An author who chose a picture meant it,
 *   and re-picking the film must not replace it.
 * * **Only when the document says the frame exists.** The poster URL answers
 *   for any library film, but a film without a captured frame answers it with
 *   404, and a cover is an `<img>` and a share card, where a 404 is a broken
 *   picture. So the decision is read off the asset at pick time and never
 *   guessed from the URL.
 * * **Resolved for this site.** The cover stores the poster's path as the
 *   cover image would resolve it here, host-qualified for an org film, so an
 *   asset shared with this site alone still serves it.
 * * **The description follows the frame** through `inheritedMediaAlt`, the
 *   rule every pick uses, so a description the author already wrote stays.
 */
export function featuredVideoPick(options: {
  /** The picked media document, as the picker dialog hands it back. */
  media: {
    contentType?: unknown
    poster?: unknown
    alt?: unknown
    /** The film's measured record — `durationMs`, `width`, `height`. */
    video?: unknown
  }
  /** The picked asset's stored form, from `mediaNodeSrc`. */
  src: string
  hostId: string
  /** The entry's cover image as the editor holds it now. */
  coverImage: string
  /** The cover's description as the editor holds it now. */
  coverImageAlt: string
}): {
  coverVideo: string
  coverVideoDuration: string
  coverImage?: string
  coverImageAlt?: string
} | null {
  const { media, src, hostId, coverImage, coverImageAlt } = options
  if (!String(media?.contentType ?? '').startsWith('video/')) return null
  // The length goes with the film (AGL-3584): the library's measurement when
  // it has one, and blank otherwise, because a length typed for the film
  // being replaced does not describe this one.
  const seconds = libraryVideoSeconds(media.video)
  const picked = {
    coverVideo: src,
    coverVideoDuration: seconds ? String(seconds) : '',
  }
  if (coverImage.trim()) return picked
  if (!media.poster || typeof media.poster !== 'object') return picked
  const poster = mediaPosterSrc(src, { hostId })
  if (!poster) return picked
  return {
    ...picked,
    coverImage: poster,
    coverImageAlt:
      inheritedMediaAlt({
        placementAlt: coverImageAlt,
        assetAlt: media.alt,
      }) ?? coverImageAlt,
  }
}

/**
 * The video hosts the link field's help names, as they are declared: " or a
 * video on {label}", or nothing when no plugin declares a host.
 */
const VIDEO_HOST_LINKS = (() => {
  const labels = videoEmbedProviderLabels()
  if (!labels.length) return ''
  const hosts = new Intl.ListFormat('en', { type: 'disjunction' })
  return ` or a video on ${hosts.format(labels)}`
})()

/** What the stored value names, in words, for the placeholder. */
function sourceLabel(value: string): string {
  if (parseMediaRef(value)) return 'Video from your media library'
  const embed = videoEmbedOf(value)
  if (embed) return `${embed.provider.label} video`
  return 'Linked video'
}

/**
 * The entry's featured video (AGL-2954): the film a Videos collection's entry
 * is built around, played in place of the cover image at the top of the entry.
 *
 * Modeled on {@link EntryCoverImageField}, and it keeps that field's two
 * decisions for the same reasons: the link input stays beside the picker, so
 * a video file hosted elsewhere, or a link to a video host whose player the
 * Video element plays (`video-embed-provider.ts`), can be pasted, and the
 * picker dialog stays the page's, so there is one pick handler to store a
 * reference.
 *
 * ## The preview
 *
 * A film has no picture of its own to show, and a `<video>` here would fetch
 * the file to paint a frame. So the preview is the poster the library captured
 * for it, and only when the film's DOCUMENT records one: its URL answers 404
 * for a film without a captured frame, which in an `<img>` is a broken
 * picture. The document is read by the rule the published page applies
 * (`mediaAssetFactsFromDocument`), so a film this site may not use previews no
 * frame either. It is one live read, opened only for a library film, so a
 * pasted link costs nothing. Anything else, a pasted link included, gets a
 * placeholder that says what the value is and shows it.
 */
export function EntryCoverVideoField(props: EntryCoverVideoFieldProps) {
  const { hostId, value, onValueChange, duration, onDurationChange, onChoose } =
    props
  const trimmed = value.trim()
  const ref = parseMediaRef(trimmed)
  const path = ref ? mediaAssetDocumentPath(ref) : null
  const firestore = useFirestore()
  const { data: asset, status } = useFirestoreDoc<MediaAssetDocument>(
    () => (path ? doc(firestore, path) : null),
    [firestore, path],
  )
  const facts =
    ref && status === 'success'
      ? mediaAssetFactsFromDocument(asset, ref, hostId)
      : undefined
  const poster =
    facts?.poster && typeof facts.poster === 'object'
      ? mediaPosterSrc(trimmed, { hostId, width: PREVIEW_POSTER_WIDTH })
      : undefined
  // The library's own measurement, offered rather than written, so opening
  // an entry whose film was picked before lengths were stored does not mark
  // it edited (AGL-3584).
  const measured = facts ? libraryVideoSeconds(facts.video) : undefined
  const offerMeasured =
    measured !== undefined && duration.trim() !== String(measured)

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        {'The film this entry is about. It plays in place of the cover image ' +
          'at the top of the entry. Leave it unset and the entry shows its ' +
          'cover as usual.'}
      </Typography>
      {poster ? (
        <Box
          component="img"
          src={poster}
          alt="Featured video poster"
          sx={{
            width: '100%',
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        />
      ) : (
        <Stack
          spacing={0.5}
          sx={{
            width: '100%',
            aspectRatio: '16 / 9',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 1,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            px: 2,
          }}
        >
          <MdiIcon path={mdiVideoOutline.path} size={1.4} />
          <Typography variant="caption">
            {trimmed ? sourceLabel(trimmed) : 'No featured video'}
          </Typography>
          {trimmed ? (
            <Typography
              variant="caption"
              sx={{ overflowWrap: 'anywhere', textAlign: 'center' }}
            >
              {trimmed}
            </Typography>
          ) : null}
        </Stack>
      )}
      {/* What to bring, said before the upload (AGL-2486). */}
      <Typography variant="caption" color="text.secondary" component="div">
        {COVER_VIDEO_HINT}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={onChoose}>
          {trimmed ? 'Replace video' : 'Choose video'}
        </Button>
        {trimmed ? (
          <Button
            size="small"
            color="error"
            onClick={() => {
              onValueChange('')
              onDurationChange('')
            }}
          >
            {'Clear'}
          </Button>
        ) : null}
      </Stack>
      <TextField
        label="Featured video link"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        size="small"
        helperText={
          'Picked from the media library, or paste a link to a video file' +
          VIDEO_HOST_LINKS +
          '. A library video with a captured frame also fills an empty cover ' +
          'image with that frame.'
        }
      />
      <TextField
        label="Video length (seconds)"
        type="number"
        value={duration}
        onChange={(event) => onDurationChange(event.target.value)}
        size="small"
        slotProps={{ htmlInput: { min: 1, step: 1, inputMode: 'numeric' } }}
        helperText={
          'How long the video runs, for search results that show a length. ' +
          'Filled in when you choose a library video; type it for a linked ' +
          'video. Leave it blank if you do not know.'
        }
      />
      {offerMeasured ? (
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => onDurationChange(String(measured))}
        >
          {`Use the library length (${measured} seconds)`}
        </Button>
      ) : null}
    </Stack>
  )
}
EntryCoverVideoField.displayName = 'EntryCoverVideoField'

export default EntryCoverVideoField
