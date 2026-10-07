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

import { mdiAlertCircleOutline, mdiTrayArrowDown } from '@aglyn/shared-data-mdi'
import { Chip, CircularProgress, Tooltip } from '@mui/material'
import type { ReactElement, ReactNode } from 'react'
import MdiIcon from './mdi-icon/mdi-icon'

/**
 * A download size as a person reads it: `0 KB`, `38 KB`, `1.2 MB`.
 * Kilobytes are 1,024 bytes, as browsers' network panels count them.
 */
export function formatDownloadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** `38 KB · 2 files`, approximate when `approximate`. */
export function downloadCostLabel(
  bytes: number,
  files: number,
  approximate = false,
): string {
  const size = `${approximate ? '≈ ' : ''}${formatDownloadSize(bytes)}`
  if (!files) return size
  return `${size} · ${files} ${files === 1 ? 'file' : 'files'}`
}

export interface DownloadCostBadgeProps {
  /** Bytes a visitor downloads; absent while unknown. */
  bytes?: number | null
  /** How many files those bytes are. */
  files?: number | null
  /** Shows `≈`: some of the size could not be measured, or it is an estimate. */
  approximate?: boolean
  /** Still measuring. */
  loading?: boolean
  /** Why it could not be measured; shows the badge's error state. */
  error?: string | null
  /** What the figure counts, for the badge's tooltip. */
  tooltip?: ReactNode
  /** The label while measuring. */
  loadingLabel?: string
}

/**
 * What something costs a visitor to download, as one small badge: the size
 * and the number of files, with a tooltip saying what is counted, and its
 * own measuring and failed states (AGL-3656, first for the font picker).
 *
 * A badge, not a sentence, because it sits beside a choice and is read at a
 * glance while comparing two. NOT in the barrel: subpath-import it.
 */
export function DownloadCostBadge(props: DownloadCostBadgeProps) {
  const {
    bytes,
    files,
    approximate = false,
    loading = false,
    error = null,
    tooltip,
    loadingLabel = 'Measuring…',
  } = props
  let chip: ReactElement
  if (loading) {
    chip = (
      <Chip
        size="small"
        variant="outlined"
        icon={<CircularProgress size="1em" color="inherit" />}
        label={loadingLabel}
        aria-busy
      />
    )
  } else if (error || bytes === null || bytes === undefined) {
    chip = (
      <Chip
        size="small"
        variant="outlined"
        color="warning"
        icon={<MdiIcon path={mdiAlertCircleOutline.path} />}
        label="Size unavailable"
      />
    )
  } else {
    chip = (
      <Chip
        size="small"
        variant="outlined"
        color={bytes === 0 ? 'success' : 'default'}
        icon={<MdiIcon path={mdiTrayArrowDown.path} />}
        label={downloadCostLabel(bytes, files ?? 0, approximate)}
      />
    )
  }
  const title = error ?? tooltip
  if (!title) return <>{chip}</>
  return (
    <Tooltip title={title} describeChild>
      {chip}
    </Tooltip>
  )
}
DownloadCostBadge.displayName = 'DownloadCostBadge'

export default DownloadCostBadge
