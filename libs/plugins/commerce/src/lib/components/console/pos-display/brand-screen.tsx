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

import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import { useColorScheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import type { PosDisplayBranding } from './pos-display-api'

/** The store's logo for the scheme in use, its name when it has none. */
export function PosDisplayBrandMark({ branding }: { branding: PosDisplayBranding | null }) {
  const { mode, systemMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'
  const logo = (dark && branding?.logoDarkUrl) || branding?.logoUrl || null
  if (logo) {
    return (
      <Box
        component="img"
        src={logo}
        alt={branding?.name ?? ''}
        sx={(theme) => ({
          maxWidth: '80%',
          maxHeight: theme.spacing(24),
          objectFit: 'contain',
        })}
      />
    )
  }
  return (
    <Typography variant="h2" component="p" sx={{ textAlign: 'center' }}>
      {branding?.name || 'Welcome'}
    </Typography>
  )
}

/**
 * A centered full-screen message under the store's mark: the idle screen,
 * the thank-you, the card reader prompt and "the cashier will finish up".
 */
export function PosDisplayBrandScreen({
  branding,
  title,
  message,
  busy,
  children,
}: {
  branding: PosDisplayBranding | null
  title?: string
  message?: string
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <Stack
      spacing={4}
      sx={{
        minHeight: '100dvh',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: 2,
      }}
    >
      <PosDisplayBrandMark branding={branding} />
      {title ? (
        <Typography variant="h3" component="h1">
          {title}
        </Typography>
      ) : null}
      {message ? (
        <Typography variant="h5" component="p" color="text.secondary">
          {message}
        </Typography>
      ) : null}
      {busy ? <CircularProgress size={64} aria-label="Waiting for the card reader" /> : null}
      {children}
    </Stack>
  )
}
