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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { mdiLockOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { linkWithPopup, unlink } from 'firebase/auth'
import { useCallback, useState } from 'react'
import AccountIdentitiesCard from '../account-identities-card.component'
import { docsHelp } from '../../constants/docs-links'
import useAccountSignInMethods from '../../hooks/use-account-sign-in-methods'
import { createGoogleOAuthProvider } from '../../utils/oauth-providers'

/** Firebase providerId → a name a person recognizes (AGL-852). */
const PROVIDER_LABELS: Record<string, string> = {
  password: 'Email & password',
  'google.com': 'Google',
  'apple.com': 'Apple',
  'github.com': 'GitHub',
  'microsoft.com': 'Microsoft',
}

/** Official multicolor Google "G" (AGL-873), for the branded sign-in row/button. */
function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/**
 * The email this account signs in with, and the providers linked to it
 * (AGL-852/860/873).
 *
 * The Account section of Manage Account, its own component since the sections
 * became routes (AGL-693).
 */
export function AccountSignInCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { providerIds, ssoGoverned } = useAccountSignInMethods()

  // Connect/disconnect sign-in providers (AGL-860). link/unlink mutate the
  // User in place; bump a tick after reload() so `providerData` re-reads.
  const [linkBusy, setLinkBusy] = useState(false)
  const [, setProvidersTick] = useState(0)
  const refreshProviders = useCallback(async () => {
    try {
      await user.reload()
    } catch (error) {
      console.error('user reload failed', error)
    }
    setProvidersTick((tick) => tick + 1)
  }, [user])

  const connectGoogle = useCallback(async () => {
    // Refuse in the handler too, not just by hiding the button (AGL-1128).
    // Hiding a control is a UI decision; this is the intent, and it survives
    // a stale render. The real boundary is the tenant's provider config —
    // GCIP will reject a provider the tenant does not enable — but an
    // SSO bypass should never depend on a remote config staying right.
    if (ssoGoverned) {
      enqueueSnackbar(
        'Your organization signs in through its own identity provider — ' +
          'other sign-in methods cannot be connected.',
        { variant: 'warning' },
      )
      return
    }
    setLinkBusy(true)
    try {
      // The chooser matters most here (AGL-1415): without it this can only
      // ever link the account the device already holds, so anyone with a
      // second Google identity literally cannot connect the one they meant.
      await linkWithPopup(user, createGoogleOAuthProvider())
      await refreshProviders()
      enqueueSnackbar('Google connected', { variant: 'success' })
    } catch (error: any) {
      const code = error?.code as string | undefined
      // A closed/duplicated popup is a normal cancel — say nothing.
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        return
      }
      enqueueSnackbar(
        code === 'auth/credential-already-in-use' ||
          code === 'auth/email-already-in-use' ||
          code === 'auth/provider-already-linked'
          ? `That Google account is already linked to an ${PLATFORM_BRAND_NAME} account.`
          : 'Connecting Google failed',
        { variant: 'warning' },
      )
    } finally {
      setLinkBusy(false)
    }
  }, [user, refreshProviders, enqueueSnackbar, ssoGoverned])

  const disconnectProvider = useCallback(
    async (providerId: string, canRemove: boolean) => {
      if (!canRemove) {
        enqueueSnackbar("You can't remove your only sign-in method.", {
          variant: 'warning',
          persist: false,
        })
        return
      }
      setLinkBusy(true)
      try {
        await unlink(user, providerId)
        await refreshProviders()
        enqueueSnackbar(
          `${PROVIDER_LABELS[providerId] ?? providerId} disconnected`,
          { variant: 'success' },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Disconnecting failed', { variant: 'error' })
      } finally {
        setLinkBusy(false)
      }
    },
    [user, refreshProviders, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header={'Account'}
      help={docsHelp('account', {
        excerpt:
          'The email you sign in with and the providers linked to your ' +
          'account.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2.5} sx={{ maxWidth: 560 }}>
        <TextField
          label="Email"
          value={user?.email ?? ''}
          size="small"
          fullWidth
          slotProps={{ input: { readOnly: true } }}
          // Read-only HERE because changing the primary address has a policy
          // attached to it and belongs beside the list it reorders — which is
          // the Email addresses section, not the identity provider (AGL-2486).
          helperText="Your primary address. Add or change addresses in Email addresses."
        />
        <Chip
          size="small"
          variant="outlined"
          color={user?.emailVerified ? 'success' : 'warning'}
          label={user?.emailVerified ? 'Email verified' : 'Email unverified'}
          sx={{ alignSelf: 'flex-start' }}
        />

        {/* Sign-in methods (AGL-860, redesigned AGL-873). Email & password is
            the account baseline and is never disconnectable. */}
        <Box>
          <Typography variant="subtitle2">{'Sign-in methods'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {ssoGoverned
              ? `How you sign in to ${PLATFORM_BRAND_NAME}, managed by your organization.`
              : `How you sign in to ${PLATFORM_BRAND_NAME}. Connect another for a backup way in.`}
          </Typography>
        </Box>
        {providerIds.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No sign-in methods found.'}
          </Typography>
        ) : (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            {providerIds.map((id, index) => {
              const isGoogle = id === 'google.com'
              const isPassword = id === 'password'
              // Password is the account baseline — never removable. An OAuth
              // provider is removable only when it isn't the last method left.
              const canRemove =
                !isPassword && providerIds.filter((p) => p !== id).length > 0
              const sub = isGoogle
                ? (user?.email ?? 'Connected')
                : isPassword
                  ? 'Sign in with your email and password'
                  : 'Connected'
              return (
                <Box key={id}>
                  {index > 0 ? <Divider /> : null}
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', px: 2, py: 1.5 }}
                  >
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        bgcolor: isGoogle ? 'common.white' : 'action.hover',
                        border: isGoogle ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}
                    >
                      {isGoogle ? (
                        <GoogleGlyph />
                      ) : (
                        <MdiIcon
                          path={mdiLockOutline.path}
                          fontSize="small"
                          sx={{ color: 'text.secondary' }}
                        />
                      )}
                    </Box>
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {PROVIDER_LABELS[id] ?? id}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {sub}
                      </Typography>
                    </Stack>
                    {isPassword ? (
                      <Chip size="small" variant="outlined" label="Required" />
                    ) : (
                      <Button
                        size="small"
                        color="error"
                        disabled={linkBusy || !canRemove}
                        onClick={() => void disconnectProvider(id, canRemove)}
                      >
                        {'Disconnect'}
                      </Button>
                    )}
                  </Stack>
                </Box>
              )
            })}
          </Box>
        )}
        {ssoGoverned ? (
          <Alert severity="info" sx={{ alignSelf: 'stretch' }}>
            {'Your organization signs in through its own identity provider. ' +
              'Other sign-in methods are disabled so that access stays ' +
              'governed there — including when it is revoked.'}
          </Alert>
        ) : null}
        {!ssoGoverned && !providerIds.includes('google.com') ? (
          <Button
            variant="outlined"
            startIcon={<GoogleGlyph />}
            disabled={linkBusy}
            onClick={() => void connectGoogle()}
            sx={(theme) => ({
              alignSelf: 'flex-start',
              textTransform: 'none',
              fontWeight: 500,
              px: 2,
              py: 0.75,
              color: theme.palette.mode === 'dark' ? '#e3e3e3' : '#3c4043',
              backgroundColor:
                theme.palette.mode === 'dark' ? '#131314' : '#fff',
              borderColor:
                theme.palette.mode === 'dark' ? '#5f6368' : '#dadce0',
              '&:hover': {
                backgroundColor:
                  theme.palette.mode === 'dark' ? '#1f1f20' : '#f8f9fa',
                borderColor:
                  theme.palette.mode === 'dark' ? '#5f6368' : '#dadce0',
              },
            })}
          >
            {'Continue with Google'}
          </Button>
        ) : null}
        {/* Which records exist for this address (AGL-2119). Sits with the
            sign-in methods because that is the question it answers. */}
        <AccountIdentitiesCard />
      </Stack>
    </CardDisplay>
  )
}
AccountSignInCard.displayName = 'AccountSignInCard'

export default AccountSignInCard
