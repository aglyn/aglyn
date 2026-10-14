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
  readAdAudienceOptOut,
  type AdAudienceOptOut,
} from '@aglyn/aglyn/app-utils/ad-audience'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { Button, Chip, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { formatStaffTimestamp } from '../utils/staff-timestamps'

/**
 * The account-holder ad audiences on the staff user page (AGL-3780).
 *
 * One line and one switch: whether the nightly sync may put this account into
 * the operator's own Meta, Google and LinkedIn customer-list audiences. An
 * opt-out is taken out on the next nightly run. Beside product email because
 * both answer "may we market to them?".
 */
export default function StaffUserAdAudience({
  profile,
  onChange,
}: {
  profile: Record<string, unknown> | null | undefined
  /** Records the choice; resolves to the stored opt-out, or throws. */
  onChange: (optOut: boolean) => Promise<AdAudienceOptOut | null>
}) {
  const [optOut, setOptOut] = useState<AdAudienceOptOut | null>(() =>
    readAdAudienceOptOut(profile ?? null),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      setOptOut(await onChange(!optOut))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack
      useFlexGap
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
    >
      <Typography variant="caption" color="text.secondary">
        {`${PLATFORM_BRAND_NAME} ad audiences:`}
      </Typography>
      {optOut ? (
        <Chip
          size="small"
          color="error"
          label={`Opted out${optOut.atMs ? ` ${formatStaffTimestamp(optOut.atMs)}` : ''}`}
        />
      ) : (
        <Chip size="small" label="Included when eligible" />
      )}
      <Button size="small" variant="text" disabled={busy} onClick={() => void toggle()}>
        {busy ? 'Saving…' : optOut ? 'Include again' : 'Opt out'}
      </Button>
      {error ? (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      ) : null}
    </Stack>
  )
}
