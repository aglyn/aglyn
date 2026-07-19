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
import { forwardRef, useEffect, useRef, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'gated-video'

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
 */
const GatedVideo = forwardRef<HTMLDivElement, GatedVideoProps>(
  (props, ref) => {
    const { productId, videoIndex, lockedText, ...rest } = props
    const { hostId } = Aglyn.useSite()
    const [src, setSrc] = useState<string | null>(null)
    const [state, setState] = useState<'loading' | 'locked' | 'ready'>(
      'loading',
    )
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const resumeKey = `aglyn_video_${hostId}_${productId}_${videoIndex ?? 0}`

    useEffect(() => {
      if (!hostId || !productId) return
      let active = true
      void fetch('/api/commerce/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          productId,
          video: videoIndex ?? 0,
        }),
      })
        .then(async (response) => {
          if (!active) return
          if (!response.ok) return setState('locked')
          const payload = await response.json()
          setSrc(payload.url)
          setState('ready')
        })
        .catch(() => {
          if (active) setState('locked')
        })
      return () => {
        active = false
      }
    }, [hostId, productId, videoIndex])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            aspectRatio: '16 / 9',
            bgcolor: 'action.hover',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'▶ Members-only video'}
        </Box>
      )
    }
    if (state === 'loading') return <Box ref={ref} {...rest} />
    if (state === 'locked' || !src) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            aspectRatio: '16 / 9',
            bgcolor: 'action.hover',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
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
          onLoadedMetadata={() => {
            const saved = Number(window.localStorage.getItem(resumeKey) ?? 0)
            if (videoRef.current && saved > 5) {
              videoRef.current.currentTime = saved
            }
          }}
          onTimeUpdate={() => {
            if (!videoRef.current) return
            window.localStorage.setItem(
              resumeKey,
              String(Math.floor(videoRef.current.currentTime)),
            )
          }}
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
    },
    {
      name: 'lockedText',
      label: 'Locked text',
      description: 'Shown to non-members.',
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
