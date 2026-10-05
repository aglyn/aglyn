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

import { Button, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { useState, type MouseEvent } from 'react'
import {
  useTransferLauncher,
  type TransferAccessTarget,
  type TransferUnfinishedImport,
} from './transfer-launcher-context'

/** "today", or the day an import was last touched. */
function touched(at: number): string {
  const day = new Date(at)
  return day.toDateString() === new Date().toDateString()
    ? `today ${day.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** What one unfinished import is called in the list. */
function nameOf(job: TransferUnfinishedImport): string {
  return job.fileName || job.label
}

export interface TransferResumeImportProps {
  /** The resource the surface imports into, and the site — as its Import button opens it. */
  target: TransferAccessTarget
  /** The wizard's title, as the surface's Import button sets it. */
  title?: string
  /** Called when the person leaves the resumed wizard from its results. */
  onFinished?(): void
}

/**
 * "Resume import" beside a surface's Import (AGL-3549): the imports the
 * person started on this resource and left before anything was written —
 * a tab closed mid-wizard — each reopened where it stopped
 * (`openImport({ jobId })`) or discarded. Draws nothing outside the
 * console shell, for a person who may not import here, or when there is
 * nothing to resume. Every choice made in the wizard is kept with the job,
 * so a resumed import opens on the step it was left at.
 */
export function TransferResumeImport(props: TransferResumeImportProps) {
  const { target, title, onFinished } = props
  const launcher = useTransferLauncher()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [discarding, setDiscarding] = useState<string | null>(null)
  if (!launcher?.unfinished || !launcher.can('import', target)) return null
  const jobs = launcher.unfinished(target)
  if (!jobs.length) return null

  const resume = (job: TransferUnfinishedImport) => {
    setAnchor(null)
    launcher.openImport({
      resource: job.resource,
      scope: target.scope,
      ...(job.hostId ? { hostId: job.hostId } : {}),
      jobId: job.jobId,
      ...(title ? { title } : {}),
      ...(onFinished ? { onFinished } : {}),
    })
  }
  const discard = async (event: MouseEvent, job: TransferUnfinishedImport) => {
    event.stopPropagation()
    setDiscarding(job.jobId)
    try {
      await launcher.discard?.(job.jobId)
    } finally {
      setDiscarding(null)
    }
  }

  return (
    <>
      <Button
        size="small"
        aria-haspopup="menu"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {jobs.length === 1 ? 'Resume import' : `Resume import (${jobs.length})`}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {jobs.map((job) => (
          <MenuItem key={job.jobId} onClick={() => resume(job)} disabled={discarding === job.jobId}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Stack>
                <Typography variant="body2">{nameOf(job)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {`Left ${touched(job.updatedAt)}`}
                </Typography>
              </Stack>
              <Button size="small" color="error" onClick={(event) => void discard(event, job)} disabled={discarding === job.jobId}>
                {'Discard'}
              </Button>
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
TransferResumeImport.displayName = 'TransferResumeImport'

export default TransferResumeImport
