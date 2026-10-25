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

import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { formatDayKey } from '../model/waiver'
import {
  WAIVER_METHOD_LABELS,
  signatureWindowLabel,
  type StoredWaiverSignature,
} from '../model/waiver-signature'
import { saveBlob, useWaiversFetch } from './waivers-api'

/** The record as the detail route serves it: no storage paths. */
type SignatureDetail = Omit<StoredWaiverSignature, 'signature' | 'paper'> & {
  signature:
    | { kind: 'drawn'; strokes: Array<Array<[number, number]>>; hasImage: boolean }
    | { kind: 'typed'; text: string }
    | { kind: 'paper' }
  paper: (Omit<NonNullable<StoredWaiverSignature['paper']>, 'photoPath'> & { hasPhoto: boolean }) | null
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: { sm: 160 }, flexShrink: 0 }}>
        {props.label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {props.children}
      </Typography>
    </Stack>
  )
}

function useFileUrl(hostId: string, signatureId: string, kind: 'signature' | 'paper', wanted: boolean): string | null {
  const { ready, download } = useWaiversFetch()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!ready || !wanted) return
    let live = true
    let made: string | null = null
    void download(WAIVERS_API_ROUTES.signatureFile, { query: { hostId, signatureId, kind } })
      .then((blob) => {
        if (!live) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      })
      .catch(() => undefined)
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [ready, download, hostId, signatureId, kind, wanted])
  return url
}

const when = (ms: number | null | undefined, timeZone: string) => {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString([], { timeZone, dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return new Date(ms).toLocaleString()
  }
}

function SignatureBody(props: { hostId: string; signature: SignatureDetail; timeZone: string }) {
  const { signature, timeZone, hostId } = props
  const image = useFileUrl(hostId, signature.id, 'signature', signature.signature.kind === 'drawn' && signature.signature.hasImage)
  const photo = useFileUrl(hostId, signature.id, 'paper', Boolean(signature.paper?.hasPhoto))
  return (
    <Stack spacing={2}>
      {signature.voidedAt ? (
        <Alert severity="warning">{`Voided ${when(signature.voidedAt, timeZone)}: ${signature.voidReason ?? ''}`}</Alert>
      ) : null}
      <Stack spacing={1}>
        <Row label="Waiver">{`${signature.waiverTitle}, version ${signature.version}`}</Row>
        <Row label="Covers">{signatureWindowLabel(signature)}</Row>
        <Row label="Method">{WAIVER_METHOD_LABELS[signature.method]}</Row>
      </Stack>
      <Divider />
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Signer'}</Typography>
        <Row label="Name">{signature.signer.name}</Row>
        <Row label="Date of birth">{formatDayKey(signature.signer.dateOfBirth)}</Row>
        <Row label="Email">{signature.signer.email || '—'}</Row>
        <Row label="Phone">{signature.signer.phone || '—'}</Row>
        {signature.minors.length ? (
          <>
            {signature.minors.map((minor, index) => (
              <Row key={index} label={`Minor ${index + 1}`}>{`${minor.name}, born ${formatDayKey(minor.dateOfBirth)}`}</Row>
            ))}
            <Row label="Relationship">{signature.guardianRelationship ?? '—'}</Row>
          </>
        ) : null}
      </Stack>
      <Divider />
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Signature'}</Typography>
        {signature.signature.kind === 'drawn' ? (
          image ? (
            <Paper variant="outlined" sx={{ p: 1, bgcolor: 'common.white', maxWidth: 420 }}>
              <Box component="img" src={image} alt={`Signature of ${signature.signer.name}`} sx={{ display: 'block', width: '100%' }} />
            </Paper>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'Drawn by hand. The PDF redraws it.'}
            </Typography>
          )
        ) : signature.signature.kind === 'typed' ? (
          <Typography variant="h5" component="p" sx={{ fontStyle: 'italic' }}>
            {signature.signature.text}
          </Typography>
        ) : (
          <Stack spacing={1}>
            <Typography variant="body2">{'Signed on paper.'}</Typography>
            {photo ? (
              <Box component="img" src={photo} alt="Photo of the signed paper waiver" sx={{ display: 'block', maxWidth: '100%', borderRadius: 1 }} />
            ) : null}
          </Stack>
        )}
        {signature.consent?.agreed ? <Row label="Agreed to sign electronically">{signature.consent.text}</Row> : null}
      </Stack>
      <Divider />
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Audit trail'}</Typography>
        <Row label="Signed">{when(signature.signedAtMs, timeZone)}</Row>
        {signature.method !== 'paper' ? (
          <>
            <Row label="Signed on">{signature.audit.signedOnHost ?? '—'}</Row>
            <Row label="IP address">{signature.audit.ip ?? '—'}</Row>
            <Row label="Device">{signature.audit.userAgent ?? '—'}</Row>
          </>
        ) : null}
        {signature.audit.staffName || signature.audit.staffUid ? (
          <Row label={signature.method === 'paper' ? 'Recorded by' : 'Handed over by'}>
            {signature.audit.staffName ?? signature.audit.staffUid}
          </Row>
        ) : null}
        <Row label="Text fingerprint">{`SHA-256 ${signature.signedTextSha256}`}</Row>
        <Row label="Signature ID">{signature.id}</Row>
      </Stack>
    </Stack>
  )
}

export interface SignatureDetailDialogProps {
  hostId: string
  signatureId: string | null
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}

/** One signature's record (AGL-4042): everything it holds, its signed PDF, and voiding it. */
export function SignatureDetailDialog(props: SignatureDetailDialogProps) {
  const { hostId, signatureId } = props
  const { ready, request, download } = useWaiversFetch()
  const [answer, setAnswer] = useState<{ signature: SignatureDetail; timeZone: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAnswer(null)
    setError(null)
    setVoiding(false)
    setReason('')
    if (!ready || !signatureId) return
    let live = true
    void request<{ signature: SignatureDetail; timeZone: string }>(WAIVERS_API_ROUTES.signature, {
      query: { hostId, signatureId },
    })
      .then((loaded) => live && setAnswer(loaded))
      .catch((caught: Error) => live && setError(caught.message))
    return () => {
      live = false
    }
  }, [ready, request, hostId, signatureId])

  const downloadPdf = async () => {
    if (!answer) return
    setBusy(true)
    try {
      const blob = await download(WAIVERS_API_ROUTES.signaturePdf, { query: { hostId, signatureId: answer.signature.id } })
      const slug = `${answer.signature.waiverTitle} ${answer.signature.signer.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      saveBlob(blob, `${slug || 'signed-waiver'}.pdf`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The PDF could not be made.')
    } finally {
      setBusy(false)
    }
  }

  const voidIt = async () => {
    if (!answer) return
    setBusy(true)
    try {
      const updated = await request<{ signature: SignatureDetail }>(WAIVERS_API_ROUTES.signature, {
        body: { hostId, signatureId: answer.signature.id, action: 'void', reason },
      })
      setAnswer({ ...answer, signature: updated.signature })
      setVoiding(false)
      props.onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The signature could not be voided.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(signatureId)} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <span>{answer ? answer.signature.signer.name : 'Signature'}</span>
          {answer?.signature.voidedAt ? <Chip size="small" color="warning" label="Voided" /> : null}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {answer ? (
          <Stack spacing={2}>
            <SignatureBody hostId={hostId} signature={answer.signature} timeZone={answer.timeZone} />
            {voiding ? (
              <TextField
                label="Why it is being voided"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                fullWidth
                autoFocus
                helperText="Kept on the record. A voided signature no longer counts for any day."
                slotProps={{ htmlInput: { maxLength: 300 } }}
              />
            ) : null}
          </Stack>
        ) : !error ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading the signature" />
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        {answer && !answer.signature.voidedAt ? (
          voiding ? (
            <>
              <Button onClick={() => setVoiding(false)} disabled={busy}>
                {'Keep it'}
              </Button>
              <Button color="warning" variant="contained" onClick={() => void voidIt()} disabled={busy || !reason.trim()}>
                {'Void signature'}
              </Button>
            </>
          ) : (
            <BlockedControl blocked={!props.canManage} reason="Voiding needs the Manage waivers permission.">
              <Button color="warning" onClick={() => setVoiding(true)}>
                {'Void'}
              </Button>
            </BlockedControl>
          )
        ) : null}
        <Button onClick={() => void downloadPdf()} disabled={!answer || busy}>
          {'Download PDF'}
        </Button>
        <Button variant="contained" onClick={props.onClose}>
          {'Close'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default SignatureDetailDialog
