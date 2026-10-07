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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import type { ConsoleMediaLibraryZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_IMAGE_ASPECT_RATIOS,
  AI_IMAGE_MAX_COUNT,
  AI_IMAGE_PROMPT_MAX_CHARS,
  type AiImageAspectRatio,
} from '../providers/image-contract'

/**
 * "Create with AI" in Media (AGL-3602): pictures from a description, added
 * to the library that is open, through the `mediaLibrary` zone beside Upload
 * media and in the library's empty state.
 *
 * Renders nothing until the door has answered for this workspace: the shell
 * decided the plan, the member's permission and the plugin's enablement
 * before mounting it, and whether this deployment has an image provider, and
 * whether the generative release is on, are the door's to say. A 404 or a 403
 * there is this control staying absent.
 */

/** What the door's GET answers when the button may show. */
export interface AiMediaImageVerdict {
  model: { id: string; label: string }
  aspectRatios: readonly string[]
  maxCount: number
  creditsPerImage: number
}

/** The words each shape is offered in. */
const ASPECT_LABELS: Record<AiImageAspectRatio, string> = {
  '1:1': 'Square',
  '4:3': 'Landscape',
  '3:4': 'Portrait',
  '16:9': 'Wide',
  '9:16': 'Tall',
}

/** The sentence the estimate reads as, before anything is spent. */
export function aiMediaCreditEstimate(count: number, creditsPerImage: number): string {
  const pictures = count === 1 ? '1 picture' : `${count} pictures`
  return `${pictures} uses ${(count * creditsPerImage).toLocaleString()} AI credits (${creditsPerImage.toLocaleString()} each). A picture the safety filter holds back is not charged.`
}

type Verdict = { state: 'checking' } | { state: 'hidden' } | { state: 'ready'; door: AiMediaImageVerdict }

export function AiMediaCreateButton({
  hostId,
  orgId,
  library,
  folderId,
  onCreated,
}: ConsoleMediaLibraryZoneProps) {
  const { data: user } = useUser()
  // Held in a ref so the probe keys on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<Verdict>({ state: 'checking' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/media/images?orgId=${encodeURIComponent(orgId)}`,
        )
        const payload = response.ok ? await response.json().catch(() => null) : null
        if (!active) return
        setVerdict(
          payload && typeof payload.creditsPerImage === 'number'
            ? { state: 'ready', door: payload as AiMediaImageVerdict }
            : { state: 'hidden' },
        )
      } catch {
        if (active) setVerdict({ state: 'hidden' })
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, uid])

  if (verdict.state !== 'ready' || !orgId) return null
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
      >
        {'Create with AI'}
      </Button>
      <AiMediaCreateDialog
        open={open}
        onClose={() => setOpen(false)}
        door={verdict.door}
        orgId={orgId}
        hostId={hostId}
        library={library}
        folderId={folderId}
        onCreated={onCreated}
      />
    </>
  )
}

export interface AiMediaCreateDialogProps
  extends Pick<ConsoleMediaLibraryZoneProps, 'hostId' | 'library' | 'folderId' | 'onCreated'> {
  open: boolean
  onClose: () => void
  door: AiMediaImageVerdict
  orgId: string
}

export function AiMediaCreateDialog({
  open,
  onClose,
  door,
  orgId,
  hostId,
  library,
  folderId,
  onCreated,
}: AiMediaCreateDialogProps) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AiImageAspectRatio>('1:1')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ severity: 'error' | 'warning' | 'success'; text: string } | null>(null)

  useEffect(() => {
    if (open) setNotice(null)
  }, [open])

  const maxCount = Math.max(1, Math.min(AI_IMAGE_MAX_COUNT, door.maxCount))
  const create = useCallback(async () => {
    const description = prompt.trim()
    if (!description) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/media/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          library,
          hostId,
          folderId,
          prompt: description,
          aspectRatio,
          count,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice({
          severity: 'error',
          text: locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The pictures could not be made — try again.'),
        })
        return
      }
      const ids: string[] = Array.isArray(payload?.mediaIds) ? payload.mediaIds : []
      onCreated(ids)
      const held = Number(payload?.filtered ?? 0) + Number(payload?.failed ?? 0)
      if (held > 0) {
        setNotice({
          severity: 'warning',
          text:
            `Added ${ids.length} of ${count} to the library. ` +
            (payload?.warning
              ? String(payload.warning)
              : 'The rest were held back by the safety filter and were not charged.'),
        })
        return
      }
      setPrompt('')
      onClose()
    } catch {
      setNotice({ severity: 'error', text: 'The pictures could not be made — try again.' })
    } finally {
      setBusy(false)
    }
  }, [prompt, orgId, library, hostId, folderId, aspectRatio, count, onCreated, onClose])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{'Create images with AI'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Describe the picture"
            placeholder="A sunlit bakery counter with fresh sourdough loaves, warm morning light"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, AI_IMAGE_PROMPT_MAX_CHARS))}
            multiline
            minRows={3}
            autoFocus
            disabled={busy}
            helperText="Pictures of children are not made. The description becomes each picture's alt text."
          />
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {'Shape'}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={aspectRatio}
              onChange={(_event, next) => {
                if (next) setAspectRatio(next)
              }}
              aria-label="Shape"
              disabled={busy}
              sx={{ flexWrap: 'wrap' }}
            >
              {AI_IMAGE_ASPECT_RATIOS.filter((ratio) => door.aspectRatios.includes(ratio)).map(
                (ratio) => (
                  <ToggleButton key={ratio} value={ratio} aria-label={`${ASPECT_LABELS[ratio]} ${ratio}`}>
                    {`${ASPECT_LABELS[ratio]} ${ratio}`}
                  </ToggleButton>
                ),
              )}
            </ToggleButtonGroup>
          </Stack>
          <TextField
            select
            size="small"
            label="How many"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            disabled={busy}
            sx={{ maxWidth: 160 }}
          >
            {Array.from({ length: maxCount }, (_unused, index) => index + 1).map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" color="text.secondary">
            {aiMediaCreditEstimate(count, door.creditsPerImage)}
          </Typography>
          {busy ? (
            <Stack spacing={1}>
              <LinearProgress />
              <Typography variant="body2" color="text.secondary">
                {'Making your pictures and adding them to the library…'}
              </Typography>
            </Stack>
          ) : null}
          {notice ? <Alert severity={notice.severity}>{notice.text}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Close'}
        </Button>
        <Button variant="contained" onClick={() => void create()} disabled={busy || !prompt.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default AiMediaCreateButton
