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

import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import Tooltip from '@mui/material/Tooltip'
import { StatusChip } from './status-chip.component'

/** What the chip reads. One word, the same on every surface that wears it. */
export const BETA_CHIP_LABEL = 'Beta'

/**
 * What Beta means to the reader, as the chip's hover and screen-reader
 * description: the feature is open, not a preview, and it is still changing.
 */
export const BETA_CHIP_DESCRIPTION =
  'Available on every plan that includes it, and still changing as we improve it.'

export interface BetaChipProps {
  /** Spacing from what it sits beside; the chip itself takes no margin. */
  sx?: SxProps<Theme>
  'data-testid'?: string
}

/**
 * The Beta label for a released feature that is still changing (AGL-4052),
 * beside its nav tab, its page heading or its panel title.
 *
 * Inline on purpose: the root is a `span` and so is the chip, because it sits
 * inside a heading or a tab label. The description is attached with
 * `describeChild`, so a tab or heading keeps "Beta" as part of its name
 * rather than taking the sentence as its name.
 */
export function BetaChip(props: BetaChipProps) {
  const { sx } = props
  return (
    <Tooltip title={BETA_CHIP_DESCRIPTION} describeChild>
      <Box
        component="span"
        data-testid={props['data-testid']}
        data-release-stage="beta"
        sx={[
          { display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <StatusChip
          label={BETA_CHIP_LABEL}
          tone="info"
          variant="outlined"
          component="span"
        />
      </Box>
    </Tooltip>
  )
}
BetaChip.displayName = 'BetaChip'

export default BetaChip
