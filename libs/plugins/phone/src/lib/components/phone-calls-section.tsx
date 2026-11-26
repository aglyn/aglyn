'use client'

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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { formatPhoneForDisplay } from '../model/phone-rules'
import type { PhoneCall } from '../model/phone.types'
import type { PhoneSectionProps } from './phone-console-page'
import { describePhoneCall, formatPhoneTime } from './phone-format'

/**
 * Calls (AGL-4251): every call to and from the business number, newest first,
 * with each voicemail's transcript, and Call, which rings the member's own
 * cell and connects them to the customer from the business number.
 */
export function PhoneCallsSection({ api, status, basePath }: PhoneSectionProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [calls, setCalls] = useState<PhoneCall[] | null>(null)
  const [dialing, setDialing] = useState(false)
  const number = status.numbers[0] ?? null

  const load = useCallback(async () => {
    try {
      setCalls(await api.calls())
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
      setCalls([])
    }
  }, [api, enqueueSnackbar])

  useEffect(() => {
    void load()
  }, [load])

  if (!number) {
    return (
      <Alert
        severity="info"
        action={
          <Button size="small" href={`${basePath}/setup`}>
            Set up
          </Button>
        }
      >
        Choose your business number on Setup, and its calls will show here.
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      <CardDisplay
        header="Calls"
        subheader={formatPhoneForDisplay(number.e164)}
        HeaderProps={{
          action: (
            <Button variant="contained" size="small" onClick={() => setDialing(true)}>
              Call
            </Button>
          ),
        }}
        disableContentWrapper
      >
        {calls === null ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        ) : calls.length ? (
          <ScrollTable size="small" aria-label="Calls">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Who</TableCell>
                <TableCell>What happened</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatPhoneTime(call.startedAtMs)}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{call.contact?.name || formatPhoneForDisplay(call.theirs)}</Typography>
                    {call.contact?.name ? (
                      <Typography variant="caption" color="text.secondary">
                        {formatPhoneForDisplay(call.theirs)}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {call.status === 'voicemail' ? 'Voicemail' : describePhoneCall(call)}
                    </Typography>
                    {call.voicemail ? (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {call.voicemail.transcript
                          ? call.voicemail.transcript
                          : call.voicemail.transcriptStatus === 'pending'
                            ? 'Transcribing…'
                            : `${call.voicemail.durationSec} second message`}
                      </Typography>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No calls yet.
          </Typography>
        )}
      </CardDisplay>
      <PhoneCallDialog
        open={dialing}
        initialCell={status.myCell ?? ''}
        onClose={() => setDialing(false)}
        onCall={async (to, memberCell) => {
          await api.placeCall({ to, memberCell, numberId: number.id })
          setDialing(false)
          enqueueSnackbar('Your phone is ringing. Answer it to be connected.', { variant: 'success' })
          await load()
        }}
      />
    </Stack>
  )
}

function PhoneCallDialog(props: {
  open: boolean
  initialCell: string
  onClose(): void
  onCall(to: string, memberCell: string): Promise<void>
}) {
  const { enqueueSnackbar } = useSnackbar()
  const [to, setTo] = useState('')
  const [cell, setCell] = useState(props.initialCell)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>Call from your business number</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          Phone rings your cell first. When you answer, it calls the customer, and they see your business number.
        </DialogContentText>
        <Stack spacing={2}>
          <TextField label="Number to call" value={to} onChange={(event) => setTo(event.target.value)} />
          <TextField label="Your cell" value={cell} onChange={(event) => setCell(event.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || !to.trim() || !cell.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await props.onCall(to, cell)
            } catch (error) {
              enqueueSnackbar((error as Error).message, { variant: 'error' })
            } finally {
              setBusy(false)
            }
          }}
        >
          Call
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PhoneCallsSection
