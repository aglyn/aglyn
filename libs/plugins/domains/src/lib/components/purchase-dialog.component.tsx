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
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { LEGAL_ORIGIN } from '@aglyn/aglyn/app-utils/published-legal-pages'
import { useEffect, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import type { DomainRegistrationView } from '../model/registration'
import {
  DomainsRequestError,
  formatMoney,
  useDomainsFetch,
  type ContactDefaults,
  type DomainOfferView,
  type DomainsScope,
} from './domains-api'
import {
  badFieldsSentence,
  contactFormValue,
  RegistrantContactFields,
  type ContactFormValue,
} from './registrant-contact-fields.component'

/*
 * BUYING ONE NAME (AGL-3962): what it costs now and every year after, who it
 * is registered to, and the terms — the three things a registrar requires and
 * a first-time buyer has never been asked. Nothing technical is asked here:
 * no nameservers, no records, no years to choose.
 *
 * Bought from the workspace's Domains page, or for a site that already has
 * a domain, the name goes into the workspace unassigned (AGL-4040), and the
 * dialog says so before the click.
 */

/**
 * Where the domain registration terms are published: the deployment's own
 * terms page, the origin the console's clickwrap links read
 * (`NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN`), so a self-hosted install never
 * points its buyers at Aglyn's terms.
 */
export const DOMAIN_TERMS_URL = `${LEGAL_ORIGIN}/legal/terms`
/** ICANN's statement of what a registrant may expect and must do. */
export const ICANN_REGISTRANT_RIGHTS_URL =
  'https://www.icann.org/resources/pages/benefits-2013-09-16-en'

/** The terms checkbox a purchase and a transfer in both ask for. */
export function DomainTermsCheckbox(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <FormControlLabel
      control={
        <Checkbox
          checked={props.checked}
          onChange={(event) => props.onChange(event.target.checked)}
          disabled={props.disabled}
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
  )
}

export interface PurchaseDialogProps {
  open: boolean
  scope: DomainsScope
  offer: DomainOfferView | null
  defaults: ContactDefaults
  /** The name goes into the workspace, connected to no site. */
  intoWorkspace: boolean
  onClose: () => void
  onBought: (registration: DomainRegistrationView, intoWorkspace: boolean) => void
}

export function PurchaseDialog(props: PurchaseDialogProps) {
  const { open, scope, defaults, intoWorkspace, onClose, onBought } = props
  const request = useDomainsFetch()
  const [offer, setOffer] = useState<DomainOfferView | null>(props.offer)
  const [form, setForm] = useState<ContactFormValue>(contactFormValue(defaults))
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

  const submit = async () => {
    setBusy(true)
    setError(null)
    setBadFields([])
    try {
      const answer = await request<{ registration: DomainRegistrationView; intoWorkspace?: boolean }>(
        DOMAINS_API_ROUTES.purchase,
        {
          body: {
            ...scope,
            domain: offer.domain,
            expectedFirstYearCents: offer.firstYearCents,
            acceptTerms: agreed,
            contact: form,
          },
        },
      )
      onBought(answer.registration, answer.intoWorkspace ?? intoWorkspace)
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
        setError(Array.isArray(fields) && fields.length ? badFieldsSentence(fields.map(String)) : caught.message)
      } else {
        setError('Something went wrong. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Buy ${offer.domain}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Stack spacing={0.5}>
            <Typography variant="body1">
              {`First year: ${formatMoney(offer.firstYearCents)}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {`Then ${formatMoney(offer.renewalCents)} a year. We email you about 45 days before each renewal and charge the card on file about 30 days before. Turn auto-renew off at any time.`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {intoWorkspace
                ? 'It goes into your workspace’s domains, not connected to a site. Connect it to any of your sites from the Domains page when you’re ready.'
                : 'We set the domain up for your site. There is nothing to configure.'}
            </Typography>
          </Stack>

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">{'Who the domain is registered to'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {'Every domain is registered to a real person or business, who owns it. These details go to the registrar and are hidden from public domain lookups.'}
            </Typography>
            <RegistrantContactFields
              value={form}
              onChange={setForm}
              badFields={badFields}
              disabled={busy}
              emailHelp="The registrar emails this address once to confirm it. Confirm it to keep the domain."
            />
          </Stack>

          <DomainTermsCheckbox checked={agreed} onChange={setAgreed} disabled={busy} />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !agreed}>
          {busy ? 'Buying…' : `Buy for ${formatMoney(offer.firstYearCents)}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
