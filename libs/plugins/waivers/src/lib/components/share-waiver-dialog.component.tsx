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

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { useMemo, useRef, useState } from 'react'
import type { WaiverTemplate } from '../model/waiver'
import { waiverShareLink } from './waivers-api'

/**
 * The share link and its QR code (AGL-4042), for a waiver signers open on
 * their own phones before they arrive: in a confirmation email, a text, a
 * sign at the gate. Only a published waiver takes signatures, so a draft's
 * link is shown with that said.
 */
export function ShareWaiverDialog(props: { hostId: string; waiver: WaiverTemplate | null; onClose: () => void }) {
  const { waiver } = props
  const [copied, setCopied] = useState(false)
  const qr = useRef<HTMLDivElement | null>(null)
  const link = useMemo(
    () => (waiver && typeof window !== 'undefined' ? waiverShareLink(window.location.origin, props.hostId, waiver.id) : ''),
    [waiver, props.hostId],
  )
  const downloadQr = () => {
    const svg = qr.current?.querySelector('svg')
    if (!svg || !waiver) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${waiver.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'waiver'}-qr.svg`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
  }
  return (
    <Dialog open={Boolean(waiver)} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>{'Share for signing'}</DialogTitle>
      <DialogContent>
        {waiver ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {waiver.status !== 'published' ? (
              <Alert severity="warning">{'Publish this waiver first: the link takes signatures only while it is published.'}</Alert>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              {'Riders open this link on their own phone to sign before they arrive. Print the QR code for the gate or the window.'}
            </Typography>
            <TextField label="Link" value={link} fullWidth slotProps={{ htmlInput: { readOnly: true } }} />
            <Paper ref={qr} variant="outlined" sx={{ p: 2, alignSelf: 'center', bgcolor: 'common.white' }}>
              <QRCodeSVG value={link} size={192} marginSize={2} title={`QR code for ${waiver.title}`} />
            </Paper>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={downloadQr}>{'Download QR code'}</Button>
        <Button
          onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => undefined)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button variant="contained" onClick={props.onClose}>
          {'Done'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ShareWaiverDialog
