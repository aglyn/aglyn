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

import { mdiPhoneOff } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

interface SuppressionRecord {
  $id: string
  phoneNumber: string
  channels: string[]
  source: string
  uid: string | null
  recordedByUid: string | null
  note: string | null
  erasePhoneOnFile: boolean
  revokedAt: { seconds?: number; _seconds?: number } | null
  updatedAt?: { seconds?: number; _seconds?: number } | null
}

function formatWhen(value: SuppressionRecord['updatedAt']): string {
  const seconds = value?.seconds ?? value?._seconds
  return seconds ? new Date(seconds * 1000).toLocaleString() : ''
}

/**
 * The do-not-contact queue (AGL-1592) — the human end of Privacy Policy v4
 * §11.
 *
 * §11 tells people they can opt out of marketing calls and texts by replying
 * STOP, by saying so on a call, or by emailing privacy@aglyn.com. Two of those
 * three routes end at a person, not at a system, and until this page there was
 * nowhere for that person to put the request. This is that place: whoever
 * reads privacy@ or takes the call records it here, and the record is what an
 * outbound programme has to consult before it dials.
 *
 * THE TWO REQUESTS ARE NOT THE SAME REQUEST, which is why the form has a
 * checkbox rather than one button. "Stop contacting me" keeps the number —
 * that is what makes it enforceable. "Delete the number you hold for me"
 * additionally clears the profile copy and blocks the customer's IdP from
 * re-asserting it at the next SSO sign-in, and it STILL keeps the number on
 * this list, because a number nobody recognises is a number that gets dialled.
 * The reasoning in full is in libs/tenant/data/admin/.../contact-suppression.ts.
 */
const AdminContactSuppressions: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const request = useCallback(
    async (
      method: string,
      body?: Record<string, unknown>,
    ): Promise<any | null> => {
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
        const response = await fetch('/api/admin/contact-suppressions', {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Request failed', {
            variant: 'warning',
            persist: false,
          })
          return null
        }
        return payload
      } catch {
        enqueueSnackbar('An error has occurred', { variant: 'error' })
        return null
      }
    },
    [user, enqueueSnackbar],
  )

  const [records, setRecords] = useState<SuppressionRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  const [phoneNumber, setPhoneNumber] = useState('')
  const [source, setSource] = useState('email')
  const [channels, setChannels] = useState<string[]>(['calls', 'texts'])
  const [erase, setErase] = useState(false)
  const [uid, setUid] = useState('')
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    if (!user) return
    const payload = await request('GET')
    if (payload?.records) setRecords(payload.records)
    setLoaded(true)
  }, [user, request])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleChannel = (channel: string) => () =>
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel],
    )

  const record = useCallback(async () => {
    setBusy(true)
    try {
      const payload = await request('POST', {
        phoneNumber,
        source,
        channels,
        erasePhoneOnFile: erase,
        uid: uid.trim() || null,
        note: note.trim() || null,
      })
      if (!payload) return
      enqueueSnackbar(
        erase
          ? 'Recorded. The number is suppressed and will not be re-stored from SSO.'
          : 'Recorded on the do-not-contact list.',
        { variant: 'success' },
      )
      setPhoneNumber('')
      setUid('')
      setNote('')
      setErase(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [request, phoneNumber, source, channels, erase, uid, note, refresh, enqueueSnackbar])

  const release = useCallback(
    (value: string) => async () => {
      setBusy(true)
      try {
        const payload = await request('POST', {
          phoneNumber: value,
          action: 'release',
        })
        if (payload) await refresh()
      } finally {
        setBusy(false)
      }
    },
    [request, refresh],
  )

  const active = records.filter((entry) => !entry.revokedAt)

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Do not contact',
          href: buildRoute(Route.ADMIN_CONTACT_SUPPRESSIONS),
        },
      ]}
      help="staffConsole"
      header={{
        children: 'Do not contact',
        icon: { path: mdiPhoneOff.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={2}>
            <Alert severity="info">
              {
                'No marketing calls or texts may be sent yet — there is no consent record behind them. This list is what an outbound programme must check once there is one.'
              }
            </Alert>

            <CardDisplay
              header="Record a request"
              contentGutterX
              contentGutterY
            >
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'For an opt-out that arrived by email to privacy@aglyn.com or during a call. Replying STOP to a text is handled automatically once texting exists.'
                  }
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    label="Phone number"
                    placeholder="+1 512 555 0123"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                    helperText="Include the country code."
                  />
                  <TextField
                    label="How it arrived"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    size="small"
                    select
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="email">{'Email'}</MenuItem>
                    <MenuItem value="verbal">{'Said on a call'}</MenuItem>
                    <MenuItem value="staff">{'Other / staff'}</MenuItem>
                  </TextField>
                </Stack>
                <Stack direction="row" spacing={0.5}>
                  {['calls', 'texts'].map((channel) => (
                    <Chip
                      key={channel}
                      size="small"
                      label={channel === 'calls' ? 'Calls' : 'Texts'}
                      color={channels.includes(channel) ? 'primary' : 'default'}
                      variant={channels.includes(channel) ? 'filled' : 'outlined'}
                      onClick={toggleChannel(channel)}
                    />
                  ))}
                </Stack>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={erase}
                      onChange={(event) => setErase(event.target.checked)}
                    />
                  }
                  label="They also asked us to delete the number we hold"
                />
                {erase ? (
                  <>
                    <Alert severity="warning">
                      {
                        'The number stays on this list — that is the only way to keep it from being dialled again. What is deleted is the copy on their profile, and SSO is blocked from re-asserting it.'
                      }
                    </Alert>
                    <TextField
                      label="Account uid"
                      value={uid}
                      onChange={(event) => setUid(event.target.value)}
                      size="small"
                      helperText="Needed to clear the stored copy. Without it the number is still suppressed."
                    />
                  </>
                ) : null}
                <TextField
                  label="Note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  size="small"
                  multiline
                  minRows={2}
                  helperText="What they actually asked for, and where it came from."
                />
                <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    disabled={busy || !phoneNumber.trim() || !channels.length}
                    onClick={() => void record()}
                  >
                    {'Record request'}
                  </Button>
                </Stack>
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={
                active.length
                  ? `Suppressed numbers · ${active.length}`
                  : 'Suppressed numbers'
              }
              contentGutterX
              contentGutterY
            >
              <Stack spacing={1.5}>
                {loaded && records.length === 0 ? (
                  <Alert severity="info">
                    {'Nobody has asked us to stop contacting them.'}
                  </Alert>
                ) : null}
                {records.map((entry) => (
                  <Stack
                    key={entry.$id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="body2">
                          {entry.phoneNumber}
                        </Typography>
                        {(entry.channels ?? []).map((channel) => (
                          <Chip
                            key={channel}
                            size="small"
                            label={channel}
                            color={entry.revokedAt ? 'default' : 'warning'}
                          />
                        ))}
                        {entry.erasePhoneOnFile ? (
                          <Chip size="small" label="erased on file" />
                        ) : null}
                        {entry.revokedAt ? (
                          <Chip size="small" label="opted back in" />
                        ) : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {`${entry.source} · ${formatWhen(entry.updatedAt)}${
                          entry.note ? ` · ${entry.note}` : ''
                        }`}
                      </Typography>
                    </Stack>
                    {entry.revokedAt ? null : (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={release(entry.phoneNumber)}
                      >
                        {'Opted back in'}
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminContactSuppressions.displayName = 'Page:AdminContactSuppressions'

export default AdminContactSuppressions
