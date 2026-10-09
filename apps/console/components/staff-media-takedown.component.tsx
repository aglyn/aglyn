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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface StaffMediaTakedownProps {
  /** The library: `orgId=…` or `hostId=…`, as the media card asked for it. */
  scopeQuery: string
  mediaId: string
}

/** The quarantine route's scope fields, from the card's query. */
export function takedownScopeOf(scopeQuery: string): { orgId?: string; hostId?: string } {
  const params = new URLSearchParams(scopeQuery)
  const orgId = params.get('orgId')
  const hostId = params.get('hostId')
  return orgId ? { orgId } : hostId ? { hostId } : {}
}

/**
 * The copyright takedown for one file (AGL-3716), in the staff media dialog.
 *
 * Not a second mechanism: it writes the platform's asset quarantine with the
 * `dmca` reason, through `/api/admin/media-quarantine` in `by: "media"` mode,
 * which derives the key from the file and needs the `super` staff role. From
 * then on the CDN refuses the file with a neutral 410 wherever it is used —
 * a Music player says "This track is unavailable", a page's image goes blank
 * — and the owner's library shows the takedown notice. Restore lifts every
 * key covering the file.
 *
 * Every action re-reads the state and shows the server's answer, never the
 * one it hoped for (the quarantine page's read-back rule).
 */
export function StaffMediaTakedown({ scopeQuery, mediaId }: StaffMediaTakedownProps) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [quarantined, setQuarantined] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scope = takedownScopeOf(scopeQuery)
  const lookup = `/api/admin/media-quarantine?${new URLSearchParams({
    ...scope,
    mediaId,
  }).toString()}`

  const read = useCallback(async () => {
    const response = await authorizedFetch(userRef.current, lookup)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error ?? 'The takedown state could not be read')
    setQuarantined(payload?.quarantined === true)
  }, [lookup])

  useEffect(() => {
    read().catch((caught) => setError((caught as Error).message))
  }, [read])

  const act = useCallback(
    async (action: 'quarantine' | 'release') => {
      setBusy(true)
      setError(null)
      try {
        const response = await authorizedFetch(userRef.current, '/api/admin/media-quarantine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            by: 'media',
            ...takedownScopeOf(scopeQuery),
            mediaId,
            ...(action === 'quarantine'
              ? { reason: 'dmca', ...(note.trim() ? { note: note.trim() } : {}) }
              : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error ?? 'The takedown did not go through')
        await read()
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [scopeQuery, mediaId, note, read],
  )

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{'Copyright takedown'}</Typography>
      <Typography variant="body2" color="text.secondary">
        {quarantined === null
          ? 'Reading…'
          : quarantined
            ? 'Taken down: the CDN refuses this file everywhere it is used, and the owner sees the notice.'
            : 'Serving. Taking it down quarantines it with the DMCA reason: the CDN refuses it wherever it is used, a music player shows "This track is unavailable", and it can be restored.'}
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {quarantined === false ? (
        <TextField
          size="small"
          label="Staff note (notice number, rights holder)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
      ) : null}
      <Stack direction="row" spacing={1}>
        {quarantined === false ? (
          <Button color="error" variant="outlined" disabled={busy} onClick={() => void act('quarantine')}>
            {'Take down for copyright'}
          </Button>
        ) : null}
        {quarantined ? (
          <Button variant="outlined" disabled={busy} onClick={() => void act('release')}>
            {'Restore'}
          </Button>
        ) : null}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {'Needs the super staff role. Recorded in the quarantine audit trail.'}
      </Typography>
    </Stack>
  )
}

export default StaffMediaTakedown
