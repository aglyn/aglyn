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
import { mdiPlayCircleOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'gated-video'

/**
 * How many fresh links the player asks for in a row, with no playback in
 * between, before it stops and asks the viewer to reload (AGL-2814).
 *
 * Two covers the two links that can expire under a playing video: the stream
 * link itself, for a browser that re-requests the element's own `src`, and the
 * signed media session behind it. A third failure with nothing played means
 * the problem is not an expiry, and asking again would only loop.
 */
const MAX_SILENT_RECOVERIES = 2

/**
 * Seconds of playback on a fresh link that prove it works. Past this the
 * budget above resets, so an expiry hours later recovers as quietly as the
 * first one did.
 */
const RECOVERED_AFTER_SECONDS = 5

/**
 * The `MediaError` codes a fresh link can cure: `MEDIA_ERR_NETWORK` (2), which
 * a refused byte-range request raises mid-play, and
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` (4), which a refused first request raises.
 * An abort (1) is the page or the viewer stopping the load, and a decode error (3) is
 * a broken file that no new link can fix.
 */
const RECOVERABLE_MEDIA_ERRORS = new Set([2, 4])

export interface GatedVideoProps {
  /** Product whose gatedVideos list this plays from. */
  productId?: string
  /** Index into the product's gatedVideos (default 0). */
  videoIndex?: number
  lockedText?: string
}

/**
 * Gated video block (AGL-315): entitled members get a short-TTL signed
 * stream URL from the server (the gate is the mint step); playback
 * resumes from the last position. SiteC's training-program player.
 *
 * Every link behind the player expires (AGL-2814), so a long sitting outlives
 * the one it started with. When a request under an expired link fails, the
 * player asks the stream endpoint for a new one, which re-checks the member's
 * entitlement, and resumes at the second it stopped. A member who has lost
 * the entitlement gets the locked state instead.
 */
const GatedVideo = forwardRef<HTMLDivElement, GatedVideoProps>(
  (props, ref) => {
    const { productId, videoIndex, lockedText, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId } = Aglyn.useSite()
    const siteFetch = Aglyn.useSiteFetch()
    const [src, setSrc] = useState<string | null>(null)
    const [state, setState] = useState<
      'loading' | 'locked' | 'ready' | 'stalled'
    >('loading')
    const videoRef = useRef<HTMLVideoElement | null>(null)
    /**
     * Where a recovery stands. A ref, not state: the media events that read
     * and write it fire many times a second, and none of it is rendered.
     */
    const recovery = useRef({
      attempts: 0,
      resumeAt: 0,
      resume: false,
      playing: false,
      playedFrom: 0,
    })
    const resumeKey = `aglyn_video_${hostId}_${productId}_${videoIndex ?? 0}`

    /** One POST to the stream endpoint: a link, or why there is none. */
    const requestLink = useCallback(async (): Promise<string | 'locked' | 'failed'> => {
      try {
        const response = await siteFetch('/api/commerce/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            productId,
            video: videoIndex ?? 0,
          }),
        })
        if (response.status === 401 || response.status === 403) return 'locked'
        if (!response.ok) return 'failed'
        const payload = await response.json()
        return typeof payload?.url === 'string' && payload.url
          ? payload.url
          : 'failed'
      } catch {
        return 'failed'
      }
    }, [hostId, productId, videoIndex, siteFetch])

    useEffect(() => {
      if (!hostId || !productId) return
      let active = true
      recovery.current = {
        attempts: 0,
        resumeAt: 0,
        resume: false,
        playing: false,
        playedFrom: 0,
      }
      void requestLink().then((link) => {
        if (!active) return
        // Before anything has played, every refusal reads as the lock: the
        // viewer's next step is to sign in or to buy.
        if (link === 'locked' || link === 'failed') return setState('locked')
        setSrc(link)
        setState('ready')
      })
      return () => {
        active = false
      }
    }, [hostId, productId, requestLink])

    const handleError = () => {
      const element = videoRef.current
      if (!element || !RECOVERABLE_MEDIA_ERRORS.has(Number(element.error?.code))) {
        return
      }
      const progress = recovery.current
      if (progress.attempts >= MAX_SILENT_RECOVERIES) {
        setState('stalled')
        return
      }
      progress.attempts += 1
      progress.resumeAt = element.currentTime || progress.resumeAt
      progress.resume = progress.playing || !element.paused
      void requestLink().then((link) => {
        if (link === 'locked') return setState('locked')
        if (link === 'failed') return setState('stalled')
        setSrc(link)
      })
    }

    const handleLoadedMetadata = () => {
      const element = videoRef.current
      if (!element) return
      const progress = recovery.current
      const saved = Number(window.localStorage.getItem(resumeKey) ?? 0)
      const target =
        progress.resumeAt > 0 ? progress.resumeAt : saved > 5 ? saved : 0
      if (target > 0) element.currentTime = target
      progress.playedFrom = target
      if (progress.resume) {
        progress.resume = false
        try {
          void Promise.resolve(element.play()).catch(() => undefined)
        } catch {
          // A refused autoplay leaves the video paused at the right second,
          // which is the useful half of a resume.
        }
      }
    }

    const handleTimeUpdate = () => {
      const element = videoRef.current
      if (!element) return
      window.localStorage.setItem(
        resumeKey,
        String(Math.floor(element.currentTime)),
      )
      const progress = recovery.current
      if (
        progress.attempts &&
        element.currentTime - progress.playedFrom >= RECOVERED_AFTER_SECONDS
      ) {
        progress.attempts = 0
        progress.resumeAt = 0
      }
    }

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              aspectRatio: '16 / 9',
              bgcolor: 'action.hover',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'system-ui, sans-serif',
            },
            ...nodeSx,
          ]}
        >
          {'▶ Members-only video'}
        </Box>
      )
    }
    if (state === 'loading') return <Box ref={ref} {...rest} />
    if (state === 'stalled') {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              aspectRatio: '16 / 9',
              bgcolor: 'action.hover',
              borderRadius: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              alignItems: 'center',
              justifyContent: 'center',
              px: 2,
              textAlign: 'center',
            },
            ...nodeSx,
          ]}
        >
          <Typography variant="body2" color="text.secondary">
            {'Playback stopped. Reload the page to keep watching.'}
          </Typography>
          <Button
            size="small"
            variant="contained"
            onClick={() => window.location.reload()}
          >
            {'Reload'}
          </Button>
        </Box>
      )
    }
    if (state === 'locked' || !src) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              aspectRatio: '16 / 9',
              bgcolor: 'action.hover',
              borderRadius: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              alignItems: 'center',
              justifyContent: 'center',
            },
            ...nodeSx,
          ]}
        >
          <Typography variant="body2" color="text.secondary">
            {lockedText || '🔒 Sign in with an active subscription to watch'}
          </Typography>
          <Button size="small" variant="contained" href="/account">
            {'Sign in'}
          </Button>
        </Box>
      )
    }
    return (
      <Box ref={ref} {...rest}>
        <video
          ref={videoRef}
          src={src}
          controls
          controlsList="nodownload"
          style={{ width: '100%', borderRadius: 8 }}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => {
            recovery.current.playing = true
          }}
          onPause={() => {
            recovery.current.playing = false
          }}
          onError={handleError}
        />
      </Box>
    )
  },
)
GatedVideo.displayName = 'AglynGatedVideo'

export const schema: Aglyn.ComponentSchema<GatedVideoProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Members video',
  description:
    'A video only entitled members can play, resuming where they left off.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiPlayCircleOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'productId',
      label: 'Product id',
      description:
        'Members entitled to this product can watch its gated videos.',
      component: Aglyn.FieldComponentType.PRODUCT_SELECT,
    },
    {
      name: 'videoIndex',
      label: 'Video number',
      description: 'Which of the product’s videos to play (1st = 0).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'lockedText',
      label: 'Locked text',
      description:
        'The message over the poster frame when the viewer cannot play ' +
        'this video. The poster image still shows, so this only has to ' +
        'explain the lock.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Members video',
    pluginId: BUNDLE_ID,
    description: 'Subscription-gated video with resume',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiPlayCircleOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default GatedVideo
