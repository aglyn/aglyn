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
  OPERATOR_ALERT_CATEGORY_LABELS,
  OPERATOR_ALERT_TIER_LABELS,
  type OperatorAlertCategory,
  type OperatorAlertDelivery,
  type OperatorAlertTier,
} from '@aglyn/aglyn/app-utils/operator-alerts'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { COMPACT_FIELD_WIDTH } from '../constants/shared'

interface AlertRow {
  type: string
  label: string
  description: string
  tier: OperatorAlertTier
  category: OperatorAlertCategory
  pluginId: string | null
  defaults: { enabled: boolean; delivery: OperatorAlertDelivery }
  effective: { enabled: boolean; delivery: OperatorAlertDelivery }
  overridden: boolean
}

interface OperatorAlertsBody {
  role: string
  alerts: AlertRow[]
  digestHourUtc: number
  recipients: {
    source: 'STAFF_ALERT_EMAIL' | 'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL' | 'staff-accounts' | 'none'
    count: number
  }
  webhookConfigured: boolean
  webhookSigned: boolean
  health: Array<{
    checkId: string
    label: string
    status: 'ok' | 'degraded'
    sinceMs: number
    detail: string
  }>
}

const TIERS: readonly OperatorAlertTier[] = ['must', 'should', 'low']

const RECIPIENT_WORDS: Record<OperatorAlertsBody['recipients']['source'], string> = {
  STAFF_ALERT_EMAIL: 'the alerts inbox in STAFF_ALERT_EMAIL',
  NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL:
    'the operator support address (STAFF_ALERT_EMAIL is unset)',
  'staff-accounts': 'every staff account (no alerts inbox or support address is set)',
  none: 'nobody: no alerts inbox, support address or staff address is set',
}

/**
 * Staff → Operator alerts (AGL-3377).
 *
 * One row per alert type in the registry, grouped by tier: what it is, whether
 * it is on and how it is delivered, and a test send. Above the rows, where
 * alerts go, so an install whose inbox is unset finds out here rather than on
 * the day an alert goes nowhere. Below, every health check's last recorded
 * state.
 *
 * Changing a row and sending a test are super-staff actions; the route
 * refuses anyone else, and this card shows the controls disabled with the
 * reason rather than hiding them.
 */
export default function StaffOperatorAlertsCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<OperatorAlertsBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await authorizedFetch(user, '/api/admin/operator-alerts')
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error ?? 'Could not load the operator alerts')
        return
      }
      setError(null)
      setData(payload as OperatorAlertsBody)
    } catch {
      setError('Could not load the operator alerts')
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (
    key: string,
    change: { types?: Record<string, { enabled?: boolean; delivery?: OperatorAlertDelivery }>; digestHourUtc?: number },
  ) => {
    if (busy) return
    setBusy(key)
    try {
      const response = await authorizedFetch(user, '/api/admin/operator-alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not save the operator alerts', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar('Saved', { variant: 'success', persist: false })
      // Re-read rather than trusting the click (AGL-1571): the card shows what
      // is stored, not what was asked for.
      await load()
    } finally {
      setBusy(null)
    }
  }

  const test = async (row: AlertRow) => {
    if (busy) return
    setBusy(`test:${row.type}`)
    try {
      const response = await authorizedFetch(user, '/api/admin/operator-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', type: row.type }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not send the test', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      const email = payload?.email?.sent ? 'email sent' : `email not sent (${payload?.email?.reason ?? 'unknown'})`
      const webhook = payload?.webhook?.posted
        ? 'webhook posted'
        : payload?.webhook?.reason === 'unconfigured'
          ? 'no webhook set'
          : `webhook failed (${payload?.webhook?.status ?? payload?.webhook?.reason ?? 'unknown'})`
      enqueueSnackbar(`Test “${row.label}”: ${email}, ${webhook}`, {
        variant: payload?.email?.sent || payload?.webhook?.posted ? 'success' : 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(null)
    }
  }

  const isSuper = data?.role === 'super'
  const byTier = useMemo(
    () =>
      TIERS.map((tier) => ({
        tier,
        rows: (data?.alerts ?? []).filter((row) => row.tier === tier),
      })).filter((group) => group.rows.length),
    [data],
  )

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={'Where alerts go'}
        help={docsHelp('operatorAlerts', {
          anchor: '#channels',
          excerpt:
            'Every alert writes a console notification, emails the operator, and posts to the optional webhook.',
        })}
        subheader={
          'Every alert is a console notification for every staff member; the ones switched on also email the operator and post to the webhook.'
        }
        contentGutterX
        contentGutterY
      >
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : !data ? (
          <Typography variant="body2">Loading…</Typography>
        ) : (
          <Stack spacing={2}>
            <Alert severity={data.recipients.source === 'none' ? 'error' : data.recipients.source === 'STAFF_ALERT_EMAIL' ? 'success' : 'info'}>
              Email goes to {RECIPIENT_WORDS[data.recipients.source]}
              {data.recipients.source === 'staff-accounts' ? ` (${data.recipients.count})` : ''}.
            </Alert>
            <Alert severity={data.webhookConfigured ? 'success' : 'info'}>
              {data.webhookConfigured
                ? `The out-of-band webhook is set${data.webhookSigned ? ' and signed' : ', unsigned'}.`
                : 'No out-of-band webhook is set (OPERATOR_ALERT_WEBHOOK_URL). If the mail provider is what failed, only the console bell will say so.'}
            </Alert>
            <TextField
              select
              size="small"
              label="Daily digest hour (UTC)"
              value={data.digestHourUtc}
              disabled={!isSuper || Boolean(busy)}
              helperText={isSuper ? undefined : 'Changing it requires the super staff role'}
              onChange={(event) => void save('digest', { digestHourUtc: Number(event.target.value) })}
              sx={{ width: COMPACT_FIELD_WIDTH }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <MenuItem key={hour} value={hour}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}
      </CardDisplay>

      {data
        ? byTier.map(({ tier, rows }) => (
            <CardDisplay
              key={tier}
              header={OPERATOR_ALERT_TIER_LABELS[tier]}
              help={docsHelp('operatorAlerts', {
                anchor: '#alert-list',
                excerpt: 'Every operator alert, what it means, and its coded default.',
              })}
              subheader={`${rows.length} alert${rows.length === 1 ? '' : 's'}`}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                {rows.map((row) => (
                  <Stack
                    key={row.type}
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={2}
                    sx={{ alignItems: { md: 'center' } }}
                  >
                    <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                      <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="subtitle2">{row.label}</Typography>
                        <Chip size="small" label={OPERATOR_ALERT_CATEGORY_LABELS[row.category] ?? row.category} />
                        {row.pluginId ? <Chip size="small" variant="outlined" label={row.pluginId} /> : null}
                        {row.overridden ? <Chip size="small" color="info" label="Changed" /> : null}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {row.description}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                      <Switch
                        checked={row.effective.enabled}
                        disabled={!isSuper || Boolean(busy)}
                        slotProps={{ input: { 'aria-label': `${row.label}: on` } }}
                        onChange={(event) =>
                          void save(row.type, { types: { [row.type]: { enabled: event.target.checked } } })
                        }
                      />
                      <TextField
                        select
                        size="small"
                        value={row.effective.delivery}
                        disabled={!isSuper || Boolean(busy) || !row.effective.enabled}
                        slotProps={{ htmlInput: { 'aria-label': `${row.label}: delivery` } }}
                        onChange={(event) =>
                          void save(row.type, {
                            types: { [row.type]: { delivery: event.target.value as OperatorAlertDelivery } },
                          })
                        }
                        sx={{ width: 150 }}
                      >
                        <MenuItem value="immediate">Immediate</MenuItem>
                        <MenuItem value="digest">Daily digest</MenuItem>
                      </TextField>
                      <Button
                        size="small"
                        disabled={!isSuper || Boolean(busy)}
                        onClick={() => void test(row)}
                      >
                        Send test
                      </Button>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </CardDisplay>
          ))
        : null}

      {data ? (
        <CardDisplay
          header={'Health checks'}
          help={docsHelp('operatorAlerts', {
            anchor: '#health',
            excerpt: 'Each health check alerts once when it goes degraded and once when it recovers.',
          })}
          subheader={'Each check’s last recorded state. A change alerts the operator once.'}
          contentGutterX
          contentGutterY
        >
          {data.health.length ? (
            <Stack spacing={1}>
              {data.health.map((check) => (
                <Stack useFlexGap key={check.checkId} direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    color={check.status === 'ok' ? 'success' : 'error'}
                    label={check.status === 'ok' ? 'OK' : 'Degraded'}
                  />
                  <Typography variant="body2">
                    <strong>{check.label}</strong> since {new Date(check.sinceMs).toLocaleString()}
                  </Typography>
                  {check.status === 'degraded' ? (
                    <Typography variant="body2" color="text.secondary">
                      {check.detail}
                    </Typography>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2">
              No health check has been recorded yet. The first operator alerts tick records them all.
            </Typography>
          )}
        </CardDisplay>
      ) : null}
    </Stack>
  )
}
