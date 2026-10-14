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
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { REVIEW_PLATFORMS_API_ROUTES } from '../constants/api-routes'
import type { ReviewPlatform } from '../constants/bundle-common'
import type {
  InvitationMoment,
  ReviewPlatformsSettingsView,
  ReviewPlatformsSettingsWrite,
  TrustpilotMode,
} from '../model/review-platforms-settings'
import { useReviewPlatformsFetch } from './review-platforms-api'

/** What `commerceSettings` hands a widget: the site, and its workspace when known. */
export interface ReviewPlatformsSettingsWidgetProps {
  hostId: string
  orgId?: string
}

interface SettingsAnswer {
  settings: ReviewPlatformsSettingsView
}

type Draft = Omit<ReviewPlatformsSettingsWrite, 'platform'>

const CONSENT_NOTE =
  'Only customers who agreed to marketing email from your store are invited, and never for a test, canceled or fully refunded order. Each order is invited once.'

const MODE_LABELS: Record<TrustpilotMode, string> = {
  off: 'Off',
  bcc: 'Copy an order email to my Trustpilot invitation address',
  api: 'Trustpilot API, with my API key',
}

const MOMENT_LABELS: Record<InvitationMoment, string> = {
  shipped: 'When the order ships, goes out for delivery or is picked up',
  delivered: 'When the order is delivered or picked up',
}

/**
 * REVIEW PLATFORMS, on the store's Settings (AGL-3699): Trustpilot — by the
 * store's own invitation address, or by its own API key where the
 * deployment can keep one — and Yotpo Reviews with the store's app key and
 * secret. Credentials go in and never come back out; a card shows only
 * whether one is stored. Save sits in each card's header. The store's
 * built-in product reviews are unchanged by either.
 */
export function ReviewPlatformsSettingsCards(props: ReviewPlatformsSettingsWidgetProps) {
  const { hostId } = props
  const request = useReviewPlatformsFetch()
  const [answer, setAnswer] = useState<SettingsAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hostId) return
    let live = true
    request<SettingsAnswer>(REVIEW_PLATFORMS_API_ROUTES.settings, { query: { hostId } })
      .then((next) => live && setAnswer(next))
      .catch((cause: Error) => live && setError(cause.message))
    return () => {
      live = false
    }
  }, [hostId, request])

  if (error) return <Alert severity="error">{error}</Alert>
  if (!answer) return null
  return (
    <Stack spacing={2}>
      <TrustpilotCard hostId={hostId} settings={answer.settings} onSaved={setAnswer} />
      {answer.settings.apiAvailable ? <YotpoCard hostId={hostId} settings={answer.settings} onSaved={setAnswer} /> : null}
    </Stack>
  )
}

export default ReviewPlatformsSettingsCards

function useSave(platform: ReviewPlatform, hostId: string, onSaved: (answer: SettingsAnswer) => void) {
  const request = useReviewPlatformsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [saving, setSaving] = useState(false)
  const send = async (change: Draft, done: string): Promise<boolean> => {
    setSaving(true)
    try {
      onSaved(await request<SettingsAnswer>(REVIEW_PLATFORMS_API_ROUTES.settings, { body: { hostId, change: { platform, ...change } } }))
      enqueueSnackbar(done, { variant: 'success' })
      return true
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
      return false
    } finally {
      setSaving(false)
    }
  }
  return { saving, send }
}

function secretField(props: {
  label: string
  value: string | undefined
  stored: boolean
  onChange: (value: string) => void
}) {
  return (
    <TextField
      label={props.label}
      type="password"
      autoComplete="off"
      value={props.value ?? ''}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.stored ? 'Stored. Paste a new one to replace it' : undefined}
      fullWidth
    />
  )
}

function TrustpilotCard(props: { hostId: string; settings: ReviewPlatformsSettingsView; onSaved: (answer: SettingsAnswer) => void }) {
  const { hostId, settings, onSaved } = props
  const current = settings.trustpilot
  const [draft, setDraft] = useState<Draft>({})
  const { saving, send } = useSave('trustpilot', hostId, onSaved)
  const mode = draft.mode ?? current.mode
  const set = (patch: Draft) => setDraft((prior) => ({ ...prior, ...patch }))
  const value = (key: keyof Draft, fallback: string | null) => String((draft[key] as string | undefined) ?? fallback ?? '')
  const modes: TrustpilotMode[] = settings.apiAvailable || current.mode === 'api' ? ['off', 'bcc', 'api'] : ['off', 'bcc']

  return (
    <CardDisplay
      header="Trustpilot"
      subheader="Invite customers to review your store on Trustpilot after their order ships or arrives."
      help={pluginDocsHelp('reviewPlatforms', {
        anchor: '#trustpilot',
        title: 'Trustpilot',
        excerpt: 'Invite customers to review your store on Trustpilot after their order ships or arrives, by copying one order email to your Trustpilot invitation address.',
      })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <StatusChip
              label={current.mode === 'off' ? 'Off' : 'On'}
              tone={current.mode === 'off' ? 'neutral' : 'success'}
              data-testid="review-platforms-trustpilot-status"
            />
            {current.apiConnected ? (
              <Button color="inherit" disabled={saving} onClick={() => void send({ disconnect: true }, 'Trustpilot API key removed')}>
                {'Disconnect API'}
              </Button>
            ) : null}
            <Button
              variant="contained"
              disabled={saving || Object.keys(draft).length === 0}
              onClick={() => void send(draft, 'Trustpilot saved').then((ok) => ok && setDraft({}))}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <TextField
          select
          label="How Trustpilot hears about orders"
          value={mode}
          onChange={(event) => set({ mode: event.target.value as TrustpilotMode })}
          fullWidth
        >
          {modes.map((entry) => (
            <MenuItem key={entry} value={entry}>
              {MODE_LABELS[entry]}
            </MenuItem>
          ))}
        </TextField>
        {mode !== 'off' ? (
          <TextField
            select
            label="When to invite"
            value={draft.sendOn ?? current.sendOn}
            onChange={(event) => set({ sendOn: event.target.value as InvitationMoment })}
            fullWidth
          >
            {(Object.keys(MOMENT_LABELS) as InvitationMoment[]).map((entry) => (
              <MenuItem key={entry} value={entry}>
                {MOMENT_LABELS[entry]}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {mode === 'bcc' ? (
          <TextField
            label="Trustpilot invitation address"
            value={value('bccAddress', current.bccAddress)}
            onChange={(event) => set({ bccAddress: event.target.value })}
            helperText="Your Automatic Feedback Service address from Trustpilot Business. It ends in @invite.trustpilot.com. The order shipped, delivered or picked-up email goes to it as a blind copy, so keep that email on under Order notifications."
            fullWidth
          />
        ) : null}
        {mode === 'api' ? (
          <>
            {secretField({ label: 'API key', value: draft.apiKey, stored: current.apiConnected, onChange: (apiKey) => set({ apiKey }) })}
            {secretField({ label: 'API secret', value: draft.apiSecret, stored: current.apiConnected, onChange: (apiSecret) => set({ apiSecret }) })}
            <TextField
              label="Business unit ID"
              value={value('businessUnitId', current.businessUnitId)}
              onChange={(event) => set({ businessUnitId: event.target.value })}
              fullWidth
            />
            <TextField
              label="Business user ID"
              value={value('businessUserId', current.businessUserId)}
              onChange={(event) => set({ businessUserId: event.target.value })}
              helperText="The Trustpilot user the invitations are sent as. Optional."
              fullWidth
            />
            <TextField
              label="Language"
              value={value('locale', current.locale)}
              onChange={(event) => set({ locale: event.target.value })}
              helperText="A code like en-US. Blank uses en-US."
              fullWidth
            />
            <TextField
              label="Invitation template ID"
              value={value('templateId', current.templateId)}
              onChange={(event) => set({ templateId: event.target.value })}
              helperText="Blank uses your Trustpilot account's default template."
              fullWidth
            />
          </>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {CONSENT_NOTE}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}

function YotpoCard(props: { hostId: string; settings: ReviewPlatformsSettingsView; onSaved: (answer: SettingsAnswer) => void }) {
  const { hostId, settings, onSaved } = props
  const current = settings.yotpo
  const [draft, setDraft] = useState<Draft>({})
  const { saving, send } = useSave('yotpo', hostId, onSaved)
  const set = (patch: Draft) => setDraft((prior) => ({ ...prior, ...patch }))

  return (
    <CardDisplay
      header="Yotpo Reviews"
      subheader="Send each shipped order to your Yotpo account, so Yotpo asks the customer for a review."
      help={pluginDocsHelp('reviewPlatforms', {
        anchor: '#yotpo-reviews',
        title: 'Yotpo Reviews',
        excerpt: 'Send each shipped order to your Yotpo Reviews account, so Yotpo asks the customer for a review.',
      })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <StatusChip
              label={current.enabled ? 'On' : current.connected ? 'Connected' : 'Not connected'}
              tone={current.enabled ? 'success' : current.connected ? 'info' : 'neutral'}
              data-testid="review-platforms-yotpo-status"
            />
            {current.connected ? (
              <Button color="inherit" disabled={saving} onClick={() => void send({ disconnect: true }, 'Yotpo disconnected')}>
                {'Disconnect'}
              </Button>
            ) : null}
            <Button
              variant="contained"
              disabled={saving || Object.keys(draft).length === 0}
              onClick={() => void send(draft, 'Yotpo saved').then((ok) => ok && setDraft({}))}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <TextField
          label="App key"
          value={String(draft.appKey ?? current.appKey ?? '')}
          onChange={(event) => set({ appKey: event.target.value })}
          fullWidth
        />
        {secretField({ label: 'Secret key', value: draft.secretKey, stored: current.connected, onChange: (secretKey) => set({ secretKey }) })}
        <FormControlLabel
          control={
            <Switch checked={draft.enabled ?? current.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
          }
          label="Send shipped orders to Yotpo for review requests"
        />
        <Typography variant="body2" color="text.secondary">
          {`${CONSENT_NOTE} Your product pages keep showing your store's own reviews.`}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
