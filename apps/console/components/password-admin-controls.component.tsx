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

import { PASSWORD_MIN_LENGTH } from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Divider, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useState } from 'react'

/** Unambiguous alphabet: no O/0, l/1/I — these get read aloud and retyped. */
const GENERATOR_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function generatePassword(length = 20): string {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(
    values,
    (value) => GENERATOR_ALPHABET[value % GENERATOR_ALPHABET.length],
  ).join('')
}

export interface PasswordAdminControlsProps {
  /** Where the reset link goes; absent disables both actions. */
  email: string | null | undefined
  /** What the account is called in the confirmation dialogs. */
  subjectLabel: string
  /** Sends a reset link. Reject or throw to report failure. */
  onSendReset: () => Promise<void>
  /** Sets the password directly. Reject or throw to report failure. */
  onSetPassword: (password: string) => Promise<void>
  /**
   * Why setting a password directly is unavailable here. When set, the
   * reset-email action stays but the form is replaced by this explanation —
   * an org admin can only take over accounts that belong to their org alone
   * (AGL-913), and the person needs to know which rule stopped them.
   */
  setPasswordBlockedReason?: string | null
  /** Extra context above the actions, e.g. what "signed out" means here. */
  description?: string
}

/**
 * Admin-facing password actions (AGL-910), shared by the three account
 * surfaces: staff users, org team members, and site members. Presentational
 * only — each surface passes handlers that hit its own endpoint, because the
 * three sit on entirely different identity stores.
 *
 * The generated password is shown in clear text on purpose. An admin who
 * sets a password has to convey it to the account holder, so masking it
 * would only mean it gets copied wrong; the confirmation dialog is where the
 * weight of the action is carried instead.
 */
export function PasswordAdminControls(props: PasswordAdminControlsProps) {
  const {
    email,
    subjectLabel,
    onSendReset,
    onSetPassword,
    setPasswordBlockedReason,
    description,
  } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSendReset = useCallback(async () => {
    if (busy || !email) return
    const accepted = await confirm({
      title: 'Send a password reset email?',
      description:
        `${email} gets a link to choose a new password. Their current ` +
        'password keeps working until they use it.',
      confirmationText: 'Send email',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await onSendReset()
      enqueueSnackbar(`Reset email sent to ${email}`, {
        variant: 'success',
        persist: false,
      })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Sending the reset email failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, email, confirm, onSendReset, enqueueSnackbar])

  const handleSetPassword = useCallback(async () => {
    if (busy || password.length < PASSWORD_MIN_LENGTH) return
    const accepted = await confirm({
      title: 'Set this password?',
      description:
        `${subjectLabel} is signed out everywhere and can only sign back ` +
        'in with the password you set here. They are emailed to say an ' +
        'admin changed it. Make sure you can pass the new password to them ' +
        'over a channel you trust.',
      confirmationText: 'Set password',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await onSetPassword(password)
      setPassword('')
      enqueueSnackbar('Password set — the account holder was emailed', {
        variant: 'success',
        persist: false,
      })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Setting the password failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    password,
    subjectLabel,
    confirm,
    onSetPassword,
    enqueueSnackbar,
  ])

  if (!email) {
    return (
      <Alert severity="info">
        {'This account has no email address, so password help is not ' +
          'available for it.'}
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      {description ? (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      ) : null}
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => void handleSendReset()}
        >
          {'Send password reset email'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {`Emails ${email} a link to choose their own password. Preferred — ` +
            'nobody else ever sees the new one.'}
        </Typography>
      </Stack>

      <Divider textAlign="left">{'Or set a password directly'}</Divider>

      {setPasswordBlockedReason ? (
        <Alert severity="info">{setPasswordBlockedReason}</Alert>
      ) : (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignSelf: 'stretch', alignItems: 'flex-start' }}
          >
            <TextField
              size="small"
              label="New password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { autoComplete: 'new-password' } }}
              helperText={
                password && password.length < PASSWORD_MIN_LENGTH
                  ? `At least ${PASSWORD_MIN_LENGTH} characters`
                  : 'Shown in the clear so you can pass it on accurately'
              }
            />
            <Button
              size="small"
              onClick={() => setPassword(generatePassword())}
              sx={{ mt: 0.5 }}
            >
              {'Generate'}
            </Button>
          </Stack>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={busy || password.length < PASSWORD_MIN_LENGTH}
            onClick={() => void handleSetPassword()}
          >
            {busy ? 'Working…' : 'Set password'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {'Signs the account out everywhere and emails the holder that ' +
              'an admin changed it.'}
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}
PasswordAdminControls.displayName = 'PasswordAdminControls'

export default PasswordAdminControls
