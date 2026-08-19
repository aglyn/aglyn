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

import { Box, Stack, Tooltip, Typography } from '@mui/material'

export interface CommerceStatTileProps {
  /** Caption above the figure, e.g. `Revenue`. */
  label: string
  /** The figure itself, already formatted. */
  value: string
  /**
   * Percentage change against the immediately preceding window of the same
   * length, or `null` when there is no baseline. `null` renders NOTHING —
   * see below.
   */
  deltaPct?: number | null
  /** What the delta is measured against, for the tooltip. */
  deltaCaption?: string
  /**
   * Whether a rise is good. Revenue up is good; nothing on this surface is
   * inverted yet, but a refund-rate tile would be, and baking "up is green"
   * into the component is how that gets rendered backwards later.
   */
  riseIsGood?: boolean
}

/**
 * One money tile with a period-over-period delta (AGL-2136).
 *
 * Every commerce and console mockup we publish shows the figures carrying a
 * delta — `Revenue $26,540 +8.1%`, `Orders 1,204 +5.6%` — and the product
 * had no prior-window computation at all, so no surface could render one.
 *
 * **A `null` delta renders nothing, not `+0%` and not `—`.** The delta is
 * `null` exactly when the prior window held no orders, and every way of
 * drawing that is a lie: `+100%` reads as growth, `+0%` reads as flat, and
 * `—` reads as "we could not work it out". A first sale has no growth rate.
 */
export function CommerceStatTile(props: CommerceStatTileProps) {
  const {
    label,
    value,
    deltaPct = null,
    deltaCaption = 'vs the previous period',
    riseIsGood = true,
  } = props
  const rose = (deltaPct ?? 0) > 0
  const flat = deltaPct === 0
  const color = flat
    ? 'text.secondary'
    : rose === riseIsGood
      ? 'success.main'
      : 'error.main'
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
        <Typography variant="h6">{value}</Typography>
        {deltaPct === null ? null : (
          <Tooltip title={deltaCaption}>
            <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
              {`${deltaPct > 0 ? '+' : ''}${deltaPct}%`}
            </Typography>
          </Tooltip>
        )}
      </Stack>
    </Box>
  )
}
CommerceStatTile.displayName = 'CommerceStatTile'

export default CommerceStatTile
