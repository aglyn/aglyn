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
import { mdiVideo } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'video'

export interface VideoProps {
  /** Video URL — usually a media-library download URL (AGL-162). */
  src?: string
  /** Poster image shown before playback. */
  poster?: string
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
  /** CSS width (e.g. "100%", "640px"); defaults to 100%. */
  width?: string
  /** CSS height (e.g. "360px"); defaults to auto. */
  height?: string
  /** Border radius in px. */
  radius?: number
}

/**
 * Video element (AGL-162): plays media-library uploads or any URL.
 * Autoplay forces muted (browser policy); an empty src shows a labeled
 * placeholder so the element stays selectable in the editor.
 */
const Video = forwardRef<HTMLElement, VideoProps>((props, ref) => {
  const {
    src,
    poster,
    autoPlay,
    loop,
    muted,
    controls,
    width,
    height,
    radius,
    ...rest
  } = props
  if (!src) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
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
        }}
      >
        {'Video — set a source URL'}
      </Box>
    )
  }
  return (
    <Box
      ref={ref}
      component="video"
      src={src}
      poster={poster || undefined}
      autoPlay={Boolean(autoPlay)}
      loop={Boolean(loop)}
      // Browsers block unmuted autoplay.
      muted={Boolean(muted) || Boolean(autoPlay)}
      controls={controls !== false}
      playsInline
      preload="metadata"
      {...rest}
      sx={{
        display: 'block',
        width: width || '100%',
        height: height || 'auto',
        borderRadius: radius != null ? `${radius}px` : undefined,
      }}
    />
  )
})
Video.displayName = 'Video'

export const schema: Aglyn.ComponentSchema<VideoProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Video',
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
        'Video URL. Upload files on the host Media page and use "Copy URL".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Source URL',
    },
    {
      name: 'poster',
      description: 'Optional image shown before playback starts.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Poster URL',
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
      name: 'width',
      description: 'CSS width, e.g. 100% or 640px.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Width',
    },
    {
      name: 'height',
      description: 'CSS height, e.g. 360px. Leave empty for auto.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
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
