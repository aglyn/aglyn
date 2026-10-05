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

/**
 * The wizard's Back and Next, and what still stands in the way of Next.
 * Every step renders it at its foot, so the reason Next is disabled is
 * always written beside it rather than left for the person to guess.
 */

import { Alert, Box, Button, Stack } from '@mui/material'
import type { ReactNode } from 'react'

export interface TransferWizardNavProps {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  /** Why Next is disabled, one sentence each. */
  blockers?: readonly string[]
  busy?: boolean
  /** Extra controls between Back and Next. */
  children?: ReactNode
}

export function TransferWizardNav({
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled,
  blockers = [],
  busy,
  children,
}: TransferWizardNavProps) {
  return (
    <Stack spacing={1.5} sx={{ pt: 1 }}>
      {blockers.length ? (
        <Alert severity="warning" aria-live="polite">
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </Box>
        </Alert>
      ) : null}
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Box>
          {onBack ? (
            <Button onClick={onBack} disabled={busy}>
              Back
            </Button>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {children}
          {onNext ? (
            <Button
              variant="contained"
              onClick={onNext}
              disabled={busy || nextDisabled || blockers.length > 0}
            >
              {nextLabel}
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Stack>
  )
}

export default TransferWizardNav
