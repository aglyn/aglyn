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

import type { MediaLibraryDirection } from '@aglyn/aglyn/app-utils/media-library-move'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import {
  libraryName,
  moveToOtherLibraryIntro,
  moveToOtherLibraryLabel,
  movedToOtherLibraryMessage,
  partialOtherLibraryMessage,
} from './media-library-move-copy'

type AuthorizedUser = Parameters<typeof authorizedFetch>[0]

interface Refused {
  mediaId: string
  name: string
  reason: string
}

interface Preview {
  movable: string[]
  refused: Refused[]
  documents: number
}

export interface MediaLibraryMoveResult {
  movedIds: string[]
  message: string
  variant: 'success' | 'warning' | 'error'
}

export interface MediaLibraryMoveDialogProps {
  open: boolean
  user: AuthorizedUser
  orgId: string
  hostId: string
  direction: MediaLibraryDirection
  mediaIds: string[]
  /** File names by id, for the report. */
  nameOf: (mediaId: string) => string
  onClose: () => void
  /** Called once the move has run, with what to say and what moved. */
  onFinished: (result: MediaLibraryMoveResult) => void
}

/**
 * Asks before moving files to the other library, saying what will move, what
 * has to stay and why, and how many uses will be updated; then moves them,
 * resumably, and reports the way a folder move does.
 */
export function MediaLibraryMoveDialog(props: MediaLibraryMoveDialogProps) {
  const { open, user, orgId, hostId, direction, mediaIds, nameOf, onClose, onFinished } = props
  const [preview, setPreview] = useState<Preview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    if (!open || !mediaIds.length) return
    let live = true
    setPreview(null)
    setProblem(null)
    authorizedFetch(user, '/api/media/move-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, hostId, direction, mediaIds, preview: true }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!live) return
        if (!response.ok) {
          setProblem(payload?.error ?? 'Could not check where these files are used')
          return
        }
        setPreview({
          movable: payload.movable ?? [],
          refused: payload.refused ?? [],
          documents: Number(payload.documents ?? 0),
        })
      })
      .catch(() => {
        if (live) setProblem('Could not check where these files are used')
      })
    return () => {
      live = false
    }
  }, [open, user, orgId, hostId, direction, mediaIds])

  const run = async () => {
    if (!preview?.movable.length) return
    const movedIds: string[] = []
    const notMoved: Array<{ mediaId: string; name: string; reason?: string }> = preview.refused.map(
      (one) => ({ mediaId: one.mediaId, name: one.name, reason: one.reason }),
    )
    let rewrote = 0
    let pending = [...preview.movable]
    let transportError: string | null = null
    setProgress({ done: 0, total: preview.movable.length })
    try {
      while (pending.length) {
        const response = await authorizedFetch(user, '/api/media/move-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, hostId, direction, mediaIds: pending }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          transportError = payload?.error ?? null
          break
        }
        const chunkMoved: string[] = payload.movedIds ?? []
        movedIds.push(...chunkMoved)
        rewrote += Number(payload.rewrote?.uses ?? 0)
        for (const one of [...(payload.failed ?? []), ...(payload.refused ?? [])] as Refused[]) {
          notMoved.push({ mediaId: one.mediaId, name: one.name, reason: one.reason })
        }
        setProgress({ done: movedIds.length, total: preview.movable.length })
        const remaining: string[] = payload.remainingIds ?? []
        if (!chunkMoved.length && !(payload.failed ?? []).length) break
        pending = remaining
      }
    } finally {
      setProgress(null)
    }
    // Anything this loop did not hear back about is "not moved yet": it is
    // reported as unmoved and stays selected.
    for (const mediaId of preview.movable) {
      if (!movedIds.includes(mediaId) && !notMoved.some((one) => one.mediaId === mediaId)) {
        notMoved.push({ mediaId, name: nameOf(mediaId) })
      }
    }
    const total = mediaIds.length
    if (!notMoved.length) {
      onFinished({
        movedIds,
        variant: 'success',
        message: movedToOtherLibraryMessage(direction, movedIds.length, rewrote),
      })
      return
    }
    onFinished({
      movedIds,
      variant: movedIds.length ? 'warning' : 'error',
      message:
        !movedIds.length && transportError
          ? transportError
          : partialOtherLibraryMessage({
              direction,
              moved: movedIds.length,
              total,
              rewrote,
              notMoved,
            }),
    })
  }

  const busy = Boolean(progress)
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{moveToOtherLibraryLabel(direction)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {problem ? <Alert severity="error">{problem}</Alert> : null}
          {!problem && !preview ? (
            <Stack spacing={1}>
              <Typography variant="body2">
                {'Checking every page, product and setting that uses these files…'}
              </Typography>
              <LinearProgress />
            </Stack>
          ) : null}
          {preview ? (
            <>
              {preview.movable.length ? (
                <Typography variant="body2">
                  {moveToOtherLibraryIntro(direction, preview.movable.length, preview.documents)}
                </Typography>
              ) : (
                <Typography variant="body2">
                  {`None of these files can move to ${libraryName(direction)}.`}
                </Typography>
              )}
              {preview.refused.length ? (
                <Alert severity="info">
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {`${preview.refused.length} file${preview.refused.length === 1 ? '' : 's'} will stay where ${preview.refused.length === 1 ? 'it is' : 'they are'}:`}
                  </Typography>
                  {preview.refused.slice(0, 8).map((one) => (
                    <Typography key={one.mediaId} variant="body2">
                      {`${one.name}: ${one.reason.replace(/^Stays in the organization library: /, '')}`}
                    </Typography>
                  ))}
                  {preview.refused.length > 8 ? (
                    <Typography variant="body2">{`and ${preview.refused.length - 8} more`}</Typography>
                  ) : null}
                </Alert>
              ) : null}
            </>
          ) : null}
          {progress ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {`Moving ${progress.done} of ${progress.total} file${progress.total === 1 ? '' : 's'}…`}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={progress.total ? (progress.done / progress.total) * 100 : 0}
              />
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !preview?.movable.length}
          onClick={() => void run()}
        >
          {preview?.movable.length
            ? `Move ${preview.movable.length} file${preview.movable.length === 1 ? '' : 's'}`
            : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
MediaLibraryMoveDialog.displayName = 'MediaLibraryMoveDialog'
