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

import { mdiHelpCircleOutline, mdiOpenInNew } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  IconButton,
  Link,
  Stack,
  type SxProps,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  buildDocsUrl,
  type DocsHelpAnchor,
  DOCS_HELP_TOPICS,
  type DocsHelpTopicKey,
} from '../constants/docs-links'

export interface DocsHelpTipProps<
  K extends DocsHelpTopicKey = DocsHelpTopicKey,
> {
  /** Registry key of the docs page this affordance explains. */
  topic: K
  /**
   * Heading on that page to land on, rather than its top (AGL-1929).
   *
   * Type-checked against the page's real headings, exactly as `docsHelp()`'s
   * `anchor` is — so a docs restructure that renames the heading is a compile
   * error here rather than a link that quietly drops the reader at the top of
   * a long page and lets them believe they're in the right place.
   *
   * Worth having because the pages this tip points at have grown: the billing
   * lifecycle page is now four distinct subjects, and "open the docs" is a
   * materially worse answer than "open the section that explains the dialog
   * you are standing in".
   */
  anchor?: DocsHelpAnchor<K>
  /** Override the tooltip title (defaults to the topic's docs page title). */
  title?: string
  /** Override the tooltip excerpt (defaults to the topic's docs excerpt). */
  excerpt?: string
  sx?: SxProps
}

/**
 * Unobtrusive question-mark affordance that surfaces a docs excerpt on hover
 * and deep-links to the full documentation page in a new tab (AGL-599).
 */
export function DocsHelpTip<K extends DocsHelpTopicKey>(
  props: DocsHelpTipProps<K>,
) {
  const { topic, anchor, sx } = props
  const topicEntry = DOCS_HELP_TOPICS[topic]
  const { path } = topicEntry
  const title = props.title ?? topicEntry.title
  const excerpt = props.excerpt ?? topicEntry.excerpt
  const href = `${buildDocsUrl(path)}${anchor ?? ''}`

  return (
    <Tooltip
      arrow
      enterDelay={150}
      title={
        <Stack spacing={0.5} sx={{ p: 0.5, maxWidth: 280 }}>
          <Typography variant="subtitle2" component="span">
            {title}
          </Typography>
          <Typography variant="caption" component="span">
            {excerpt}
          </Typography>
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            variant="caption"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'inherit',
              fontWeight: 600,
            }}
          >
            Open documentation
            <MdiIcon path={mdiOpenInNew.path} sx={{ fontSize: '1em' }} />
          </Link>
        </Stack>
      }
    >
      <IconButton
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        aria-label={`Help: ${title} — open documentation in a new tab`}
        sx={mergeSxProps(
          {
            color: 'text.disabled',
            ':hover': { color: 'text.secondary' },
          },
          sx,
        )}
      >
        <MdiIcon path={mdiHelpCircleOutline.path} fontSize="inherit" />
      </IconButton>
    </Tooltip>
  )
}
DocsHelpTip.displayName = 'DocsHelpTip'
DocsHelpTip.aglyn = true

export default DocsHelpTip
