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
import { mdiLoginVariant } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { continuePathFromLocation } from '../utils/member-continue'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'member-signin'

export interface MemberSigninProps {
  heading?: string
  signupPath?: string
  recoveryPath?: string
  continueFallback?: string
}

/**
 * Standalone sign-in block (AGL-553), extracted from the customer-account
 * sign-in tab so besigner-built auth screens can be designed like any
 * other page. Same AGL-109 membership API; on success the visitor lands
 * on the validated `continue` query param (relative paths only) or the
 * configured fallback.
 */
const MemberSignin = forwardRef<HTMLDivElement, MemberSigninProps>(
  (props, ref) => {
    const { heading, signupPath, recoveryPath, continueFallback, ...rest } =
      props
    const { hostId } = Aglyn.useSite()
    const siteFetch = Aglyn.useSiteFetch()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const handleSignin = useCallback(async () => {
      if (!hostId || busy) return
      setBusy(true)
      setError('')
      try {
        const response = await siteFetch('/api/membership/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, email, password }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          setError(String(payload?.error ?? 'Sign-in failed'))
          return
        }
        window.location.assign(
          continuePathFromLocation(continueFallback || '/'),
        )
      } finally {
        setBusy(false)
      }
    }, [hostId, busy, email, password, continueFallback, siteFetch])

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
          {'Member sign-in — the email/password form renders here'}
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest} sx={{ maxWidth: 420 }}>
        {heading ? (
          <Typography variant="h5" gutterBottom>
            {heading}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            size="small"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            size="small"
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Button
            variant="contained"
            color="primary"
            disabled={busy || !email || !password}
            onClick={handleSignin}
          >
            {busy ? 'Working…' : 'Sign in'}
          </Button>
          <Typography variant="body2">
            <Link href={signupPath || '/signup'} underline="hover">
              {'New here? Create an account'}
            </Link>
            {' · '}
            <Link href={recoveryPath || '/recover'} underline="hover">
              {'Forgot password?'}
            </Link>
          </Typography>
        </Box>
      </Box>
    )
  },
)
MemberSignin.displayName = 'AglynMemberSignin'

export const schema: Aglyn.ComponentSchema<MemberSigninProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Member sign-in',
  category: Aglyn.ComponentCategory.MEMBERS,
  icon: { path: mdiLoginVariant.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the form.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'signupPath',
      label: 'Sign-up path',
      description: 'Where "Create an account" points (default /signup).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'recoveryPath',
      label: 'Recovery path',
      description: 'Where "Forgot password?" points (default /recover).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'continueFallback',
      label: 'After sign-in',
      description:
        'Where members land when the URL has no continue param (default /).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Member sign-in',
    pluginId: BUNDLE_ID,
    description: 'Email/password sign-in with recovery link',
    category: Aglyn.ComponentCategory.MEMBERS,
    icon: { path: mdiLoginVariant.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Welcome back' },
    },
  },
]

export default MemberSignin
