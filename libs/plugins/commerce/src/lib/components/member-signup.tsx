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
import { mdiAccountPlusOutline } from '@aglyn/shared-data-mdi'
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
export const ID: Aglyn.ComponentId = 'member-signup'

export interface MemberSignupProps {
  heading?: string
  signinPath?: string
  continueFallback?: string
}

/**
 * Standalone sign-up block (AGL-553), extracted from the customer-account
 * create-account tab. Registers through the AGL-109 membership API (with
 * the same belt-and-braces follow-up login the account block does), then
 * sends the new member to the validated `continue` query param (relative
 * paths only) or the configured fallback.
 */
const MemberSignup = forwardRef<HTMLDivElement, MemberSignupProps>(
  (props, ref) => {
    const { heading, signinPath, continueFallback, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { hostId } = Aglyn.useSite()
    const siteFetch = Aglyn.useSiteFetch()
    const [displayName, setDisplayName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const handleSignup = useCallback(async () => {
      if (!hostId || busy) return
      setBusy(true)
      setError('')
      try {
        const response = await siteFetch('/api/membership/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            email,
            password,
            ...(displayName ? { displayName } : {}),
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          setError(String(payload?.error ?? 'Sign-up failed'))
          return
        }
        // Register does not set the cookie on every deployment; sign in
        // right after to be safe (same as the customer-account block).
        await siteFetch('/api/membership/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, email, password }),
        }).catch(() => undefined)
        window.location.assign(
          continuePathFromLocation(continueFallback || '/'),
        )
      } finally {
        setBusy(false)
      }
    }, [hostId, busy, displayName, email, password, continueFallback, siteFetch])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              p: 3,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'system-ui, sans-serif',
            },
            ...nodeSx,
          ]}
        >
          {'Member sign-up — the create-account form renders here'}
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest} sx={[{ maxWidth: 420 }, ...nodeSx]}>
        {heading ? (
          <Typography variant="h5" gutterBottom>
            {heading}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            label="Name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            size="small"
          />
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
            helperText="At least 8 characters"
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Button
            variant="contained"
            color="primary"
            disabled={busy || !email || password.length < 8}
            onClick={handleSignup}
          >
            {busy ? 'Working…' : 'Create account'}
          </Button>
          <Typography variant="body2">
            <Link href={signinPath || '/signin'} underline="hover">
              {'Already a member? Sign in'}
            </Link>
          </Typography>
        </Box>
      </Box>
    )
  },
)
MemberSignup.displayName = 'AglynMemberSignup'

export const schema: Aglyn.ComponentSchema<MemberSignupProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Member sign-up',
  category: Aglyn.ComponentCategory.MEMBERS,
  icon: { path: mdiAccountPlusOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the form.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'signinPath',
      label: 'Sign-in path',
      description: 'Where "Already a member?" points (default /signin).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'continueFallback',
      label: 'After sign-up',
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
    displayName: 'Member sign-up',
    pluginId: BUNDLE_ID,
    description: 'Create-account form for site membership',
    category: Aglyn.ComponentCategory.MEMBERS,
    icon: { path: mdiAccountPlusOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Create your account' },
    },
  },
]

export default MemberSignup
