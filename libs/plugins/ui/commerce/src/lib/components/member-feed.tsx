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
import { mdiBellRingOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'member-feed'

export interface MemberFeedProps {
  heading?: string
  emptyText?: string
  maxItems?: number
}

interface FeedPost {
  id: string
  title: string
  body: string
  createdAtMs: number
}

/**
 * Member updates feed (AGL-316): entitlement-filtered posts from the
 * server-enforced feed API. Non-members get the sign-in nudge — the
 * bodies never reach them.
 */
const MemberFeed = forwardRef<HTMLDivElement, MemberFeedProps>(
  (props, ref) => {
    const { heading, emptyText, maxItems, ...rest } = props
    const { hostId } = Aglyn.useSite()
    const [posts, setPosts] = useState<FeedPost[] | null | 'anonymous'>(null)

    useEffect(() => {
      if (!hostId) return
      let active = true
      void fetch(
        `/api/commerce/member-feed?hostId=${encodeURIComponent(hostId)}`,
      )
        .then(async (response) => {
          if (!active) return
          if (response.status === 401) return setPosts('anonymous')
          const payload = await response.json()
          setPosts(payload?.posts ?? [])
        })
        .catch(() => {
          if (active) setPosts([])
        })
      return () => {
        active = false
      }
    }, [hostId])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            p: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Member feed — updates for subscribers render here'}
        </Box>
      )
    }
    if (posts === null) return <Box ref={ref} {...rest} />

    return (
      <Box ref={ref} {...rest}>
        {heading ? (
          <Typography variant="h5" gutterBottom>
            {heading}
          </Typography>
        ) : null}
        {posts === 'anonymous' ? (
          <Typography variant="body2" color="text.secondary">
            {'Sign in with your membership to see updates.'}
          </Typography>
        ) : posts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {emptyText || 'No updates yet — check back soon.'}
          </Typography>
        ) : (
          posts
            .slice(0, maxItems && maxItems > 0 ? maxItems : 20)
            .map((post, index) => (
              <Box key={post.id} sx={{ py: 1.5 }}>
                {index > 0 ? <Divider sx={{ mb: 1.5 }} /> : null}
                <Typography variant="subtitle1">{post.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(post.createdAtMs).toLocaleDateString()}
                </Typography>
                {post.body ? (
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}
                  >
                    {post.body}
                  </Typography>
                ) : null}
              </Box>
            ))
        )}
      </Box>
    )
  },
)
MemberFeed.displayName = 'AglynMemberFeed'

export const schema: Aglyn.ComponentSchema<MemberFeedProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Member feed',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiBellRingOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the feed.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'emptyText',
      label: 'Empty text',
      description: 'Copy when there are no posts.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'maxItems',
      label: 'Max posts',
      description: 'Cap the number shown (default 20).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Member feed',
    pluginId: BUNDLE_ID,
    description: 'Updates visible only to entitled members',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiBellRingOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Member updates' },
    },
  },
]

export default MemberFeed
