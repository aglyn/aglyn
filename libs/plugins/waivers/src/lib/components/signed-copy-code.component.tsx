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

import { Paper, Stack, Typography } from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'

/**
 * The signed copy as a code to scan (AGL-4042), on the window's tablet or
 * the register's display, which is not the signer's to keep a file on.
 * Loaded only when a signing there finishes.
 */
export default function SignedCopyCode(props: { href: string }) {
  const absolute = typeof window === 'undefined' ? props.href : new URL(props.href, window.location.origin).toString()
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
      <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'common.white', lineHeight: 0 }}>
        <QRCodeSVG value={absolute} size={128} aria-label="Code to download your signed copy" />
      </Paper>
      <Typography variant="body2">
        {'Scan with your phone to download your signed copy (PDF). The code works for an hour.'}
      </Typography>
    </Stack>
  )
}
