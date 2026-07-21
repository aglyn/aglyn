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
  DOCS_HELP_TOPICS,
  type DocsHelpTopicKey,
} from '../constants/docs-links'

export interface DocsHelpTipProps {
  /** Registry key of the docs page this affordance explains. */
  topic: DocsHelpTopicKey
  sx?: SxProps
}

/**
 * Unobtrusive question-mark affordance that surfaces a docs excerpt on hover
 * and deep-links to the full documentation page in a new tab (AGL-599).
 */
export function DocsHelpTip(props: DocsHelpTipProps) {
  const { topic, sx } = props
  const { path, title, excerpt } = DOCS_HELP_TOPICS[topic]
  const href = buildDocsUrl(path)

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
