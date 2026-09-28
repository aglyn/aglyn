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

import type {
  SenderReadiness,
  SenderReadinessCheck,
  SenderReadinessState,
} from '@aglyn/shared-util-email'
import { Alert, Box, Chip, Stack, Typography } from '@mui/material'

/**
 * SENDER READINESS, on a card (AGL-3328): SPF, DKIM and DMARC for the domain
 * mail leaves from, and whether DMARC passes on a mechanism that lines up
 * with the From domain.
 *
 * One component for both places a sender is set up — a sending domain in
 * Emails and a connected mailbox in Sequences — so the two read the same
 * zone the same way. What it renders is the server's verdict
 * (`assessSenderReadiness`); it decides nothing itself.
 */

const STATE_LABEL: Record<SenderReadinessState, string> = {
  pass: 'Pass',
  warn: 'Check',
  fail: 'Fail',
  unknown: 'Not answered',
}

const STATE_COLOR: Record<SenderReadinessState, 'success' | 'warning' | 'error' | 'default'> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error',
  unknown: 'default',
}

const OVERALL_SEVERITY: Record<SenderReadinessState, 'success' | 'warning' | 'error' | 'info'> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error',
  unknown: 'info',
}

const OVERALL_SENTENCE: Record<SenderReadinessState, string> = {
  pass: 'Receivers can tell this mail is really from this domain.',
  warn: 'Mail is authenticated, with something worth fixing below.',
  fail: 'Receivers cannot confirm this mail is from this domain. Fix the failing record below.',
  unknown: 'Some lookups went unanswered. Nothing is known to be wrong; check again in a few minutes.',
}

/** Accessible names of the rows, spelled once for the specs. */
export const SENDER_READINESS_ROWS = {
  spf: 'SPF',
  dkim: 'DKIM',
  dmarc: 'DMARC',
  alignment: 'Alignment',
} as const

function ReadinessRow(props: { label: string; check: SenderReadinessCheck }) {
  const { label, check } = props
  return (
    <Stack spacing={0.25} role="group" aria-label={label}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          size="small"
          variant="outlined"
          color={STATE_COLOR[check.state]}
          label={STATE_LABEL[check.state]}
        />
        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {label}
        </Typography>
        {check.host ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
            {check.host}
          </Typography>
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {check.detail}
      </Typography>
      {check.record ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
        >
          {check.record.length > 160 ? `${check.record.slice(0, 160)}…` : check.record}
        </Typography>
      ) : null}
    </Stack>
  )
}

export interface SenderReadinessPanelProps {
  readiness: SenderReadiness
}

export function SenderReadinessPanel(props: SenderReadinessPanelProps) {
  const { readiness } = props
  return (
    <Stack spacing={1.5} aria-label="Sender readiness">
      <Box>
        <Typography variant="subtitle2">{'Sender readiness'}</Typography>
        <Typography variant="caption" color="text.secondary">
          {`How receivers judge mail from ${readiness.fromDomain} sent by ${readiness.provider}. ` +
            `Checked ${new Date(readiness.checkedAtMs).toLocaleString()}.`}
        </Typography>
      </Box>
      <Alert severity={OVERALL_SEVERITY[readiness.overall]}>{OVERALL_SENTENCE[readiness.overall]}</Alert>
      <ReadinessRow label={SENDER_READINESS_ROWS.spf} check={readiness.spf} />
      <ReadinessRow label={SENDER_READINESS_ROWS.dkim} check={readiness.dkim} />
      <ReadinessRow label={SENDER_READINESS_ROWS.dmarc} check={readiness.dmarc} />
      <ReadinessRow label={SENDER_READINESS_ROWS.alignment} check={readiness.alignment} />
    </Stack>
  )
}
SenderReadinessPanel.displayName = 'SenderReadinessPanel'

export default SenderReadinessPanel
