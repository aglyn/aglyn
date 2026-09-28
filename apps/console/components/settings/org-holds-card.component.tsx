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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useOrgScope } from '../../hooks/use-org-scope'

/** One notice as `/api/orgs/risk-notices` hands it over (`OwnerRiskNoticeView`). */
interface HoldNotice {
  noticeId: string
  kind: string
  severity: 'info' | 'warning' | 'urgent' | string
  title: string
  summary: string
  meaning: string
  steps: string[]
  actions: Array<{ id: string; label: string; hint: string; href: string }>
  reference: string | null
  occurredAtMs: number
  helpUrl: string
  status: 'held' | 'in-review' | 'released' | 'rejected' | 'closed' | null
  reviewable: boolean
  reviewRequests: Array<{ atMs: number; note: string; mine: boolean }>
}

const STATUS_LABELS: Record<string, { label: string; color: 'default' | 'warning' | 'success' | 'error' | 'info' }> = {
  held: { label: 'Held', color: 'warning' },
  'in-review': { label: 'In review', color: 'info' },
  released: { label: 'Released', color: 'success' },
  rejected: { label: 'Not approved', color: 'error' },
  closed: { label: 'Closed', color: 'default' },
}

/** The shortest note a review request takes, matching the server. */
const NOTE_MIN = 10

/**
 * HOLDS & REVIEWS (AGL-3368): everything on the workspace that was held,
 * flagged, locked or paused — in the words of the notice its owners were
 * sent — with its status and what to do next.
 *
 * The one thing an owner can do about a hold here is ask for a review: a
 * note to our team on the same case. There is no release and no lift: those
 * are staff's decisions, and nothing on this card can make them.
 *
 * A notice's "Request a review" link lands here as `?notice=<id>` and opens
 * the request for that notice.
 */
export default function OrgHoldsCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { currentOrg } = useOrgScope()
  const orgId = currentOrg?.$id ? String(currentOrg.$id) : ''
  const [notices, setNotices] = useState<HoldNotice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [requesting, setRequesting] = useState<HoldNotice | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [linkedNoticeId, setLinkedNoticeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const response = await authorizedFetch(
        user,
        `/api/orgs/risk-notices?orgId=${encodeURIComponent(orgId)}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? `Failed (${response.status})`)
      setNotices(Array.isArray(payload.notices) ? payload.notices : [])
    } catch (caught: any) {
      setError(caught?.message ?? 'Reading holds and reviews failed')
      setNotices(null)
    } finally {
      setLoading(false)
    }
  }, [orgId, user])

  const signedInUid = (user as { uid?: string } | null | undefined)?.uid
  useEffect(() => {
    if (!signedInUid || !orgId) return
    void load()
    // Keyed on who and which workspace, not on `load`, whose identity
    // changes every render with `useUser`'s object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUid, orgId])

  // A notice link opens its request (`?notice=<id>`).
  useEffect(() => {
    if (typeof window === 'undefined') return
    setLinkedNoticeId(new URLSearchParams(window.location.search).get('notice'))
  }, [])
  useEffect(() => {
    if (!linkedNoticeId || !notices) return
    const linked = notices.find((notice) => notice.noticeId === linkedNoticeId)
    if (linked?.reviewable) setRequesting(linked)
    setLinkedNoticeId(null)
  }, [linkedNoticeId, notices])

  const submit = useCallback(async () => {
    if (!requesting || note.trim().length < NOTE_MIN) return
    setSending(true)
    try {
      const response = await authorizedFetch(user, '/api/orgs/risk-notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, noticeId: requesting.noticeId, note: note.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? `Failed (${response.status})`)
      enqueueSnackbar(
        `Review requested${payload.reference ? ` — reference ${payload.reference}` : ''}. We’ll email you when it’s done.`,
        { variant: 'success' },
      )
      setRequesting(null)
      setNote('')
      await load()
    } catch (caught: any) {
      enqueueSnackbar(caught?.message ?? 'The review request did not send', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSending(false)
    }
  }, [requesting, note, orgId, user, enqueueSnackbar, load])

  return (
    <CardDisplay
      header="Holds & reviews"
      subheader="Anything on this workspace that was held, flagged or locked, and what to do about it"
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={loading} onClick={() => void load()}>
              {'Refresh'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {loading ? <LinearProgress /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {notices && notices.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing on this workspace is held or under review.'}
          </Typography>
        ) : null}
        {(notices ?? []).map((notice) => {
          const status = notice.status ? STATUS_LABELS[notice.status] : null
          const mine = notice.reviewRequests.filter((request) => request.mine)
          return (
            <Box
              key={notice.noticeId}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                  <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                    {notice.title}
                  </Typography>
                  {status ? <Chip size="small" color={status.color} label={status.label} /> : null}
                  {notice.severity === 'urgent' ? (
                    <Chip size="small" color="error" variant="outlined" label="Needs attention" />
                  ) : null}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {`${new Date(notice.occurredAtMs).toLocaleString()}${
                    notice.reference ? ` · Reference ${notice.reference}` : ''
                  }`}
                </Typography>
                <Typography variant="body2">{notice.summary}</Typography>
                <Typography variant="body2">{notice.meaning}</Typography>
                <Typography variant="subtitle2">{'What to do next'}</Typography>
                <Box component="ol" sx={{ m: 0, pl: 3 }}>
                  {notice.steps.map((step, index) => (
                    <Typography key={index} component="li" variant="body2">
                      {step}
                    </Typography>
                  ))}
                </Box>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  {notice.actions.map((action) =>
                    action.id === 'request-review' ? (
                      notice.reviewable ? (
                        <Button
                          key={action.id}
                          size="small"
                          variant="contained"
                          title={action.hint}
                          onClick={() => setRequesting(notice)}
                        >
                          {action.label}
                        </Button>
                      ) : null
                    ) : (
                      <AppLink
                        key={action.id}
                        componentVariant="button"
                        size="small"
                        variant="outlined"
                        title={action.hint}
                        href={action.href}
                      >
                        {action.label}
                      </AppLink>
                    ),
                  )}
                  <Link href={notice.helpUrl} target="_blank" rel="noopener" variant="body2" sx={{ alignSelf: 'center' }}>
                    {'Why was this held?'}
                  </Link>
                </Stack>
                {mine.length ? (
                  <Typography variant="caption" color="text.secondary">
                    {`You requested a review on ${new Date(mine[mine.length - 1].atMs).toLocaleString()}.`}
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          )
        })}
      </Stack>

      <Dialog
        open={Boolean(requesting)}
        onClose={() => (sending ? undefined : setRequesting(null))}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{'Request a review'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{requesting?.title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {
                'Tell us what this is for and why it is genuine. A person reads every request, on the same case our team already has open. Requesting a review does not release anything by itself.'
              }
            </Typography>
            <TextField
              label="Your note"
              multiline
              minRows={4}
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 2000))}
              helperText={
                note.trim().length < NOTE_MIN ? 'At least a sentence, please.' : `${note.length}/2000`
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={sending} onClick={() => setRequesting(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={sending || note.trim().length < NOTE_MIN}
            onClick={() => void submit()}
          >
            {'Send request'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
