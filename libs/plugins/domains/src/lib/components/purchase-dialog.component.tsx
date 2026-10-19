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
  COUNTRY_OPTIONS,
  countryOption,
  type CountryOption,
} from '@aglyn/aglyn/app-utils/country-options'
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import type { DomainRegistrationView } from '../model/registration'
import {
  DomainsRequestError,
  formatMoney,
  useDomainsFetch,
  type DomainOfferView,
} from './domains-api'

/*
 * BUYING ONE NAME (AGL-3962): what it costs now and every year after, who it
 * is registered to, and the terms — the three things a registrar requires and
 * a first-time buyer has never been asked. Nothing technical is asked here:
 * no nameservers, no records, no years to choose.
 */

/** Where the domain registration terms are published. */
export const DOMAIN_TERMS_URL = 'https://aglyn.com/legal/terms'
/** ICANN's statement of what a registrant may expect and must do. */
export const ICANN_REGISTRANT_RIGHTS_URL =
  'https://www.icann.org/resources/pages/benefits-2013-09-16-en'

interface ContactForm {
  firstName: string
  lastName: string
  companyName: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
}

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  address1: 'Street address',
  city: 'City',
  state: 'State or region',
  zip: 'Postal code',
  country: 'Country',
}

export interface PurchaseDialogProps {
  open: boolean
  hostId: string
  offer: DomainOfferView | null
  defaults: { firstName: string; lastName: string; email: string }
  onClose: () => void
  onBought: (registration: DomainRegistrationView) => void
}

export function PurchaseDialog(props: PurchaseDialogProps) {
  const { open, hostId, defaults, onClose, onBought } = props
  const request = useDomainsFetch()
  const [offer, setOffer] = useState<DomainOfferView | null>(props.offer)
  const [form, setForm] = useState<ContactForm>({
    firstName: defaults.firstName,
    lastName: defaults.lastName,
    companyName: '',
    email: defaults.email,
    phone: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
  })
  const [country, setCountry] = useState<CountryOption | null>(countryOption('US'))
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [badFields, setBadFields] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setOffer(props.offer)
      setError(null)
      setBadFields([])
      setAgreed(false)
    }
  }, [open, props.offer])

  if (!offer) return null
  const set = (field: keyof ContactForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }))
  const fieldProps = (field: keyof ContactForm, required = true) => ({
    value: form[field],
    onChange: set(field),
    required,
    error: badFields.includes(field),
    disabled: busy,
    size: 'small' as const,
  })

  const submit = async () => {
    setBusy(true)
    setError(null)
    setBadFields([])
    try {
      const answer = await request<{ registration: DomainRegistrationView }>(
        DOMAINS_API_ROUTES.purchase,
        {
          body: {
            hostId,
            domain: offer.domain,
            expectedFirstYearCents: offer.firstYearCents,
            acceptTerms: agreed,
            contact: { ...form, country: country?.code ?? '' },
          },
        },
      )
      onBought(answer.registration)
    } catch (caught) {
      if (caught instanceof DomainsRequestError) {
        if (caught.code === 'price-changed') {
          setOffer({
            ...offer,
            firstYearCents: Number(caught.payload['firstYearCents'] ?? offer.firstYearCents),
            renewalCents: Number(caught.payload['renewalCents'] ?? offer.renewalCents),
          })
        }
        const fields = caught.payload['fields']
        if (Array.isArray(fields)) setBadFields(fields.map(String))
        setError(
          Array.isArray(fields) && fields.length
            ? `Check these details: ${fields.map((field) => FIELD_LABELS[String(field)] ?? field).join(', ')}.`
            : caught.message,
        )
      } else {
        setError('Something went wrong. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const free = offer.freeFirstYear
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Buy ${offer.domain}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Stack spacing={0.5}>
            <Typography variant="body1">
              {free
                ? 'First year: included with your annual plan'
                : `First year: ${formatMoney(offer.firstYearCents)}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {`Then ${formatMoney(offer.renewalCents)} a year. We email you about 45 days before each renewal and charge the card on file about 30 days before. Turn auto-renew off at any time.`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {'We set the domain up for your site. There is nothing to configure.'}
            </Typography>
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">{'Who the domain is registered to'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {'Every domain is registered to a real person or business, who owns it. These details go to the registrar and are hidden from public domain lookups.'}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="First name" {...fieldProps('firstName')} sx={{ flex: 1 }} />
              <TextField label="Last name" {...fieldProps('lastName')} sx={{ flex: 1 }} />
            </Stack>
            <TextField label="Business name (optional)" {...fieldProps('companyName', false)} />
            <TextField
              label="Email"
              type="email"
              {...fieldProps('email')}
              helperText="The registrar emails this address once to confirm it. Confirm it to keep the domain."
            />
            <TextField label="Phone" type="tel" {...fieldProps('phone')} />
            <TextField label="Street address" {...fieldProps('address1')} />
            <TextField label="Apartment, suite (optional)" {...fieldProps('address2', false)} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="City" {...fieldProps('city')} sx={{ flex: 2 }} />
              <TextField label="State or region" {...fieldProps('state')} sx={{ flex: 1 }} />
              <TextField label="Postal code" {...fieldProps('zip')} sx={{ flex: 1 }} />
            </Stack>
            <Autocomplete
              options={COUNTRY_OPTIONS}
              value={country}
              onChange={(_event, next) => setCountry(next)}
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(option, value) => option.code === value.code}
              disabled={busy}
              size="small"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Country or region"
                  required
                  error={badFields.includes('country')}
                />
              )}
            />
          </Stack>

          <FormControlLabel
            control={
              <Checkbox
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                disabled={busy}
              />
            }
            label={
              <Typography variant="body2">
                {'I agree to the '}
                <Link href={DOMAIN_TERMS_URL} target="_blank" rel="noopener">
                  {'domain registration terms'}
                </Link>
                {' and have read the '}
                <Link href={ICANN_REGISTRANT_RIGHTS_URL} target="_blank" rel="noopener">
                  {'registrant rights and responsibilities'}
                </Link>
                {'. The domain renews every year until I turn auto-renew off.'}
              </Typography>
            }
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !agreed}>
          {busy
            ? 'Buying…'
            : free
              ? `Get ${offer.domain}`
              : `Buy for ${formatMoney(offer.firstYearCents)}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
