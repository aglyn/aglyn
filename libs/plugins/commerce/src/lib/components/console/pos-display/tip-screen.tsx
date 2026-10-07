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
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Theme } from '@mui/material/styles'
import { type FormEvent, useState } from 'react'
import * as CommerceModel from '../../../model'
import { displayMoney, dollarsToCents, type PosDisplayAnswer } from './pos-display-api'

type TipPrompt = NonNullable<CommerceModel.PosDisplayState['tip']>

/** A tall, full-width touch target. */
export const posDisplayTouchSx = (theme: Theme) => ({
  minHeight: theme.spacing(10),
  ...theme.typography.h5,
})

/**
 * The tip prompt (AGL-3608): the merchant's presets, each with the amount it
 * comes to, a custom amount and no tip. The server recomputes a percentage
 * from the prompt it sent, so what is shown here is never what is charged.
 */
export function PosDisplayTipScreen({
  tip,
  promptId,
  busy,
  currency,
  onAnswer,
}: {
  tip: TipPrompt
  promptId: string
  busy: boolean
  /** The store's currency, from the display state. */
  currency?: string
  onAnswer: (answer: PosDisplayAnswer) => void
}) {
  const [custom, setCustom] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const submitCustom = (event: FormEvent) => {
    event.preventDefault()
    const cents = dollarsToCents(custom ?? '')
    const error =
      cents === null
        ? 'Enter an amount, like 5 or 5.50.'
        : CommerceModel.posTipProblem(cents, tip.baseCents)
    if (cents === null || error) {
      setProblem(error)
      return
    }
    setCustom(null)
    setProblem(null)
    onAnswer({ promptId, tipChoice: 'custom', tipCents: cents })
  }

  if (custom !== null) {
    return (
      <Stack component="form" onSubmit={submitCustom} spacing={3} sx={{ width: '100%' }}>
        <Typography variant="h3" component="h1" sx={{ textAlign: 'center' }}>
          Custom tip
        </Typography>
        <TextField
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value)
            setProblem(null)
          }}
          autoFocus
          error={Boolean(problem)}
          helperText={problem ?? `Up to ${displayMoney(tip.baseCents, currency)}`}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
            htmlInput: { inputMode: 'decimal', 'aria-label': 'Tip amount' },
          }}
          sx={(theme) => ({ '& input': theme.typography.h4 })}
        />
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            size="large"
            fullWidth
            disabled={busy}
            onClick={() => {
              setCustom(null)
              setProblem(null)
            }}
            sx={posDisplayTouchSx}
          >
            Back
          </Button>
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={busy || !custom}
            sx={posDisplayTouchSx}
          >
            Add tip
          </Button>
        </Stack>
      </Stack>
    )
  }

  return (
    <Stack spacing={3} sx={{ width: '100%' }}>
      <Typography variant="h3" component="h1" sx={{ textAlign: 'center' }}>
        Add a tip?
      </Typography>
      <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center' }}>
        {`On ${displayMoney(tip.baseCents, currency)}`}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {tip.percentages.map((percent) => (
          <Button
            key={percent}
            variant="contained"
            size="large"
            fullWidth
            disabled={busy}
            onClick={() => onAnswer({ promptId, tipChoice: 'percent', tipPercent: percent })}
            sx={(theme) => ({ ...posDisplayTouchSx(theme), flexDirection: 'column' })}
          >
            <span>{`${percent}%`}</span>
            <Typography variant="body1" component="span">
              {displayMoney(CommerceModel.posTipFromPercent(tip.baseCents, percent), currency)}
            </Typography>
          </Button>
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {tip.allowCustom ? (
          <Button
            variant="outlined"
            size="large"
            fullWidth
            disabled={busy}
            onClick={() => setCustom('')}
            sx={posDisplayTouchSx}
          >
            Custom amount
          </Button>
        ) : null}
        <Button
          variant="outlined"
          size="large"
          fullWidth
          disabled={busy}
          onClick={() => onAnswer({ promptId, tipChoice: 'none' })}
          sx={posDisplayTouchSx}
        >
          No tip
        </Button>
      </Stack>
    </Stack>
  )
}
