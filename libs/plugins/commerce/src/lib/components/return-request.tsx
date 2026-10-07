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

import * as Aglyn from '@aglyn/aglyn'
import { mdiPackageVariantClosed } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import MuiLink from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { RETURN_REQUEST_COMPONENT_ID } from '../constants/return-request'
import {
  RETURN_NOTE_MAX,
  RETURN_STATUS_COLOR,
  RETURN_STATUS_LABELS,
  type ReturnableLine,
  type ReturnStatus,
} from '../model/commerce-returns'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = RETURN_REQUEST_COMPONENT_ID

export interface ReturnRequestProps {
  heading?: string
}

/** `GET /api/commerce/return-request`, as the buyer's door answers it. */
interface ReturnRequestData {
  enabled: boolean
  windowEndsAtMs: number | null
  windowOpen: boolean
  lines: ReturnableLine[]
  reasons: Array<{ value: string; label: string }>
  returns: Array<{
    id: string
    status: ReturnStatus
    lines: Array<{ lineItemId: number; quantity: number; reason: string }>
    createdAtMs: number
    returnLabel?: { labelUrl: string; carrier?: string; trackingNumber?: string }
    merchantNote?: string
  }>
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'no-order' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: ReturnRequestData }

const ENDPOINT = '/api/commerce/return-request'

const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

const lineName = (line: Pick<ReturnableLine, 'name' | 'variantLabel'> | undefined) =>
  line ? (line.variantLabel ? `${line.name} (${line.variantLabel})` : line.name) : 'Item'

/**
 * Request a return (AGL-3611): the buyer picks what goes back, how many and
 * why, from an order they hold the signed status link for or that their
 * site-member session owns. The order is read after hydration, never into
 * the server-rendered page — the page is the same for every visitor and the
 * order is not.
 */
const ReturnRequest = forwardRef<HTMLDivElement, ReturnRequestProps>((props, ref) => {
  const { heading, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { hostId } = Aglyn.useSite()
  const siteFetch = Aglyn.useSiteFetch()
  const [order, setOrder] = useState<{ orderId: string; token: string } | null>(null)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('o') ?? ''
    if (!orderId) {
      setState({ phase: 'no-order' })
      return
    }
    setOrder({ orderId, token: params.get('t') ?? '' })
  }, [])

  const load = useCallback(async () => {
    if (!hostId || !order) return
    try {
      const query = new URLSearchParams({ hostId, orderId: order.orderId })
      if (order.token) query.set('t', order.token)
      const response = await siteFetch(`${ENDPOINT}?${query.toString()}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setState({
          phase: 'error',
          message: String(payload?.error ?? 'We could not load this order.'),
        })
        return
      }
      setState({ phase: 'ready', data: payload as ReturnRequestData })
    } catch {
      setState({ phase: 'error', message: 'We could not load this order. Please try again.' })
    }
  }, [hostId, order, siteFetch])

  useEffect(() => {
    void load()
  }, [load])

  const chosen = useMemo(
    () =>
      state.phase === 'ready'
        ? state.data.lines.filter((line) => (quantities[line.lineItemId] ?? 0) > 0)
        : [],
    [state, quantities],
  )
  const missingReason = chosen.some((line) => !reasons[line.lineItemId])

  const handleSubmit = useCallback(async () => {
    if (!hostId || !order || submitting || chosen.length === 0 || missingReason) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const response = await siteFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          orderId: order.orderId,
          ...(order.token ? { t: order.token } : {}),
          lines: chosen.map((line) => ({
            lineItemId: line.lineItemId,
            quantity: quantities[line.lineItemId],
            reason: reasons[line.lineItemId],
          })),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setSubmitError(
          String(payload?.error ?? 'Your return could not be requested. Please try again.'),
        )
        return
      }
      setSubmitted(true)
      setQuantities({})
      setReasons({})
      setNote('')
      await load()
    } catch {
      setSubmitError('Your return could not be requested. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [hostId, order, submitting, chosen, missingReason, siteFetch, quantities, reasons, note, load])

  const title = (
    <Typography variant="h4" component="h1" gutterBottom>
      {heading || 'Request a return'}
    </Typography>
  )

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[{ p: 3, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1 }, ...nodeSx]}
      >
        <Typography variant="body2" color="text.secondary">
          {'Request a return — the buyer’s order and return form render here'}
        </Typography>
      </Box>
    )
  }

  if (state.phase === 'loading') {
    return (
      <Box ref={ref} {...rest} sx={nodeSx}>
        {title}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} aria-label="Loading your order" />
        </Box>
      </Box>
    )
  }

  if (state.phase === 'no-order' || state.phase === 'error') {
    return (
      <Box ref={ref} {...rest} sx={nodeSx}>
        {title}
        <Alert severity={state.phase === 'error' ? 'error' : 'info'}>
          {state.phase === 'error'
            ? state.message
            : 'Open this page from the orders in your account.'}
        </Alert>
      </Box>
    )
  }

  const { data } = state
  const byLine = new Map(data.lines.map((line) => [line.lineItemId, line]))
  const anyReturnable = data.lines.some((line) => line.returnable > 0)
  const canRequest = data.enabled && data.windowOpen && anyReturnable

  return (
    <Box ref={ref} {...rest} sx={[{ display: 'flex', flexDirection: 'column', gap: 3 }, ...nodeSx]}>
      <Box>
        {title}
        {data.windowEndsAtMs !== null && data.enabled ? (
          <Typography variant="body2" color="text.secondary">
            {data.windowOpen
              ? `Returns are accepted until ${longDate(data.windowEndsAtMs)}.`
              : `The return window for this order closed on ${longDate(data.windowEndsAtMs)}.`}
          </Typography>
        ) : null}
      </Box>

      {submitted ? (
        <Alert severity="success">
          {'Your return request was sent. The store will review it and email you with the next steps.'}
        </Alert>
      ) : null}

      {data.returns.length > 0 ? (
        <Stack spacing={1.5}>
          <Divider textAlign="left">{'Your returns'}</Divider>
          {data.returns.map((entry) => (
            <Box key={entry.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                  {entry.lines
                    .map((line) => `${line.quantity}× ${lineName(byLine.get(line.lineItemId))}`)
                    .join(', ')}
                </Typography>
                <Chip
                  label={RETURN_STATUS_LABELS[entry.status] ?? entry.status}
                  color={RETURN_STATUS_COLOR[entry.status] ?? 'default'}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                {`Requested ${longDate(entry.createdAtMs)}`}
              </Typography>
              {entry.returnLabel?.labelUrl ? (
                <Typography variant="body2">
                  <MuiLink href={entry.returnLabel.labelUrl} target="_blank" rel="noopener noreferrer">
                    {'Print your return label'}
                  </MuiLink>
                  {entry.returnLabel.trackingNumber
                    ? ` · ${[entry.returnLabel.carrier, entry.returnLabel.trackingNumber].filter(Boolean).join(' ')}`
                    : ''}
                </Typography>
              ) : null}
              {entry.status === 'declined' && entry.merchantNote ? (
                <Alert severity="info" variant="outlined">
                  {`From the store: ${entry.merchantNote}`}
                </Alert>
              ) : null}
            </Box>
          ))}
        </Stack>
      ) : null}

      {!data.enabled ? (
        <Alert severity="info">
          {'This store does not take return requests online. Contact the store instead.'}
        </Alert>
      ) : !data.windowOpen ? (
        <Alert severity="info">
          {'The return window for this order has closed. Contact the store if you need help.'}
        </Alert>
      ) : !anyReturnable ? (
        <Alert severity="info">{'Nothing on this order can be returned right now.'}</Alert>
      ) : null}

      {canRequest ? (
        <Stack
          spacing={2}
          component="form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <Divider textAlign="left">{'Choose items to return'}</Divider>
          {data.lines.map((line) => {
            const name = lineName(line)
            const quantity = quantities[line.lineItemId] ?? 0
            const blocked = line.returnable === 0
            const setQuantity = (next: number) =>
              setQuantities((prev) => ({
                ...prev,
                [line.lineItemId]: Math.max(0, Math.min(line.returnable, next)),
              }))
            return (
              <Box
                key={line.lineItemId}
                data-line={line.lineItemId}
                sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Typography variant="body1" color={blocked ? 'text.disabled' : 'text.primary'}>
                      {name}
                    </Typography>
                    {line.blocked ? (
                      <Typography variant="caption" color="text.secondary">
                        {line.blocked}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {`Up to ${line.returnable} can be returned`}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      aria-label={`Fewer of ${name}`}
                      disabled={blocked || quantity <= 0}
                      onClick={() => setQuantity(quantity - 1)}
                      sx={{ minWidth: 0 }}
                    >
                      {'−'}
                    </Button>
                    <Typography
                      variant="body1"
                      aria-live="polite"
                      sx={{ minWidth: 24, textAlign: 'center' }}
                    >
                      {quantity}
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      aria-label={`More of ${name}`}
                      disabled={blocked || quantity >= line.returnable}
                      onClick={() => setQuantity(quantity + 1)}
                      sx={{ minWidth: 0 }}
                    >
                      {'+'}
                    </Button>
                  </Box>
                </Box>
                <TextField
                  select
                  size="small"
                  label={`Reason for returning ${name}`}
                  value={reasons[line.lineItemId] ?? ''}
                  disabled={blocked || quantity === 0}
                  required={quantity > 0}
                  onChange={(event) =>
                    setReasons((prev) => ({ ...prev, [line.lineItemId]: event.target.value }))
                  }
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                  sx={{ maxWidth: 360 }}
                >
                  <option value="">{'Choose a reason'}</option>
                  {data.reasons.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </TextField>
              </Box>
            )
          })}
          <TextField
            label="Anything the store should know? (optional)"
            multiline
            minRows={3}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, RETURN_NOTE_MAX))}
            slotProps={{ htmlInput: { maxLength: RETURN_NOTE_MAX } }}
            helperText={`${note.length}/${RETURN_NOTE_MAX}`}
          />
          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
          <Box>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={submitting || chosen.length === 0 || missingReason}
            >
              {submitting ? 'Sending…' : 'Request return'}
            </Button>
          </Box>
        </Stack>
      ) : null}
    </Box>
  )
})
ReturnRequest.displayName = 'AglynReturnRequest'

export const schema: Aglyn.ComponentSchema<ReturnRequestProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Return request',
  description:
    'The buyer’s return form for one order, opened from their account or the order’s status page.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiPackageVariantClosed.path, sx: { color: 'success.dark' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Defaults to "Request a return".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Return request',
    pluginId: BUNDLE_ID,
    description: 'The buyer’s return form for one order',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiPackageVariantClosed.path, sx: { color: 'success.dark' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default ReturnRequest
