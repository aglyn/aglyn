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
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { SignaturesCard } from './signatures-card.component'
import { useSiteWaivers } from './use-site-waivers'
import { useWaiversFetch } from './waivers-api'

export interface WaiverNameCheckDialogProps {
  open: boolean
  hostId: string
  /** The day being checked in, `YYYY-MM-DD` in the site's time zone. */
  dayKey: string
  /** The rider's name as check-in has it. */
  name: string
  onClose: () => void
}

interface CheckAnswer {
  signed: boolean
  matched: boolean
  label: string
}

/**
 * A rider check-in could not match by email (AGL-4042): ask their date of
 * birth and match the name and birth date together — the signer, or a minor
 * a guardian listed — or look through the site's signatures for the name.
 * A name alone never counts as a match; the search is for staff to read.
 */
export function WaiverNameCheckDialog(props: WaiverNameCheckDialogProps) {
  const { open, hostId, dayKey, onClose } = props
  const { request } = useWaiversFetch()
  const { waivers } = useSiteWaivers(hostId)
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const [name, setName] = useState(props.name)
  const [dateOfBirth, setDateOfBirth] = useState<Dayjs | null>(null)
  const [answer, setAnswer] = useState<CheckAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const birthDay = dateOfBirth?.isValid() ? dateOfBirth.format('YYYY-MM-DD') : ''
  const check = async () => {
    if (!name.trim() || !birthDay) return
    setBusy(true)
    setError(null)
    setAnswer(null)
    try {
      setAnswer(
        await request<CheckAnswer>(WAIVERS_API_ROUTES.status, {
          query: { hostId, dayKey, name: name.trim(), dateOfBirth: birthDay },
        }),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The waiver could not be checked.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" fullScreen={narrow}>
      <DialogTitle>{'Find a waiver by name'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {'Ask the rider’s date of birth to match their name and birth date with a signed waiver, theirs or one a parent signed for them.'}
            </Typography>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                <TextField label="Full name" value={name} onChange={(event) => setName(event.target.value)} />
                <DatePicker
                  label="Date of birth"
                  value={dateOfBirth}
                  onChange={(value) => {
                    setDateOfBirth(value)
                    setAnswer(null)
                  }}
                  disableFuture
                  maxDate={dayjs(dayKey)}
                />
                <Button variant="contained" onClick={() => void check()} disabled={busy || !name.trim() || !birthDay}>
                  {'Check'}
                </Button>
              </Stack>
            </LocalizationProvider>
            {answer ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip
                  size="small"
                  color={answer.signed ? 'success' : 'warning'}
                  variant={answer.signed ? 'filled' : 'outlined'}
                  label={answer.matched ? answer.label : 'No signed waiver for that name and date of birth'}
                />
              </Stack>
            ) : null}
            {error ? <Alert severity="warning">{error}</Alert> : null}
          </Stack>
          <SignaturesCard hostId={hostId} waivers={waivers ?? []} canCollect canManage={false} initialQuery={props.name} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default WaiverNameCheckDialog
