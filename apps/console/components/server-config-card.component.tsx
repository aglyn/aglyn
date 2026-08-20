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
 * RESOLVED SERVER CONFIG, on a screen (AGL-2069).
 *
 * The last link in verifying an env flip — that the configured text actually
 * arrives in the running function's `process.env` — was Vercel's contract
 * rather than a reading. On 2026-08-19 a var was set on the Vercel PROJECT
 * while the DEPLOYMENT serving traffic still lacked it, and the only way to
 * notice was diffing deployment env key lists by hand.
 *
 * This is that reading, taken from inside. Two things make it worth a card
 * rather than a curl:
 *
 * **`source` is the column that matters.** "Mode is boundary" is two
 * different facts depending on whether somebody set it or the code default
 * happens to agree — and AGL-1875's original body got exactly that wrong.
 *
 * **A warning outranks the value.** A trailing space makes
 * `STRIPE_METERED_BACKFILL="immediate "` resolve to `boundary` while every
 * external check stays green, so the mismatch is rendered as an alert above
 * the table, not as a subtle mark beside a row someone has to notice.
 *
 * Read-only, and never renders a secret: the endpoint reports classes and
 * presence words, never values, so there is nothing here to mask.
 */

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'

import { docsHelp } from '../constants/docs-links'
import type { ServerConfigReport } from '../utils/server-config-report'

export function ServerConfigCard() {
  const { data: user } = useUser()
  const [report, setReport] = useState<ServerConfigReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/server-config', {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(payload?.error ?? `HTTP ${response.status}`))
      }
      setReport(payload as ServerConfigReport)
    } catch (readError) {
      // A config report that cannot be read is NOT reported as agreeing —
      // the three-states rule the rest of this board is built on.
      setReport(null)
      setError(String((readError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [user])

  useEffect(() => {
    if (user) void refresh()
  }, [refresh, user])

  const deployment = report?.deployment

  return (
    <CardDisplay
      header={'Resolved server config'}
      help={docsHelp('platformHealth', {
        anchor: '#resolved-server-config',
        excerpt:
          'What this deployment actually resolved, read from inside the ' +
          'running function. "Source" separates a value someone set from a ' +
          'code default that happens to agree. Values are never shown — the ' +
          'report carries classes and presence only.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'An env flip can be confirmed on the Vercel project and still not ' +
            'have reached the deployment serving traffic. This is the ' +
            'deployment answering for itself. No value is ever shown here: ' +
            'each knob reports an enum word, a class, or whether it is set.'}
        </Typography>

        {error ? <Alert severity="warning">{error}</Alert> : null}

        {/*
          A mismatch between the configured text and what it resolves to is
          the whole reason this exists, so it is the loudest thing on the
          card. A trailing space is invisible in every external check.
        */}
        {report?.warnings.length ? (
          <Alert severity="error">
            <AlertTitle>
              {'Configured text does not resolve to what it says'}
            </AlertTitle>
            <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
              {report.warnings.map((warning) => (
                <Typography component="li" variant="body2" key={warning}>
                  {warning}
                </Typography>
              ))}
            </Stack>
          </Alert>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {/*
            Without the deployment id the reading is unattributable, which is
            the project-vs-deployment confusion that started this issue.
          */}
          <Chip size="small" label={`env: ${deployment?.env ?? 'unknown'}`} />
          <Chip
            size="small"
            label={`deployment: ${deployment?.id ?? 'unknown'}`}
          />
          <Chip
            size="small"
            label={`commit: ${deployment?.commit?.slice(0, 9) ?? 'unknown'}`}
          />
          <Button size="small" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Reading…' : 'Re-read'}
          </Button>
        </Stack>

        {report ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Setting'}</TableCell>
                <TableCell>{'Resolved'}</TableCell>
                <TableCell>{'Source'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.knobs.map((knob) => (
                <TableRow key={knob.key}>
                  <TableCell>
                    <Tooltip title={knob.drives}>
                      <Stack spacing={0.25}>
                        <Typography variant="body2">{knob.label}</Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {knob.key}
                        </Typography>
                      </Stack>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={knob.warning ? 'error' : 'default'}
                      label={knob.value}
                    />
                  </TableCell>
                  <TableCell>
                    {/*
                      `default` is not a problem, it is a fact — but it is
                      the fact people misread, so it is marked rather than
                      left to blend in with a set value.
                    */}
                    <Chip
                      size="small"
                      variant={knob.source === 'env' ? 'filled' : 'outlined'}
                      color={knob.source === 'env' ? 'primary' : 'default'}
                      label={knob.source === 'env' ? 'set' : 'code default'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

ServerConfigCard.displayName = 'ServerConfigCard'

export default ServerConfigCard
