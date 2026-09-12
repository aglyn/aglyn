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

import {
  sendVideoAnalyticsBeacon,
  type VideoAnalyticsEvent,
  videoQuartileEvent,
} from '@aglyn/aglyn/app-utils/analytics-beacon'
import {
  isMediaRef,
  MEDIA_CDN_ROUTE,
  mediaRefFromCdnPath,
  parseMediaRef,
} from '@aglyn/aglyn/app-utils/media-ref'
import { type SyntheticEvent, useCallback, useEffect, useRef } from 'react'

/**
 * The DAM media id a Video element's STORED `src` names, or undefined.
 *
 * Plays are counted per asset, so only a value that names one is counted: a
 * `media:` reference (pinned or not), or a root-relative CDN path written
 * before references existed. A hotlink and a raw Storage URL name no asset,
 * and neither does an absolute URL whose path merely looks like the CDN's —
 * that could be anybody's server.
 *
 * The stored value rather than the resolved one, because the resolved URL
 * carries `?r=auto` and a host-qualified scope, neither of which is the asset.
 */
export function playbackMediaId(src: unknown): string | undefined {
  if (typeof src !== 'string' || !src) return undefined
  // The prefix test comes first and `parseMediaRef` answers everything else:
  // it refuses any value that is not a reference, so a hotlink resolves to
  // nothing without a type predicate narrowing `src` away in the other branch.
  const reference = src.startsWith(`${MEDIA_CDN_ROUTE}/`)
    ? mediaRefFromCdnPath(src)
    : src
  return parseMediaRef(reference)?.mediaId
}

export interface VideoPlaybackBeaconOptions {
  /** The site the film plays on. Nothing is counted without one. */
  hostId?: string
  /** The element's stored `src` — see {@link playbackMediaId}. */
  src?: unknown
  /**
   * An editing surface: the besigner canvas or the console preview. An author
   * watching their own draft is not a visitor's play.
   */
  suppressed?: boolean
  /**
   * A new viewing starts whenever this changes. The lightbox passes `open`,
   * so each open that is played counts once, while pausing and resuming
   * inside one open does not.
   */
  viewingKey?: unknown
}

export interface VideoPlaybackHandlers {
  onPlay: (event: SyntheticEvent<HTMLVideoElement>) => void
  onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void
  onEnded: (event: SyntheticEvent<HTMLVideoElement>) => void
}

/**
 * The `<video>` handlers that report playback to `/api/analytics/collect`.
 *
 * ## What counts as one play
 *
 * The first `play` of a viewing. A browser fires `play` on every resume after
 * a pause, so the event alone would count a visitor who paused twice as three
 * viewers. A viewing ends on `ended` — a replay from the end is a second
 * play — or when {@link VideoPlaybackBeaconOptions.viewingKey} changes.
 *
 * ## Quartiles
 *
 * Each is reported once per viewing, against the furthest point the playhead
 * has REACHED rather than where it last was. `videoQuartileEvent` compares a
 * position with a previous one, so handing it the last position would report
 * the first quartile again for a visitor who rewound past it and watched it
 * twice; the watch curve asks where people stop, and a rewatch is not a
 * second arrival.
 *
 * State lives in a ref, never in React state: every one of these is a
 * Firestore write on a public page, and a counter driven by render would be
 * one write per `timeupdate`, four times a second.
 *
 * `sendVideoAnalyticsBeacon` keeps its own gate — production surfaces only,
 * never a browser carrying the internal-traffic opt-in — so this adds the two
 * refusals only the element can know about: no site, and an editing surface.
 */
export function useVideoPlaybackBeacon(
  options: VideoPlaybackBeaconOptions,
): VideoPlaybackHandlers {
  const { hostId, src, suppressed, viewingKey } = options
  const mediaId = playbackMediaId(src)
  const viewing = useRef({ played: false, reached: 0 })
  useEffect(() => {
    viewing.current = { played: false, reached: 0 }
  }, [viewingKey, mediaId])

  const send = useCallback(
    (event: VideoAnalyticsEvent) => {
      if (suppressed || !hostId || !mediaId) return
      sendVideoAnalyticsBeacon({ hostId, mediaId, event })
    },
    [suppressed, hostId, mediaId],
  )

  const onPlay = useCallback(() => {
    if (viewing.current.played) return
    viewing.current.played = true
    send('play')
  }, [send])

  const onTimeUpdate = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const { currentTime, duration } = event.currentTarget
      // `Infinity` for a stream and for some WebM files, `NaN` before
      // metadata: neither has a fraction to report.
      if (!Number.isFinite(duration) || duration <= 0) return
      const fraction = currentTime / duration
      const crossed = videoQuartileEvent(fraction, viewing.current.reached)
      if (fraction > viewing.current.reached) viewing.current.reached = fraction
      if (crossed) send(crossed)
    },
    [send],
  )

  const onEnded = useCallback(() => {
    send('complete')
    viewing.current = { played: false, reached: 0 }
  }, [send])

  return { onPlay, onTimeUpdate, onEnded }
}
