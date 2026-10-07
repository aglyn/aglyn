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

import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiClose, mdiInformationOutline } from '@mdi/js'
import { Alert, Box, Chip, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { describeFontLicense } from '../license'
import type { FontJob } from '../use-font-installer'
import { describeScripts, type FontSubsetScript } from '../unicode-ranges'

/** One file on its way in: what it is, how far it got, and what was kept. */

const STEP_LABEL: Record<FontJob['step'], string> = {
  queued: 'Waiting…',
  checking: 'Checking the license and converting for the web…',
  saving: 'Saving to your media library…',
  installed: 'Installed',
  failed: 'Not installed',
}

export const kilobytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`

export function FontJobRow(props: { job: FontJob; onDismiss: () => void }) {
  const { job, onDismiss } = props
  const { face } = job
  const working = job.step === 'queued' || job.step === 'checking' || job.step === 'saving'
  const license = face ? describeFontLicense(face.license.embedding, face.license.noSubsetting) : null
  const saved = face && face.bytesIn > face.bytesOut ? Math.round((1 - face.bytesOut / face.bytesIn) * 100) : 0
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} aria-busy={working || undefined}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ pt: 0.25, color: job.step === 'failed' ? 'error.main' : job.step === 'installed' ? 'success.main' : 'text.secondary' }}>
          <MdiIcon
            fontSize="small"
            color="inherit"
            path={job.step === 'failed' ? mdiAlertCircleOutline : job.step === 'installed' ? mdiCheckCircleOutline : mdiInformationOutline}
          />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap title={job.fileName} sx={{ fontWeight: 'fontWeightMedium' }}>
            {face ? `${face.family} ${face.subfamily}` : job.fileName}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {face
              ? [
                  job.fileName,
                  face.weightMax ? `weights ${face.weight}–${face.weightMax}` : `weight ${face.weight}`,
                  face.style === 'italic' ? 'italic' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `${STEP_LABEL[job.step]}${job.step === 'failed' ? '' : ` ${kilobytes(job.bytes)}`}`}
          </Typography>
        </Box>
        {working ? null : (
          <IconButton size="small" onClick={onDismiss} aria-label={`Dismiss ${job.fileName}`} sx={{ mt: -0.5, mr: -0.5 }}>
            <MdiIcon path={mdiClose} fontSize="small" />
          </IconButton>
        )}
      </Stack>
      {working ? (
        <Box sx={{ mt: 1 }}>
          <LinearProgress aria-label={STEP_LABEL[job.step]} />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {STEP_LABEL[job.step]}
          </Typography>
        </Box>
      ) : null}
      {face && license && job.step !== 'failed' ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tooltip title={`${license.detail} (OS/2 fsType ${face.license.fsType})`}>
            <Chip size="small" variant="outlined" color={license.tone} label={license.label} />
          </Tooltip>
          <Chip
            size="small"
            variant="outlined"
            label={`${kilobytes(face.bytesIn)} → ${kilobytes(face.bytesOut)}${saved > 0 ? ` (${saved}% smaller)` : ''}`}
          />
          {face.scripts.length ? (
            <Chip size="small" variant="outlined" label={describeScripts(face.scripts as FontSubsetScript[])} />
          ) : null}
          {job.step === 'installed' && job.replaced ? (
            <Chip size="small" variant="outlined" label="Replaced the file in your media library" />
          ) : null}
        </Stack>
      ) : null}
      {face?.warnings.length && job.step !== 'failed' ? (
        <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
          {face.warnings.join(' ')}
        </Alert>
      ) : null}
      {job.error ? (
        <Alert severity="error" variant="outlined" sx={{ mt: 1 }}>
          {job.error}
        </Alert>
      ) : null}
    </Paper>
  )
}
