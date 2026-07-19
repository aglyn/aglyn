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

import * as Aglyn from '@aglyn/aglyn'
import { mdiLockReset } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'member-recovery'

export interface MemberRecoveryProps {
  heading?: string
  signinPath?: string
}

/**
 * Password recovery block (AGL-552), styled to match the customer-account
 * forms. Two modes on one block: without a `token` query param it shows
 * the request-email form (/api/membership/recover — always "sent", no
 * account-existence leak); with one it shows the new-password form
 * (/api/membership/reset) and links to sign-in on success. Drop it on the
 * screen designated as the site's recovery page (AGL-553) — the built-in
 * /recover route renders the same flows when no screen is designated.
 */
const MemberRecovery = forwardRef<HTMLDivElement, MemberRecoveryProps>(
  (props, ref) => {
    const { heading, signinPath, ...rest } = props
    const { hostId } = Aglyn.useSite()
    // Read post-hydration only: the block server-renders inside published
    // screens, where the query string is unavailable.
    const [token, setToken] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [done, setDone] = useState<'requested' | 'reset' | null>(null)
    useEffect(() => {
      setToken(
        new URLSearchParams(window.location.search).get('token') ?? '',
      )
    }, [])

    const signinHref = signinPath || '/signin'

    const handleRequest = useCallback(async () => {
      if (!hostId || busy) return
      setBusy(true)
      setError('')
      try {
        const response = await fetch('/api/membership/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, email }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          setError(String(payload?.error ?? 'Something went wrong'))
          return
        }
        setDone('requested')
      } finally {
        setBusy(false)
      }
    }, [hostId, busy, email])

    const handleReset = useCallback(async () => {
      if (!hostId || busy) return
      setBusy(true)
      setError('')
      try {
        const response = await fetch('/api/membership/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, token, password }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          setError(String(payload?.error ?? 'Something went wrong'))
          return
        }
        setDone('reset')
      } finally {
        setBusy(false)
      }
    }, [hostId, busy, token, password])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            p: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Password recovery — request and reset forms render here'}
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest} sx={{ maxWidth: 420 }}>
        <Typography variant="h5" gutterBottom>
          {heading || 'Reset your password'}
        </Typography>
        {done === 'reset' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Alert severity="success">
              {'Your password has been updated.'}
            </Alert>
            <Button
              variant="contained"
              color="primary"
              href={signinHref}
              sx={{ alignSelf: 'flex-start' }}
            >
              {'Sign in'}
            </Button>
          </Box>
        ) : done === 'requested' ? (
          <Alert severity="success">
            {'If that email belongs to an account here, a reset link is on ' +
              'its way. The link works once and expires in an hour.'}
          </Alert>
        ) : token ? (
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}
          >
            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              size="small"
              helperText="At least 8 characters"
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Button
              variant="contained"
              color="primary"
              disabled={busy || password.length < 8}
              onClick={handleReset}
            >
              {busy ? 'Working…' : 'Set new password'}
            </Button>
          </Box>
        ) : (
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}
          >
            <Typography variant="body2" color="text.secondary">
              {'Enter your account email and we will send you a reset link.'}
            </Typography>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              size="small"
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Button
              variant="contained"
              color="primary"
              disabled={busy || !email}
              onClick={handleRequest}
            >
              {busy ? 'Working…' : 'Email me a reset link'}
            </Button>
            <Typography variant="body2">
              <Link href={signinHref} underline="hover">
                {'Back to sign in'}
              </Link>
            </Typography>
          </Box>
        )}
      </Box>
    )
  },
)
MemberRecovery.displayName = 'AglynMemberRecovery'

export const schema: Aglyn.ComponentSchema<MemberRecoveryProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Password recovery',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiLockReset.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the recovery forms.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'signinPath',
      label: 'Sign-in path',
      description: 'Where "Back to sign in" points (default /signin).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Password recovery',
    pluginId: BUNDLE_ID,
    description: 'Forgot-password request and reset forms',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiLockReset.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default MemberRecovery
