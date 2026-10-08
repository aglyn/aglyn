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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { LOYALTY_API_ROUTES } from '../constants/api-routes'
import {
  LOYALTY_CONNECTOR_FIELDS,
  LOYALTY_CONNECTOR_IDS,
  LOYALTY_CONNECTOR_LABELS,
  LOYALTY_DISCONNECT_EXPLANATION,
  type LoyaltyConnectionAnswer,
  type LoyaltyConnectorId,
  type LoyaltySyncRowView,
} from '../model/loyalty-connectors'
import { formatPoints } from '../model/loyalty-math'
import { useLoyaltyFetch } from './loyalty-api'

const STATUS_WORDS: Record<LoyaltySyncRowView['status'], string> = {
  pending: 'Waiting to send',
  sending: 'Sending',
  synced: 'Sent',
  retry: 'Not sent yet',
  unmatched: 'Not a member there',
  skipped: 'Not sent',
}

function rowLine(row: LoyaltySyncRowView): string {
  const points = `${row.points > 0 ? '+' : '−'}${formatPoints(Math.abs(row.points))} points`
  return `${points} for ${row.email}${row.orderId ? ` · order ${row.orderId.slice(-8)}` : ''}`
}

/**
 * THE STORE'S OWN LOYALTY ACCOUNT, above the Rewards program (AGL-3677):
 * connect Smile.io or Yotpo Loyalty with the merchant's own key, see what is
 * waiting to reach it, send it again, or disconnect. Draws NOTHING when the
 * deployment cannot seal a key (`configured: false`), so a store without the
 * feature sees the built-in program exactly as before. Connecting needs an
 * admin; the route says so when a member without the role tries.
 */
export function LoyaltyConnectionCard(props: {
  hostId: string
  onChanged?: () => void
}) {
  const { hostId, onChanged } = props
  const request = useLoyaltyFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<LoyaltyConnectionAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<LoyaltyConnectorId>('smile')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [replace, setReplace] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    request<LoyaltyConnectionAnswer>(LOYALTY_API_ROUTES.connection, {
      query: { hostId },
    })
      .then((next) => live && setAnswer(next))
      .catch((cause: Error) => live && setError(cause.message))
    return () => {
      live = false
    }
  }, [hostId, request])

  if (error) return <Alert severity="error">{error}</Alert>
  if (!answer || !answer.configured) return null

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    try {
      const next = await request<LoyaltyConnectionAnswer>(
        LOYALTY_API_ROUTES.connection,
        { body: { hostId, ...body } },
      )
      setAnswer(next)
      setFields({})
      setReplace(false)
      enqueueSnackbar(done, { variant: 'success' })
      onChanged?.()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const connection = answer.connection
  const help = pluginDocsHelp('loyaltyConnectors', {
    excerpt:
      'Keep your members’ points in your own Smile.io or Yotpo Loyalty account.',
  })

  if (connection) {
    const waiting = answer.attention
    return (
      <CardDisplay
        header={`Rewards account: ${connection.label}`}
        subheader={`Points are kept in your ${connection.label} account. Every order’s points, refunds, redemptions and your own changes are sent there; the built-in points, welcome points and referral rewards are off.`}
        help={help}
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <StatusChip
                label={connection.lastError ? 'Needs attention' : 'Connected'}
                tone={connection.lastError ? 'warning' : 'success'}
                data-testid="loyalty-connection-status"
              />
              {waiting.length ? (
                <Button
                  disabled={busy}
                  onClick={() => act({ action: 'retry' }, 'Sent again')}
                >
                  {'Send again'}
                </Button>
              ) : null}
              <Button
                color="error"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                {'Disconnect'}
              </Button>
            </Stack>
          ),
        }}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {`API key ending ${connection.keyLast4 || '····'}${
              connection.lastSyncedAtMs
                ? ` · last sent ${new Date(connection.lastSyncedAtMs).toLocaleString()}`
                : ''
            }`}
          </Typography>
          {connection.lastError ? (
            <Alert severity="warning">{connection.lastError}</Alert>
          ) : null}
          {waiting.length ? (
            <List
              dense
              disablePadding
              data-testid="loyalty-connection-attention"
            >
              {waiting.map((row) => (
                <ListItem key={row.id} disableGutters>
                  <ListItemText
                    primary={rowLine(row)}
                    secondary={`${STATUS_WORDS[row.status]}${row.error ? ` · ${row.error}` : ''}`}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'Everything has been sent.'}
            </Typography>
          )}
        </Stack>
        <Dialog open={confirming} onClose={() => setConfirming(false)}>
          <DialogTitle>{`Disconnect ${connection.label}?`}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {LOYALTY_DISCONNECT_EXPLANATION}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(false)}>{'Cancel'}</Button>
            <Button
              color="error"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                void act(
                  { action: 'disconnect', confirm: true },
                  `${connection.label} disconnected`,
                )
              }}
            >
              {'Disconnect'}
            </Button>
          </DialogActions>
        </Dialog>
      </CardDisplay>
    )
  }

  const held = answer.builtInPoints ?? 0
  const label = LOYALTY_CONNECTOR_LABELS[provider]
  const connect = () =>
    act(
      {
        action: 'connect',
        provider,
        credentials: fields,
        replaceBalances: replace,
      },
      `${label} connected`,
    )
  return (
    <CardDisplay
      header="Rewards account"
      subheader="Already run Smile.io or Yotpo Loyalty? Connect your own account and your members’ points are kept there instead of in the built-in program."
      help={help}
      HeaderProps={{
        action: (
          <Button
            variant="contained"
            disabled={busy || (held > 0 && !replace)}
            onClick={connect}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <TextField
          select
          label="Service"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as LoyaltyConnectorId)
            setFields({})
          }}
          slotProps={{
            htmlInput: { 'data-testid': 'loyalty-connector-provider' },
          }}
          fullWidth
        >
          {LOYALTY_CONNECTOR_IDS.map((id) => (
            <MenuItem key={id} value={id}>
              {LOYALTY_CONNECTOR_LABELS[id]}
            </MenuItem>
          ))}
        </TextField>
        {LOYALTY_CONNECTOR_FIELDS[provider].map((field) => (
          <TextField
            key={field.name}
            label={field.label}
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            value={fields[field.name] ?? ''}
            onChange={(event) =>
              setFields((prior) => ({
                ...prior,
                [field.name]: event.target.value,
              }))
            }
            helperText={field.helper}
            slotProps={{
              htmlInput: { 'data-testid': `loyalty-connector-${field.name}` },
            }}
            fullWidth
          />
        ))}
        {provider === 'smile' ? (
          <Typography variant="body2" color="text.secondary">
            {
              'Smile.io offers API keys on its Plus and Enterprise plans. A buyer who is not yet in your Smile.io program earns once they join it.'
            }
          </Typography>
        ) : null}
        {held > 0 ? (
          <FormControlLabel
            control={
              <Checkbox
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
              />
            }
            label={`Use ${label} balances while connected. The ${formatPoints(held)} built-in points members hold are set aside and come back exactly if you disconnect.`}
          />
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

export default LoyaltyConnectionCard
