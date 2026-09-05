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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { Stack, Tooltip, Typography } from '@mui/material'

export interface ReportStatTileProps {
  /** Caption above the figure, e.g. `New contacts`. */
  label: string
  /**
   * The figure, already formatted, or `null` when it has not been measured —
   * the read is pending or was refused. `null` draws a dash, never a zero.
   */
  value: string | null
  /**
   * Change against the previous period, in percent, or `null` when there is
   * no baseline. `null` renders NOTHING — see below.
   */
  deltaPct?: number | null
  /** What the delta is measured against, for the tooltip. */
  deltaCaption?: string
  /** A line under the figure naming what it counts. */
  note?: string
  /** Whether a rise is good. A rise in overdue tasks is not. */
  riseIsGood?: boolean
  /** Where the figure leads — the list it summarizes. */
  href?: string
  /** Paints the figure, e.g. `error.main` for an overdue count above zero. */
  color?: string
}

/**
 * One report figure with an optional period-over-period delta, the shape
 * the commerce stat tile draws revenue in.
 *
 * Two rules carried over from there and from the shared `Figure`:
 *
 *  - **A `null` value draws a dash, not a zero.** A count that has not
 *    arrived, or that the server refused, is not zero of anything, and a
 *    zero would be read as a measurement.
 *  - **A `null` delta renders nothing — not `+0%`, not `—`.** The delta is
 *    `null` exactly when the previous period held nothing, and every way of
 *    drawing that is a lie: `+100%` reads as growth, `+0%` reads as flat,
 *    and a dash reads as "we could not work it out". A first contact has no
 *    growth rate.
 *
 * The tile links to the list it summarizes when it can, because a figure
 * a reader cannot open is a figure they cannot check.
 */
export function ReportStatTile(props: ReportStatTileProps) {
  const {
    label,
    value,
    deltaPct = null,
    deltaCaption = 'vs the previous period',
    note,
    riseIsGood = true,
    href,
    color,
  } = props
  const rose = (deltaPct ?? 0) > 0
  const flat = deltaPct === 0
  const deltaColor = flat
    ? 'text.secondary'
    : rose === riseIsGood
      ? 'success.main'
      : 'error.main'
  const figure = (
    <Typography variant="h6" sx={color ? { color } : undefined}>
      {value === null ? '—' : value}
    </Typography>
  )
  return (
    <Stack sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
        {href ? (
          <AppLink href={href} underline="hover" color="inherit">
            {figure}
          </AppLink>
        ) : (
          figure
        )}
        {deltaPct === null || value === null ? null : (
          <Tooltip title={deltaCaption}>
            <Typography
              variant="caption"
              sx={{ color: deltaColor, fontWeight: 'fontWeightMedium' }}
            >
              {`${deltaPct > 0 ? '+' : ''}${deltaPct}%`}
            </Typography>
          </Tooltip>
        )}
      </Stack>
      {note ? (
        <Typography variant="caption" color="text.secondary">
          {value === null ? 'not measured yet' : note}
        </Typography>
      ) : null}
    </Stack>
  )
}
ReportStatTile.displayName = 'ReportStatTile'

export default ReportStatTile
