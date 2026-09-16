'use client'

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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AI_PAGE_TYPES, type AiPageType } from '../model/ai-page-job'

/**
 * "Describe a page" (AGL-2907): the brief dialog both entry points open, the
 * Screens page's "Describe it" and the Assist panel's AI jobs.
 *
 * One text box and an optional page type start a `page` job. The job plans
 * first and waits in AI jobs, where the member confirms the plan and opens
 * the draft once it is built; nothing here builds or writes anything.
 */

/** The longest brief a job admits. */
const BRIEF_MAX_CHARS = 4_000

export interface AiPageBriefDialogProps {
  open: boolean
  onClose: () => void
  orgId: string | undefined
  hostId: string
  /** Who is signed in, whose token the request carries. */
  user: Parameters<typeof authorizedFetch>[0]
}

export function AiPageBriefDialog({ open, onClose, orgId, hostId, user }: AiPageBriefDialogProps) {
  // Held in a ref so the request reads WHO is signed in, and nothing keys on
  // the identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const [brief, setBrief] = useState('')
  const [pageType, setPageType] = useState<AiPageType | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!open) return
    setNotice(null)
    setStarted(false)
  }, [open])

  const start = useCallback(async () => {
    if (!orgId || !brief.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'page',
          brief: brief.trim(),
          inputs: pageType ? { pageType } : {},
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The page could not be started. Try again.'),
        )
        return
      }
      setStarted(true)
      setBrief('')
      setPageType(null)
    } catch {
      setNotice('The page could not be started. Try again.')
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, brief, pageType])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{'Describe a page'}</DialogTitle>
      <DialogContent>
        {started ? (
          <Alert severity="success">
            {'The page is being planned. Open AI jobs in the Assist panel to review the plan and '}
            {'confirm it. The page is built as an unpublished draft.'}
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="What is the page for?"
              placeholder="A landing page for our spring roof inspection offer, with the quote request form"
              multiline
              minRows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
              helperText={`${brief.length.toLocaleString('en-US')} / ${BRIEF_MAX_CHARS.toLocaleString('en-US')}`}
              disabled={busy}
              autoFocus
            />
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary" id="ai-page-type-label">
                {'Page type (optional)'}
              </Typography>
              <Stack
                direction="row"
                useFlexGap
                role="group"
                aria-labelledby="ai-page-type-label"
                sx={{ flexWrap: 'wrap', gap: 1 }}
              >
                {AI_PAGE_TYPES.map((type) => (
                  <Chip
                    key={type.id}
                    label={type.label}
                    color={pageType === type.id ? 'primary' : 'default'}
                    variant={pageType === type.id ? 'filled' : 'outlined'}
                    onClick={() => setPageType((current) => (current === type.id ? null : type.id))}
                    aria-pressed={pageType === type.id}
                    disabled={busy}
                  />
                ))}
              </Stack>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {'A plan comes first, and nothing is built until you confirm it. The page uses your '}
              {'theme, your layout and the components and forms the site already has.'}
            </Typography>
            {notice ? <Alert severity="warning">{notice}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {started ? 'Close' : 'Cancel'}
        </Button>
        {started ? null : (
          <Button
            variant="contained"
            onClick={() => void start()}
            disabled={busy || !orgId || !brief.trim()}
          >
            {'Plan the page'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export default AiPageBriefDialog
