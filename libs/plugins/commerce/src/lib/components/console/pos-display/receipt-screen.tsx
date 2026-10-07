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

import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { type FormEvent, useState } from 'react'
import * as CommerceModel from '../../../model'
import type { PosDisplayAnswer } from './pos-display-api'
import { posDisplayTouchSx } from './tip-screen'

type ReceiptPrompt = NonNullable<CommerceModel.PosDisplayState['receipt']>

const CHANNEL_LABELS: Record<CommerceModel.PosReceiptChannel, string> = {
  email: 'Email',
  sms: 'Text',
  print: 'Print',
  none: 'No receipt',
}

/**
 * The receipt prompt (AGL-3608). The channels are the register's offer; email
 * and text ask for an address on this screen, and the marketing box is shown
 * only when the store turned it on, unticked, the way checkout words it.
 *
 * What the customer types lives in this component only until it is sent:
 * the inputs empty on submit, and the page unmounts this screen whenever the
 * prompt moves on, so the next customer finds nothing of the last one's.
 */
export function PosDisplayReceiptScreen({
  receipt,
  promptId,
  busy,
  onAnswer,
}: {
  receipt: ReceiptPrompt
  promptId: string
  busy: boolean
  onAnswer: (answer: PosDisplayAnswer) => void
}) {
  const [entry, setEntry] = useState<'email' | 'sms' | null>(null)
  const [value, setValue] = useState('')
  const [optIn, setOptIn] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const reset = () => {
    setEntry(null)
    setValue('')
    setOptIn(false)
    setProblem(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (entry === 'email') {
      const email = CommerceModel.posDisplayEmail(value)
      if (!email) {
        setProblem('Enter an email address, like name@example.com.')
        return
      }
      const marketingOptIn = receipt.offerMarketing && optIn
      reset()
      onAnswer({
        promptId,
        receiptChannel: 'email',
        email,
        ...(marketingOptIn ? { marketingOptIn: true } : {}),
      })
      return
    }
    if (entry === 'sms') {
      const phone = CommerceModel.posDisplayPhone(value)
      if (!phone) {
        setProblem('Enter a phone number with its area code.')
        return
      }
      reset()
      onAnswer({ promptId, receiptChannel: 'sms', phone })
    }
  }

  if (entry) {
    const email = entry === 'email'
    return (
      <Stack component="form" onSubmit={submit} spacing={3} sx={{ width: '100%' }}>
        <Typography variant="h3" component="h1" sx={{ textAlign: 'center' }}>
          {email ? 'Email receipt' : 'Text receipt'}
        </Typography>
        <TextField
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setProblem(null)
          }}
          autoFocus
          autoComplete="off"
          type={email ? 'email' : 'tel'}
          label={email ? 'Email' : 'Mobile number'}
          error={Boolean(problem)}
          helperText={problem ?? (email ? 'For your receipt' : 'For your receipt by text')}
          slotProps={{ htmlInput: { inputMode: email ? 'email' : 'tel' } }}
          sx={(theme) => ({ '& input': theme.typography.h5 })}
        />
        {email && receipt.offerMarketing ? (
          <FormControlLabel
            control={
              <Checkbox checked={optIn} onChange={(event) => setOptIn(event.target.checked)} />
            }
            label={<Typography variant="h6">Email me news and offers</Typography>}
          />
        ) : null}
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            size="large"
            fullWidth
            disabled={busy}
            onClick={reset}
            sx={posDisplayTouchSx}
          >
            Back
          </Button>
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={busy || !value.trim()}
            sx={posDisplayTouchSx}
          >
            Send
          </Button>
        </Stack>
      </Stack>
    )
  }

  return (
    <Stack spacing={3} sx={{ width: '100%' }}>
      <Typography variant="h3" component="h1" sx={{ textAlign: 'center' }}>
        How would you like your receipt?
      </Typography>
      <Stack spacing={2}>
        {receipt.channels.map((channel) => (
          <Button
            key={channel}
            variant={channel === 'none' ? 'outlined' : 'contained'}
            size="large"
            fullWidth
            disabled={busy}
            onClick={() => {
              if (channel === 'email' || channel === 'sms') {
                setEntry(channel)
                return
              }
              onAnswer({ promptId, receiptChannel: channel })
            }}
            sx={posDisplayTouchSx}
          >
            {CHANNEL_LABELS[channel]}
          </Button>
        ))}
      </Stack>
    </Stack>
  )
}
