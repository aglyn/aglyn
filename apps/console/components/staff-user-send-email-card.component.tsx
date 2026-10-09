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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

/** One sendable email, as `GET /api/admin/users/system-email` lists it. */
interface SendableEmail {
  key: string
  name: string
  description: string
  actionLink: boolean
  followUp: boolean
  tokens: Array<{ name: string; description: string; sample: string }>
  values: Record<string, string>
}

interface SendableList {
  account: {
    email: string
    emailVerified: boolean
    suppressed: boolean
    configured: boolean
  }
  emails: SendableEmail[]
}

interface Preview {
  subject: string
  html: string
  to: string
}

const FOLLOW_UP_KEY = 'staff-follow-up'

/**
 * SEND THIS ACCOUNT AN EMAIL (AGL-3691).
 *
 * Any system email in the catalog, or a follow-up a staffer writes, sent to
 * the account this page shows. A verification or reset link is minted by the
 * server when the email is sent. The preview shows a placeholder where the
 * link will go, so opening it spends nothing and shows no live credential.
 *
 * Preview first, always: Send is only offered on the dialog that shows the
 * rendered email, so nobody sends a message they have not looked at.
 */
export function StaffUserSendEmailCard({ uid }: { uid: string }) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [list, setList] = useState<SendableList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [key, setKey] = useState(FOLLOW_UP_KEY)
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return undefined
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/admin/users/system-email?uid=${encodeURIComponent(uid)}`,
        )
        const payload = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setLoadError(payload?.error ?? 'Could not load the email list')
          return
        }
        setList(payload as SendableList)
      } catch (error) {
        if (active) setLoadError((error as Error)?.message ?? 'Load failed')
      }
    })()
    return () => {
      active = false
    }
  }, [user, uid])

  const selected = useMemo(
    () => list?.emails.find((entry) => entry.key === key) ?? null,
    [list, key],
  )

  // A new email starts from what the server filled in for this account.
  useEffect(() => {
    setValues(selected ? { ...selected.values } : {})
  }, [selected])

  const post = useCallback(
    async (send: boolean) => {
      if (!user || !selected) return null
      const response = await authorizedFetch(user, '/api/admin/users/system-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, templateKey: selected.key, mergeValues: values, send }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? `Failed (${response.status})`)
      return payload
    },
    [user, selected, uid, values],
  )

  const openPreview = useCallback(async () => {
    setBusy(true)
    try {
      const payload = await post(false)
      if (payload) setPreview({ subject: payload.subject, html: payload.html, to: payload.to })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [post, enqueueSnackbar])

  const send = useCallback(async () => {
    setBusy(true)
    try {
      await post(true)
      setPreview(null)
      enqueueSnackbar('Sent. It will show under Email delivery once the provider reports it.', {
        variant: 'success',
      })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [post, enqueueSnackbar])

  const verificationRefused =
    selected?.key === 'email-verification' && list?.account.emailVerified === true

  return (
    <CardDisplay
      header="Send an email"
      help={docsHelp('staffConsole', {
        anchor: '#whats-there',
        excerpt:
          'Send this account any system email, or a follow-up you write, from the platform sender. ' +
          'Links are minted fresh when you send, and every send is audited.',
      })}
      contentGutterX
      contentGutterY
    >
      {loadError ? (
        <Alert severity="warning">{loadError}</Alert>
      ) : !list ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {list.account.suppressed ? (
            <Alert severity="warning">
              {'This address is on the suppression list, so nothing can be sent to it until it is released.'}
            </Alert>
          ) : null}
          {!list.account.configured ? (
            <Alert severity="info">
              {'Email delivery is not configured here. You can preview but not send.'}
            </Alert>
          ) : null}
          <TextField
            select
            size="small"
            label="Email"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          >
            {list.emails.map((entry) => (
              <MenuItem key={entry.key} value={entry.key}>
                {entry.name}
              </MenuItem>
            ))}
          </TextField>
          {selected ? (
            <Typography variant="body2" color="text.secondary">
              {selected.description}
              {selected.actionLink ? ' The link is minted when you send.' : ''}
            </Typography>
          ) : null}
          {verificationRefused ? (
            <Alert severity="info">{'This account has already confirmed its email address.'}</Alert>
          ) : null}
          {selected?.tokens.map((token) => {
            const minted = selected.actionLink && /Url$/.test(token.name) && token.name in selected.values
            return (
              <TextField
                key={token.name}
                size="small"
                label={token.name}
                helperText={minted ? 'Minted by the server when you send' : token.description}
                placeholder={token.sample}
                value={values[token.name] ?? ''}
                disabled={minted}
                multiline={token.name === 'message.body'}
                minRows={token.name === 'message.body' ? 5 : undefined}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [token.name]: event.target.value }))
                }
              />
            )
          })}
          <Box>
            <Button
              variant="contained"
              disabled={busy || !selected || verificationRefused}
              onClick={() => void openPreview()}
            >
              {'Preview'}
            </Button>
          </Box>
        </Stack>
      )}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} fullWidth maxWidth="md">
        <DialogTitle>{preview?.subject}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {`To ${preview?.to ?? ''}, from the platform sender.`}
          </Typography>
          {preview?.html ? (
            <Box
              component="iframe"
              title="Email preview"
              // Empty sandbox: opaque origin, no scripts, no navigation.
              sandbox=""
              srcDoc={preview.html}
              sx={{
                width: '100%',
                height: 480,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                backgroundColor: 'common.white',
              }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            onClick={() => void send()}
            disabled={busy || list?.account.suppressed || !list?.account.configured}
          >
            {'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

export default StaffUserSendEmailCard
