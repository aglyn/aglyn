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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Chip, Stack, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import { submissionFileSize, type SubmissionFile } from '../model/submission-presenter'

/**
 * The forms plugin's route for a submission's files (AGL-4098), by address:
 * this plugin shows the files and may not import the plugin that keeps them.
 */
export const FORM_SUBMISSION_FILE_API_PATH = '/api/forms/submission-file'

export interface SubmissionFilesProps {
  hostId: string
  submissionId: string
  files: readonly SubmissionFile[]
}

/**
 * The files an open submission carries (AGL-4098): each by name and size,
 * downloaded when pressed through the forms plugin's member-gated route, with
 * the member's own token. Nothing is shown inside the console: every file,
 * a picture included, is saved to the reader's computer.
 */
export function SubmissionFiles(props: SubmissionFilesProps) {
  const { hostId, submissionId, files } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState<string | null>(null)

  const download = useCallback(
    async (file: SubmissionFile) => {
      setBusy(file.id)
      try {
        const response = await authorizedFetch(user, FORM_SUBMISSION_FILE_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'download', hostId, submissionId, fileId: file.id }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          enqueueSnackbar(payload?.error ?? `${file.name} could not be downloaded`, {
            variant: 'error',
            allowDuplicate: true,
          })
          return
        }
        const url = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
      } catch {
        enqueueSnackbar(`${file.name} could not be downloaded`, { variant: 'error', allowDuplicate: true })
      } finally {
        setBusy(null)
      }
    },
    [user, hostId, submissionId, enqueueSnackbar],
  )

  if (!files.length) return null
  return (
    <Stack spacing={0.75} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {files.length === 1 ? 'File' : `Files (${files.length})`}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {files.map((file) => (
          <Chip
            key={file.id}
            size="small"
            variant="outlined"
            label={`${file.name} · ${submissionFileSize(file.size)}`}
            onClick={() => void download(file)}
            disabled={busy === file.id}
            title={`Download ${file.name}`}
          />
        ))}
      </Stack>
    </Stack>
  )
}
SubmissionFiles.displayName = 'SubmissionFiles'

export default SubmissionFiles
