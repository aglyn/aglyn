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

import { LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import {
  mediaFilesLabel,
  type MediaFilesPlace,
  type MediaStorageBand,
  mediaStorageReadout,
} from './media-storage-copy'

export interface MediaLibraryUsageProps {
  /** Files in the open library, from its counter. */
  libraryCount: number
  /** The open folder, when one is; `null` for every file. */
  place?: MediaFilesPlace | null
  /** The open library's stored bytes, live. */
  scopeBytes: number
  /**
   * The org's band, or `null` to state no cap. The caller passes `null`
   * until the org has resolved, so a cold console never writes a cap at all.
   */
  band: MediaStorageBand | null
}

/** Why the cap is the workspace's, said where the cap is read. */
const POOLED_BAND_TIP =
  'Every site’s library and the organization’s shared library count toward ' +
  'one storage allowance for the workspace.'

/**
 * The library toolbar's readout (AGL-3470): the files line, the storage line,
 * and a slim meter under them once there is a cap to measure against — the
 * same tone the Billing page's usage meters take, amber as the band nears
 * and red at it.
 */
export function MediaLibraryUsage(props: MediaLibraryUsageProps) {
  const { libraryCount, place, scopeBytes, band } = props
  const storage = mediaStorageReadout({ scopeBytes, band })
  // The words stay secondary and only the bar takes the tone, exactly as a
  // Billing meter draws it.
  const storageLine = (
    <Typography variant="body2" color="text.secondary">
      {storage.text}
    </Typography>
  )
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">
        {mediaFilesLabel({ libraryCount, place })}
      </Typography>
      {storage.percent === null ? (
        storageLine
      ) : (
        <Tooltip title={POOLED_BAND_TIP}>{storageLine}</Tooltip>
      )}
      {storage.percent === null ? null : (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, storage.percent))}
          color={storage.tone}
          aria-label="Storage used"
          sx={{ height: 4, borderRadius: 2 }}
        />
      )}
    </Stack>
  )
}

export default MediaLibraryUsage
