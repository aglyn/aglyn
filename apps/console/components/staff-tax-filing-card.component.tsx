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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Autocomplete,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import {
  COUNTRY_OPTIONS,
  countryOption,
  type CountryOption,
} from '../utils/country-options'
import {
  isTaxJurisdictionKey,
  type MaskedTaxIdentifier,
  type TaxFilingConfigView,
  type TaxFilingSource,
} from '../utils/tax-filing-config'

interface TaxFilingBody {
  role: string
  config: TaxFilingConfigView
  limits: { noteMax: number }
}

/** What a source chip says, per layer. */
const SOURCE_LABEL: Record<TaxFilingSource, string> = {
  console: 'From this console',
  environment: 'From the environment',
  none: 'Not set',
}

/**
 * WHERE THIS DEPLOYMENT FILES ITS SALES TAX (AGL-2021).
 *
 * The jurisdiction and the registration numbers were three environment
 * variables, so registering in a new state meant an environment edit and a
 * redeploy. Registering somewhere new is an operator action; it was a
 * deployment action.
 *
 * ## Two layers, and the card says which one won
 *
 * The console wins and the environment is the bootstrap. That rule is
 * invisible from either side on its own — an operator who edits `.env`, ships
 * it and sees nothing change has no way to learn that a stored value outranked
 * it — so **every field renders the layer it came from**, and an environment
 * variable that is set but outranked is named, with the reason, under "Not in
 * force". Nothing here shows an environment variable's VALUE; a name is not a
 * secret and a value is.
 *
 * ## Nothing here shows a registration number back to the screen
 *
 * The registration number reports as configured with a last four — enough to
 * answer "is this the number I think it is", which is the only question this
 * screen asks of it. The filing credential reports as configured and nothing
 * more: the Texas Webfile number is six digits behind a fixed prefix and
 * authenticates a profile at the Comptroller, so a last four of it narrows the
 * secret to a hundred candidates rather than masking it.
 *
 * There is no reveal, deliberately. The one reader who could use one is
 * already looking at the filing surface, where `/admin/tax-return` prints both
 * numbers in full at the moment they are transcribed onto a return. A second
 * place to display them would add a place to leak them and no capability.
 *
 * ## Why the fields are write-only, and what blank means
 *
 * Because they are never read back, a blank identifier field cannot mean
 * "erase" — that would make editing the filing period a way to silently unset
 * a registration. Blank means "leave what is stored"; the switch below is the
 * explicit erase.
 */
export default function StaffTaxFilingCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<TaxFilingBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [country, setCountry] = useState<CountryOption | null>(null)
  const [subdivision, setSubdivision] = useState('')
  const [registrationId, setRegistrationId] = useState('')
  const [filingId, setFilingId] = useState('')
  const [firstTaxablePeriod, setFirstTaxablePeriod] = useState('')
  const [removeIdentifiers, setRemoveIdentifiers] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const idToken = await (user as any)?.getIdToken?.()
      if (!idToken) return
      const response = await fetch('/api/admin/tax-filing', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error ?? 'Could not load the filing configuration')
        return
      }
      setError(null)
      const body = payload as TaxFilingBody
      setData(body)
      const [countryCode, ...rest] = String(body.config.jurisdiction).split('-')
      setCountry(countryOption(countryCode))
      setSubdivision(rest.join('-'))
      setFirstTaxablePeriod(body.config.firstTaxablePeriod)
      // The identifier fields are never populated from the response, because
      // the response never carries them. Cleared on every load so a value
      // typed and not saved cannot be resubmitted by a later click.
      setRegistrationId('')
      setFilingId('')
      setRemoveIdentifiers(false)
    } catch {
      setError('Could not load the filing configuration')
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  /** The bucket key the two inputs compose to, shown before it is stored. */
  const proposedKey = useMemo(() => {
    const base = country?.code ?? ''
    const sub = subdivision.trim().toUpperCase()
    return sub ? `${base}-${sub}` : base
  }, [country, subdivision])
  const keyValid = isTaxJurisdictionKey(proposedKey)
  const jurisdictionChanged =
    Boolean(proposedKey) && proposedKey !== data?.config.jurisdiction

  const save = async () => {
    if (busy || !data) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const body: Record<string, unknown> = {
        jurisdiction: proposedKey,
        firstTaxablePeriod: firstTaxablePeriod.trim(),
        note: note.trim(),
      }
      // A key is sent only when the operator meant to change that identifier.
      // See the note on blank fields above.
      if (removeIdentifiers) {
        body['registrationId'] = ''
        body['filingId'] = ''
      } else {
        if (registrationId.trim()) body['registrationId'] = registrationId.trim()
        if (filingId.trim()) body['filingId'] = filingId.trim()
      }
      const response = await fetch('/api/admin/tax-filing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not save the filing configuration', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar(`Filing configuration saved — ${payload?.config?.jurisdiction}`, {
        variant: 'success',
        persist: false,
      })
      setNote('')
      // Re-read rather than trusting the click: the card states the
      // post-condition, so what it shows is what is stored and which layer it
      // came from — not what was asked for.
      await load()
    } finally {
      setBusy(false)
    }
  }

  const clearStored = async () => {
    if (busy || !data) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/tax-filing', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ note: note.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not clear the filing configuration', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar('Console setting cleared — the environment is in force again', {
        variant: 'success',
        persist: false,
      })
      setNote('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const isSuper = data?.role === 'super'
  const config = data?.config

  return (
    <CardDisplay
      header={'Sales tax filing'}
      help={docsHelp('salesTaxReturn', {
        anchor: '#where-this-deployment-files',
        excerpt:
          'Which authority the sales tax return is prepared for, and the ' +
          'registration numbers it is filed under. Stored here wins; the ' +
          'AGLYN_TAX_* variables are the bootstrap for a fresh install.',
      })}
      subheader={
        'Which authority /admin/tax-return is prepared for, and under whose ' +
        'registration numbers. Changing it needs no deploy.'
      }
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : !config ? (
        <Typography variant="body2">Loading…</Typography>
      ) : (
        <Stack spacing={2}>
          <Alert severity="info">
            This decides <strong>reporting</strong> only. What a shopper is
            charged is computed by Stripe against your own registrations at
            checkout and is unaffected by anything on this card.
          </Alert>

          {!config.jurisdictionRecognized ? (
            <Alert severity="error">
              <AlertTitle>{'Not a jurisdiction key'}</AlertTitle>
              {`“${config.jurisdiction}” cannot be a key in the return’s own ` +
                'buckets, so every figure on the return reads 0.00. Set a ' +
                'country, and a subdivision only if you file at that level.'}
            </Alert>
          ) : null}

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2">
                Files in <strong>{config.jurisdiction}</strong>
                {config.jurisdictionLabel !== config.jurisdiction
                  ? ` (${config.jurisdictionLabel})`
                  : ''}
              </Typography>
              <SourceChip source={config.jurisdictionSource} />
            </Stack>
            <IdentifierLine
              label={config.registrationIdLabel}
              identifier={config.registration}
            />
            <IdentifierLine
              label={config.filingIdLabel}
              identifier={config.filing}
              requirement={
                config.filingIdRequired
                  ? `Required for ${config.jurisdiction}`
                  : 'Optional for this jurisdiction'
              }
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2">
                Earliest filable period:{' '}
                <strong>{config.firstTaxablePeriod}</strong>
              </Typography>
              <SourceChip source={config.firstTaxablePeriodSource} />
            </Stack>
          </Stack>

          {!config.configured ? (
            <Alert severity="warning">
              {`The return cannot be filed under what is configured. ` +
                (config.filingIdRequired
                  ? `${config.jurisdiction} authenticates filing with both numbers, ` +
                    'so half a registration files nothing.'
                  : `Set the ${config.registrationIdLabel.toLowerCase()}.`)}
            </Alert>
          ) : null}

          {/*
            THE PRECEDENCE RULE, made visible. An operator who edits the
            environment and sees nothing change reads the reason here rather
            than concluding the edit did not deploy.
          */}
          {config.shadowed.length ? (
            <Alert severity="info">
              <AlertTitle>{'Set in the environment, not in force'}</AlertTitle>
              <Stack spacing={0.5}>
                {config.shadowed.map((entry) => (
                  <Typography key={entry.env} variant="body2">
                    <strong>{entry.env}</strong> — {entry.reason}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          ) : null}

          {isSuper ? (
            <Stack spacing={2}>
              <Autocomplete
                size="small"
                disabled={busy}
                options={COUNTRY_OPTIONS}
                value={country}
                onChange={(_event, next) => setCountry(next)}
                getOptionLabel={(option) => option.label}
                isOptionEqualToValue={(option, selected) =>
                  option.code === selected.code
                }
                filterOptions={(options, params) => {
                  const needle = params.inputValue.trim().toLowerCase()
                  if (!needle) return options
                  return options.filter((option) =>
                    option.searchText.includes(needle),
                  )
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Country or region" />
                )}
              />
              <TextField
                label="Subdivision (optional)"
                size="small"
                value={subdivision}
                disabled={busy}
                onChange={(event) => setSubdivision(event.target.value)}
                helperText={
                  'Only if you file at state or province level. No runtime ' +
                  'enumerates subdivisions, so this is typed rather than ' +
                  'picked — use the code the buyer addresses carry (TX, CA, ' +
                  'NSW). Most authorities file at country level; leave it blank.'
                }
                slotProps={{ htmlInput: { maxLength: 3 } }}
              />
              <Alert severity={keyValid ? 'success' : 'warning'}>
                {proposedKey
                  ? `Bucket key: ${proposedKey}${
                      keyValid ? '' : ' — not a key the return can look up'
                    }`
                  : 'Pick a country to compose the bucket key.'}
              </Alert>

              {jurisdictionChanged && config.storedPresent ? (
                <Alert severity="warning">
                  {`Moving from ${config.jurisdiction} to ${proposedKey} drops the ` +
                    'stored registration numbers. One authority’s number is ' +
                    'never filed under another, so enter the new ones here or ' +
                    'the return will read “not configured” until you do.'}
                </Alert>
              ) : null}

              <TextField
                label={config.registrationIdLabel}
                size="small"
                fullWidth
                type="password"
                value={registrationId}
                disabled={busy || removeIdentifiers}
                onChange={(event) => setRegistrationId(event.target.value)}
                autoComplete="off"
                helperText="Leave blank to keep what is stored. Never shown back."
              />
              <TextField
                label={config.filingIdLabel}
                size="small"
                fullWidth
                type="password"
                value={filingId}
                disabled={busy || removeIdentifiers}
                onChange={(event) => setFilingId(event.target.value)}
                autoComplete="off"
                helperText={
                  config.filingIdRequired
                    ? `Required alongside the ${config.registrationIdLabel.toLowerCase()} for ${config.jurisdiction}.`
                    : 'Optional for this jurisdiction — most authorities issue one number.'
                }
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={removeIdentifiers}
                    disabled={busy}
                    onChange={(event) => setRemoveIdentifiers(event.target.checked)}
                  />
                }
                label="Remove the stored numbers instead"
              />
              <TextField
                label="Earliest filable period"
                size="small"
                value={firstTaxablePeriod}
                disabled={busy}
                onChange={(event) => setFirstTaxablePeriod(event.target.value)}
                helperText={
                  'YYYY-QN or YYYY-MM — when your collection obligation began. ' +
                  'The period menu on the return offers nothing earlier.'
                }
              />
              <TextField
                label="Why (audited)"
                size="small"
                fullWidth
                required
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Registered in California, or: Webfile number reissued"
                slotProps={{ htmlInput: { maxLength: data?.limits?.noteMax ?? 280 } }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={save}
                  disabled={busy || !keyValid || !note.trim()}
                >
                  Save filing configuration
                </Button>
                <Button
                  color="warning"
                  onClick={clearStored}
                  disabled={busy || !config.storedPresent || !note.trim()}
                >
                  Clear and use the environment
                </Button>
                <Button onClick={() => void load()} disabled={busy}>
                  Refresh
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Every change is written to adminAudit with the reason above. ' +
                  'The audit row records which numbers were set, never what ' +
                  'they are.'}
              </Typography>
            </Stack>
          ) : (
            <Alert severity="info">
              Changing where the platform files needs the super staff role — the
              same bar as release flags, because the wrong jurisdiction files a
              return with an authority nobody registered with.
            </Alert>
          )}
        </Stack>
      )}
    </CardDisplay>
  )
}

/** Which layer a value in force came from. */
function SourceChip({ source }: { source: TaxFilingSource }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={source === 'console' ? 'primary' : 'default'}
      label={SOURCE_LABEL[source]}
    />
  )
}

/** One identifier's presence, never its value. */
function IdentifierLine({
  label,
  identifier,
  requirement,
}: {
  label: string
  identifier: MaskedTaxIdentifier
  requirement?: string
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2">
        {label}:{' '}
        <strong>
          {identifier.configured
            ? identifier.hint
              ? `•••• ${identifier.hint}`
              : 'Configured'
            : 'Not configured'}
        </strong>
      </Typography>
      <SourceChip source={identifier.source} />
      {requirement ? (
        <Typography variant="caption" color="text.secondary">
          {requirement}
        </Typography>
      ) : null}
    </Stack>
  )
}
