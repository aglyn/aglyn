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
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { WAIVER_LIMITS, type WaiverTemplate } from '../model/waiver'
import { newWaiverAttemptKey, useWaiversFetch } from './waivers-api'

const DAY = 'YYYY-MM-DD'
const MAX_EDGE = 1600

/** A photo from the camera or the files, shrunk to a JPEG no wider or taller than 1600 px. */
export async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('That file is not a photo.'))
      element.src = url
    })
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface MinorDraft {
  name: string
  dateOfBirth: Dayjs | null
}

export interface PaperWaiverDialogProps {
  hostId: string
  open: boolean
  waivers: WaiverTemplate[]
  onClose: () => void
  onRecorded: () => void
}

/**
 * Recording a paper waiver (AGL-4042): the clipboard still works, and its
 * signatures count at check-in like any other once staff copy the details
 * across and photograph the page. The photo is kept privately with the record.
 */
export function PaperWaiverDialog(props: PaperWaiverDialogProps) {
  const published = props.waivers.filter((waiver) => waiver.status === 'published')
  const { request } = useWaiversFetch()
  const [attemptKey, setAttemptKey] = useState(newWaiverAttemptKey)
  const [waiverId, setWaiverId] = useState('')
  const [signedOn, setSignedOn] = useState<Dayjs | null>(dayjs())
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState<Dayjs | null>(null)
  const [minors, setMinors] = useState<MinorDraft[]>([])
  const [relationship, setRelationship] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setAttemptKey(newWaiverAttemptKey())
    setWaiverId(published.length === 1 ? published[0].id : '')
    setSignedOn(dayjs())
    setName('')
    setEmail('')
    setPhone('')
    setDateOfBirth(null)
    setMinors([])
    setRelationship('')
    setPhoto(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  const chosen = published.find((waiver) => waiver.id === waiverId)

  const record = async () => {
    setBusy(true)
    setError(null)
    try {
      await request(WAIVERS_API_ROUTES.paper, {
        body: {
          hostId: props.hostId,
          attemptKey,
          waiverId,
          signedOnDayKey: signedOn?.isValid() ? signedOn.format(DAY) : '',
          signer: { name, email, phone, dateOfBirth: dateOfBirth?.isValid() ? dateOfBirth.format(DAY) : '' },
          minors: minors.map((minor) => ({
            name: minor.name,
            dateOfBirth: minor.dateOfBirth?.isValid() ? minor.dateOfBirth.format(DAY) : '',
          })),
          guardianRelationship: minors.length ? relationship : '',
          photo,
        },
      })
      props.onRecorded()
      props.onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The paper waiver could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>{'Record a paper waiver'}</DialogTitle>
      <DialogContent dividers>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack spacing={2}>
            {!published.length ? (
              <Alert severity="info">{'Publish a waiver first: a paper waiver is recorded against the waiver it was printed from.'}</Alert>
            ) : null}
            <TextField select label="Waiver" value={waiverId} onChange={(event) => setWaiverId(event.target.value)} fullWidth required>
              {published.map((waiver) => (
                <MenuItem key={waiver.id} value={waiver.id}>
                  {waiver.title}
                </MenuItem>
              ))}
            </TextField>
            <DatePicker label="Date written on the paper" value={signedOn} onChange={setSignedOn} disableFuture />
            <TextField label="Signer’s full name" value={name} onChange={(event) => setName(event.target.value)} required fullWidth slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.name } }} />
            <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} fullWidth helperText="Optional. Files them in your contacts; no email is sent for a paper waiver." slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.email } }} />
            <TextField label="Phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: WAIVER_LIMITS.phone } }} />
            <DatePicker label="Signer’s date of birth" value={dateOfBirth} onChange={setDateOfBirth} disableFuture openTo="year" views={['year', 'month', 'day']} />
            {chosen?.allowMinors ? (
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">{'Minors on this waiver'}</Typography>
                {minors.map((minor, index) => (
                  <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      label={`Minor ${index + 1}’s name`}
                      value={minor.name}
                      fullWidth
                      onChange={(event) => setMinors(minors.map((one, at) => (at === index ? { ...one, name: event.target.value } : one)))}
                    />
                    <DatePicker
                      label="Date of birth"
                      value={minor.dateOfBirth}
                      disableFuture
                      openTo="year"
                      views={['year', 'month', 'day']}
                      onChange={(value) => setMinors(minors.map((one, at) => (at === index ? { ...one, dateOfBirth: value } : one)))}
                    />
                    <Button onClick={() => setMinors(minors.filter((_, at) => at !== index))}>{'Remove'}</Button>
                  </Stack>
                ))}
                {minors.length < WAIVER_LIMITS.minors ? (
                  <Box>
                    <Button onClick={() => setMinors([...minors, { name: '', dateOfBirth: null }])}>{'Add a minor'}</Button>
                  </Box>
                ) : null}
                {minors.length ? (
                  <TextField label="Signer’s relationship to them" value={relationship} onChange={(event) => setRelationship(event.target.value)} fullWidth />
                ) : null}
              </Stack>
            ) : null}
            <Stack spacing={1}>
              <Button component="label" variant="outlined">
                {photo ? 'Retake the photo' : 'Take a photo of the signed page'}
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    void shrinkPhoto(file)
                      .then(setPhoto)
                      .catch((caught: Error) => setError(caught.message))
                  }}
                />
              </Button>
              {photo ? (
                <Box component="img" src={photo} alt="The signed page" sx={{ display: 'block', maxWidth: '100%', borderRadius: 1 }} />
              ) : null}
            </Stack>
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </LocalizationProvider>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void record()} disabled={busy || !waiverId || !photo || !name.trim()}>
          {'Record waiver'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PaperWaiverDialog
