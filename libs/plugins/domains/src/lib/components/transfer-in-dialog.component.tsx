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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  type ContactDefaults,
} from './domains-api'
import { DomainTermsCheckbox } from './purchase-dialog.component'
import {
  badFieldsSentence,
  contactFormValue,
  RegistrantContactFields,
  type ContactFormValue,
} from './registrant-contact-fields.component'

/*
 * MOVING A DOMAIN HERE FROM ANOTHER REGISTRAR (AGL-4040), in two steps:
 * the name, and what it costs — a renewal's price, because a transfer adds a
 * year — then the transfer code, who it is registered to, and the terms.
 * What happens next is said in plain words: unlock it and get the code at
 * the current registrar, it takes up to about a week, and it keeps its
 * current DNS the whole time.
 */

export interface TransferInDialogProps {
  open: boolean
  orgId: string
  defaults: ContactDefaults
  onClose: () => void
  onStarted: (registration: DomainRegistrationView) => void
}

interface Quote {
  domain: string
  priceCents: number
  renewalCents: number
}

export function TransferInDialog(props: TransferInDialogProps) {
  const { open, orgId, defaults, onClose, onStarted } = props
  const request = useDomainsFetch()
  const [domain, setDomain] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [form, setForm] = useState<ContactFormValue>(contactFormValue(defaults))
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [badFields, setBadFields] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setDomain('')
    setQuote(null)
    setAuthCode('')
    setAgreed(false)
    setError(null)
    setBadFields([])
    setForm(contactFormValue(defaults))
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const checkPrice = async () => {
    setBusy(true)
    setError(null)
    try {
      setQuote(
        await request<Quote>(DOMAINS_API_ROUTES.transferInQuote, {
          query: { orgId, domain: domain.trim().toLowerCase() },
        }),
      )
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (!quote) return
    setBusy(true)
    setError(null)
    setBadFields([])
    try {
      const answer = await request<{ registration: DomainRegistrationView }>(DOMAINS_API_ROUTES.transferIn, {
        body: {
          orgId,
          domain: quote.domain,
          authCode,
          contact: form,
          expectedPriceCents: quote.priceCents,
          acceptTerms: agreed,
        },
      })
      onStarted(answer.registration)
    } catch (caught) {
      if (caught instanceof DomainsRequestError) {
        if (caught.code === 'price-changed' && caught.payload['priceCents'] !== undefined) {
          setQuote({ ...quote, priceCents: Number(caught.payload['priceCents']) })
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
      <DialogTitle>{'Transfer a domain in'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Stack spacing={1}>
            <Typography variant="body2">
              {'Move a domain you own at another registrar here, so it renews with your other domains and is managed from this page.'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {'Before you start: at your current registrar, unlock the domain and get its transfer code (sometimes called an auth or EPP code). A transfer takes up to about 5 to 7 days. The domain keeps its current DNS until it arrives, so its website and email keep working.'}
            </Typography>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
            <TextField
              label="Domain"
              placeholder="yourbusiness.com"
              value={domain}
              onChange={(event) => {
                setDomain(event.target.value)
                setQuote(null)
              }}
              disabled={busy}
              size="small"
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" disabled={busy || domain.trim().length < 4} onClick={() => void checkPrice()}>
              {'Check price'}
            </Button>
          </Stack>

          {quote ? (
            <>
              <Stack spacing={0.5}>
                <Typography variant="body1">{`Transfer: ${formatMoney(quote.priceCents)}, which adds a year to ${quote.domain}`}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {`That is what renewing it here costs. Then ${formatMoney(quote.renewalCents)} a year, charged to the card on file about 30 days before each renewal. If the transfer doesn’t complete, the charge is refunded.`}
                </Typography>
              </Stack>
              <TextField
                label="Transfer code"
                value={authCode}
                onChange={(event) => setAuthCode(event.target.value)}
                disabled={busy}
                size="small"
                required
                helperText="From your current registrar. It is passed to the registrar and not kept here."
              />
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">{'Who the domain is registered to'}</Typography>
                <RegistrantContactFields value={form} onChange={setForm} badFields={badFields} disabled={busy} />
              </Stack>
              <DomainTermsCheckbox checked={agreed} onChange={setAgreed} disabled={busy} />
            </>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        {quote ? (
          <Button
            variant="contained"
            onClick={() => void start()}
            disabled={busy || !agreed || !authCode.trim()}
          >
            {busy ? 'Starting…' : `Transfer for ${formatMoney(quote.priceCents)}`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
