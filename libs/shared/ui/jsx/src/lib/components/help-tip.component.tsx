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
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  IconButton,
  Link,
  Stack,
  type SxProps,
  Tooltip,
  Typography,
} from '@mui/material'
import type { MouseEventHandler, ReactNode } from 'react'
import { MdiIcon } from './mdi-icon/mdi-icon'

/** Content shape accepted anywhere a help affordance can attach (AGL-600/601). */
export interface HelpTipContent {
  /** One- or two-sentence plain-language explanation shown in the tooltip. */
  excerpt: ReactNode
  /** Optional bold first line, usually the matching docs page/section title. */
  title?: ReactNode
  /** Optional documentation deep link; opens in a new tab. */
  href?: string
}

export interface HelpTipProps extends HelpTipContent {
  /** Accessible name for the affordance; defaults from the title. */
  ariaLabel?: string
  sx?: SxProps
  /** Forwarded to the icon button — e.g. to stop propagation when the tip
   * sits inside a clickable parent like an accordion summary. */
  onClick?: MouseEventHandler<HTMLElement>
}

/**
 * Unobtrusive question-mark help affordance: hover for a brief explanation,
 * click (when `href` is set) to open the documentation page in a new tab.
 * The shared primitive behind the console's docs help system (AGL-599..601).
 */
export function HelpTip(props: HelpTipProps) {
  const { excerpt, title, href, ariaLabel, sx, onClick } = props

  const label =
    ariaLabel ??
    (typeof title === 'string' ? `Help: ${title}` : 'Help')

  const content = (
    <Stack spacing={0.5} sx={{ p: 0.5, maxWidth: 280 }}>
      {title ? (
        <Typography variant="subtitle2" component="span">
          {title}
        </Typography>
      ) : null}
      <Typography variant="caption" component="span">
        {excerpt}
      </Typography>
      {href ? (
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
      ) : null}
    </Stack>
  )

  const iconSx = mergeSxProps(
    {
      color: 'text.disabled',
      ':hover': { color: 'text.secondary' },
    },
    sx,
  )

  return (
    <Tooltip arrow enterDelay={150} title={content}>
      {href ? (
        <IconButton
          component="a"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          size="small"
          aria-label={`${label} — open documentation in a new tab`}
          sx={iconSx}
          onClick={onClick}
        >
          <MdiIcon path={mdiHelpCircleOutline.path} fontSize="inherit" />
        </IconButton>
      ) : (
        <IconButton
          size="small"
          aria-label={label}
          sx={iconSx}
          onClick={onClick}
        >
          <MdiIcon path={mdiHelpCircleOutline.path} fontSize="inherit" />
        </IconButton>
      )}
    </Tooltip>
  )
}
HelpTip.displayName = 'HelpTip'
HelpTip.aglyn = true

export default HelpTip
