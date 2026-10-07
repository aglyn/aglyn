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

import type { PluginShippingAddress, PluginShippingService } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { mdiDeleteOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import {
  LABEL_FORMAT_LABELS,
  MAX_PACKAGE_PRESETS,
  SIGNATURE_LABELS,
  type ShippingHostSettings,
  type ShippingPackagePreset,
} from '../model/shipping-settings'
import { LABEL_FORMATS, SIGNATURE_OPTIONS } from '../providers/types'
import { AddressFields } from './address-fields.component'
import { useShippingAvailability, useShippingFetch } from './shipping-api'

/** What `commerceSettings` hands a widget: the site, and its workspace when known. */
export interface ShippingSettingsWidgetProps {
  hostId: string
  orgId?: string
}

interface SettingsAnswer {
  settings: ShippingHostSettings
  places: Array<{ id: string; name: string; address: PluginShippingAddress }>
  shipFromResolved: boolean
  services: PluginShippingService[]
  provider: string
  testMode: boolean
}

interface AccountAnswer {
  opened: boolean
  consent: { acceptedAtMs: number } | null
  consentText: string
  markupPct: number
}

const newPresetId = () => `box_${Math.random().toString(36).slice(2, 10)}`

/**
 * SHIPPING LABELS, on the store's Settings (AGL-3612): the boxes a label is
 * bought in, where parcels leave from, how labels print, what checkout may
 * offer, and how label costs are paid. Draws nothing on a deployment with no
 * carrier provider. Save is the card's one write, in its header.
 */
export function ShippingSettingsCard(props: ShippingSettingsWidgetProps) {
  const { hostId } = props
  const availability = useShippingAvailability(hostId)
  const request = useShippingFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [loaded, setLoaded] = useState<SettingsAnswer | null>(null)
  const [draft, setDraft] = useState<ShippingHostSettings | null>(null)
  const [account, setAccount] = useState<AccountAnswer | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!availability.available) return
    let live = true
    request<SettingsAnswer>(SHIPPING_API_ROUTES.settings, { query: { hostId } })
      .then((answer) => {
        if (!live) return
        setLoaded(answer)
        setDraft(answer.settings)
      })
      .catch((cause: Error) => live && setError(cause.message))
    request<AccountAnswer>(SHIPPING_API_ROUTES.account, { query: { hostId } })
      .then((answer) => live && setAccount(answer))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [availability.available, hostId, request])

  const update = useCallback((patch: Partial<ShippingHostSettings>) => {
    setDraft((prior) => (prior ? { ...prior, ...patch } : prior))
  }, [])

  const updatePreset = (index: number, patch: Partial<ShippingPackagePreset>) => {
    if (!draft) return
    update({ packages: draft.packages.map((box, at) => (at === index ? { ...box, ...patch } : box)) })
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const answer = await request<SettingsAnswer>(SHIPPING_API_ROUTES.settings, {
        body: { hostId, settings: draft },
      })
      setLoaded(answer)
      setDraft(answer.settings)
      enqueueSnackbar('Shipping settings saved', { variant: 'success' })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleConsent = async (accepted: boolean) => {
    try {
      setAccount(await request<AccountAnswer>(SHIPPING_API_ROUTES.account, { body: { hostId, accepted } }))
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    }
  }

  if (!availability.available) return null

  return (
    <CardDisplay
      header="Shipping labels"
      subheader={`Buy carrier labels from your orders through ${availability.provider ?? 'your carrier platform'}.`}
      HeaderProps={{
        action: (
          <Button variant="contained" onClick={handleSave} disabled={!draft || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      {availability.testMode ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {'Test mode: labels and rates are samples, and nothing is charged.'}
        </Alert>
      ) : null}
      {draft && loaded ? (
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle1">{'Ship from'}</Typography>
            <TextField
              select
              label="Location"
              value={draft.shipFromId ?? ''}
              onChange={(event) => update({ shipFromId: event.target.value || undefined })}
              helperText={
                loaded.places.length
                  ? 'Pick one of your store locations, or enter an address below.'
                  : 'Add an address to a store location, or enter one below.'
              }
            >
              <MenuItem value="">{'An address of its own'}</MenuItem>
              {loaded.places.map((place) => (
                <MenuItem key={place.id} value={place.id}>
                  {place.name}
                </MenuItem>
              ))}
            </TextField>
            {!draft.shipFromId ? (
              <AddressFields
                value={draft.shipFromAddress}
                onChange={(shipFromAddress) => update({ shipFromAddress })}
              />
            ) : null}
            {!loaded.shipFromResolved ? (
              <Alert severity="warning">
                {'Labels and carrier rates need a complete address to ship from: street, city, postal code and country.'}
              </Alert>
            ) : null}
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="subtitle1">{'Boxes'}</Typography>
            {draft.packages.map((box, index) => (
              <Stack key={box.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Name"
                  value={box.name}
                  onChange={(event) => updatePreset(index, { name: event.target.value })}
                  sx={{ flex: 2 }}
                />
                {(['lengthCm', 'widthCm', 'heightCm'] as const).map((side) => (
                  <TextField
                    key={side}
                    type="number"
                    label={side === 'lengthCm' ? 'Length (cm)' : side === 'widthCm' ? 'Width (cm)' : 'Height (cm)'}
                    value={box[side]}
                    onChange={(event) => updatePreset(index, { [side]: Number(event.target.value) })}
                    sx={{ flex: 1 }}
                  />
                ))}
                <TextField
                  type="number"
                  label="Empty weight (g)"
                  value={box.emptyWeightGrams}
                  onChange={(event) => updatePreset(index, { emptyWeightGrams: Number(event.target.value) })}
                  sx={{ flex: 1 }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={(draft.defaultPackageId ?? draft.packages[0]?.id) === box.id}
                      onChange={() => update({ defaultPackageId: box.id })}
                    />
                  }
                  label="Default"
                />
                <IconButton
                  aria-label={`Remove ${box.name}`}
                  disabled={draft.packages.length <= 1}
                  onClick={() => update({ packages: draft.packages.filter((_, at) => at !== index) })}
                >
                  <MdiIcon path={mdiDeleteOutline.path} size={0.8} />
                </IconButton>
              </Stack>
            ))}
            <Stack direction="row">
              <Button
                disabled={draft.packages.length >= MAX_PACKAGE_PRESETS}
                onClick={() =>
                  update({
                    packages: [
                      ...draft.packages,
                      { id: newPresetId(), name: 'New box', lengthCm: 20, widthCm: 15, heightCm: 10, emptyWeightGrams: 100 },
                    ],
                  })
                }
              >
                {'Add a box'}
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="subtitle1">{'Labels'}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                select
                label="Label format"
                value={draft.labelFormat}
                onChange={(event) => update({ labelFormat: event.target.value as ShippingHostSettings['labelFormat'] })}
                sx={{ flex: 1 }}
              >
                {LABEL_FORMATS.map((format) => (
                  <MenuItem key={format} value={format}>
                    {LABEL_FORMAT_LABELS[format]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Signature"
                value={draft.signature}
                onChange={(event) => update({ signature: event.target.value as ShippingHostSettings['signature'] })}
                sx={{ flex: 1 }}
              >
                {SIGNATURE_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {SIGNATURE_LABELS[option]}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.insurance === 'order_value'}
                  onChange={(event) => update({ insurance: event.target.checked ? 'order_value' : 'none' })}
                />
              }
              label="Insure each label for the value of what it carries"
            />
            <TextField
              label="Customs declarations signed by"
              value={draft.customsSigner ?? ''}
              onChange={(event) => update({ customsSigner: event.target.value || undefined })}
              helperText="Printed on customs forms for parcels that cross a border."
            />
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="subtitle1">{'Services offered at checkout'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {'Carrier rates at checkout offer these services. Leave all unticked to offer every service the carrier quotes. Each shipping rate set to Carrier rates can narrow this further.'}
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2 }}>
              {loaded.services.map((service) => (
                <FormControlLabel
                  key={service.serviceKey}
                  control={
                    <Checkbox
                      checked={draft.checkoutServices.includes(service.serviceKey)}
                      onChange={(event) =>
                        update({
                          checkoutServices: event.target.checked
                            ? [...draft.checkoutServices, service.serviceKey]
                            : draft.checkoutServices.filter((key) => key !== service.serviceKey),
                        })
                      }
                    />
                  }
                  label={service.label}
                />
              ))}
            </Stack>
          </Stack>

          {account ? (
            <Stack spacing={1.5}>
              <Typography variant="subtitle1">{'Paying for labels'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {account.markupPct > 0
                  ? `Labels are charged at the carrier’s price plus ${account.markupPct}%.`
                  : 'Labels are charged at the carrier’s price, with nothing added.'}{' '}
                {'Labels on a carrier account of your own are billed to you by that carrier instead.'}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox checked={Boolean(account.consent)} onChange={(event) => handleConsent(event.target.checked)} />
                }
                label={account.consentText}
              />
            </Stack>
          ) : null}
        </Stack>
      ) : null}
    </CardDisplay>
  )
}
ShippingSettingsCard.displayName = 'ShippingSettingsCard'

export default ShippingSettingsCard
