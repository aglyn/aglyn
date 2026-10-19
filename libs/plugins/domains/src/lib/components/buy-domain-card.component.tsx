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

import type {
  ConsoleHostDomainZoneProps,
  ConsoleWidgetEntitlementProps,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  CircularProgress,
  Divider,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import { HOLDING_STATUSES } from '../model/registration'
import { BoughtDomainPanel } from './bought-domain-panel.component'
import {
  DomainsRequestError,
  formatMoney,
  useDomainsFetch,
  type DomainOfferView,
  type RegistrationsAnswer,
} from './domains-api'
import { PurchaseDialog } from './purchase-dialog.component'

/*
 * GET A DOMAIN, on the site's Custom Domain page (AGL-3962).
 *
 * For someone who has never bought a domain: type the business name, pick a
 * result whose price — this year AND every year after — is in front of them,
 * say who it is registered to, done. The site goes live at it with no DNS
 * step, because the name is bought in the account that hosts the site.
 *
 * Every reason the site cannot buy right now is said BEFORE the click
 * (AGL-3853): the plan, the billing permission, a domain already connected,
 * a payment not yet cleared. A deployment that sells no names draws nothing.
 */

/** Results shown before "Show more". */
const FIRST_RESULTS = 6
/** While a name is registering or connecting, the card re-reads this often. */
const POLL_MS = 5000

export type BuyDomainCardProps = ConsoleHostDomainZoneProps & ConsoleWidgetEntitlementProps

export default function BuyDomainCard(props: BuyDomainCardProps) {
  const { hostId, org, entitled, upgrade } = props
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<RegistrationsAnswer | null>(null)
  const [query, setQuery] = useState('')
  const [offers, setOffers] = useState<DomainOfferView[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [buying, setBuying] = useState<DomainOfferView | null>(null)
  const latestQuery = useRef('')

  const orgSlug = typeof org?.['slug'] === 'string' ? (org['slug'] as string) : ''
  const billingHref = orgSlug ? `/${orgSlug}/billing` : null

  const refresh = useCallback(async () => {
    if (entitled === false) return
    try {
      setState(
        await request<RegistrationsAnswer>(DOMAINS_API_ROUTES.registrations, {
          query: { hostId },
        }),
      )
    } catch {
      // A failed read leaves the card as it was; it is not news to show.
    }
  }, [entitled, hostId, request])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // While a name is on its way, follow it until it settles.
  const settling = state?.registrations.some(
    (registration) =>
      registration.status === 'charging' ||
      registration.status === 'registering' ||
      registration.status === 'connecting',
  )
  useEffect(() => {
    if (!settling) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [settling, refresh])

  // Search as they type, the last query winning.
  useEffect(() => {
    const value = query.trim()
    latestQuery.current = value
    setShowAll(false)
    if (value.length < 2) {
      setOffers(null)
      setSearchError(null)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const answer = await request<{ offers: DomainOfferView[] }>(DOMAINS_API_ROUTES.search, {
          query: { hostId, q: value },
        })
        if (latestQuery.current === value) setOffers(answer.offers)
      } catch (caught) {
        if (latestQuery.current === value) {
          setOffers(null)
          setSearchError(
            caught instanceof DomainsRequestError ? caught.message : 'Search isn’t answering right now.',
          )
        }
      } finally {
        if (latestQuery.current === value) setSearching(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [query, hostId, request])

  const help = pluginDocsHelp('buyADomain')

  // The plan does not include domains: say what would, and where.
  if (entitled === false) {
    return (
      <CardDisplay header="Get a domain" help={help} contentGutterX contentGutterY>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {'Give your site its own address, like yourbusiness.com. We register it to you and set it up, with nothing to configure.'}
          </Typography>
          <PrerequisiteNotice
            href={upgrade?.billingHref}
            actionLabel="See plans"
          >
            {'Domains can be bought on the Starter plan and above.'}
          </PrerequisiteNotice>
        </Stack>
      </CardDisplay>
    )
  }
  if (!state || !state.configured) return null

  const holding = state.registrations.filter((registration) =>
    HOLDING_STATUSES.includes(registration.status) || registration.status === 'expired',
  )
  if (holding.length) {
    return (
      <CardDisplay header="Your domain" help={help} contentGutterX contentGutterY>
        <Stack spacing={2} divider={<Divider flexItem />}>
          {holding.map((registration) => (
            <BoughtDomainPanel
              key={registration.domain}
              hostId={hostId}
              registration={registration}
              billingPermission={state.billingPermission}
              billingHref={billingHref}
              onChanged={() => void refresh()}
            />
          ))}
        </Stack>
      </CardDisplay>
    )
  }

  const blocked = !state.canBuy
  const blockedReason = state.refusal?.message ?? ''
  const visible = offers ? (showAll ? offers : offers.slice(0, FIRST_RESULTS)) : []

  return (
    <CardDisplay header="Get a domain" help={help} contentGutterX contentGutterY>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Search for a name for your site. We register it to you and connect it for you, so there are no DNS records to add.'}
        </Typography>
        {state.refusal ? (
          <PrerequisiteNotice
            href={
              state.refusal.code === 'no-payment-history' && billingHref ? billingHref : undefined
            }
            actionLabel="Open billing"
          >
            {state.refusal.message}
          </PrerequisiteNotice>
        ) : null}

        {state.unassigned.length ? (
          <Alert severity="info">
            <Stack spacing={1}>
              <span>{'Your workspace has domains that aren’t connected to a site:'}</span>
              {state.unassigned.map((registration) => (
                <Stack key={registration.domain} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <strong>{registration.domain}</strong>
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await request(DOMAINS_API_ROUTES.reconnect, {
                          body: { hostId, domain: registration.domain },
                        })
                        enqueueSnackbar(`${registration.domain} is connecting to this site`, {
                          variant: 'success',
                          persist: false,
                        })
                      } catch (caught) {
                        enqueueSnackbar((caught as Error).message, {
                          variant: 'error',
                          allowDuplicate: true,
                        })
                      } finally {
                        void refresh()
                      }
                    }}
                  >
                    {'Use for this site'}
                  </Button>
                </Stack>
              ))}
            </Stack>
          </Alert>
        ) : null}

        <TextField
          label="Search for a domain"
          placeholder="Your business name, or yourbusiness.com"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            input: {
              endAdornment: searching ? (
                <InputAdornment position="end">
                  <CircularProgress size={18} />
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        {searchError ? <Alert severity="warning">{searchError}</Alert> : null}
        {offers && offers.length === 0 && !searching ? (
          <Typography variant="body2" color="text.secondary">
            {'No names to offer for that. Try a shorter version of the name.'}
          </Typography>
        ) : null}
        {visible.length ? (
          <List disablePadding>
            {visible.map((offer) => (
              <ListItem
                key={offer.domain}
                divider
                disableGutters
                secondaryAction={
                  offer.available ? (
                    <BlockedControl blocked={blocked} reason={blockedReason}>
                      <Button variant="outlined" size="small" onClick={() => setBuying(offer)}>
                        {'Buy'}
                      </Button>
                    </BlockedControl>
                  ) : (
                    <Typography variant="body2" color="text.disabled">
                      {'Taken'}
                    </Typography>
                  )
                }
              >
                <ListItemText
                  primary={offer.domain}
                  slotProps={{
                    primary: { sx: { fontWeight: 600, color: offer.available ? undefined : 'text.disabled' } },
                  }}
                  secondary={offer.available ? priceLine(offer) : 'Someone already owns this name'}
                />
              </ListItem>
            ))}
          </List>
        ) : null}
        {offers && offers.length > FIRST_RESULTS && !showAll ? (
          <Button size="small" onClick={() => setShowAll(true)} sx={{ alignSelf: 'flex-start' }}>
            {`Show ${offers.length - FIRST_RESULTS} more`}
          </Button>
        ) : null}
      </Stack>

      <PurchaseDialog
        open={Boolean(buying)}
        hostId={hostId}
        offer={buying}
        defaults={state.contactDefaults}
        onClose={() => setBuying(null)}
        onBought={(registration) => {
          setBuying(null)
          setQuery('')
          enqueueSnackbar(
            registration.status === 'active'
              ? `${registration.domain} is yours and connected to your site`
              : `${registration.domain} is yours. We’re finishing the setup now.`,
            { variant: 'success', persist: false },
          )
          void refresh()
        }}
      />
    </CardDisplay>
  )
}

/** "$15.99 a year", or the first year and the renewal when they differ. */
export function priceLine(offer: DomainOfferView): string {
  if (offer.firstYearCents === offer.renewalCents) {
    return `${formatMoney(offer.firstYearCents)} a year`
  }
  return `${formatMoney(offer.firstYearCents)} the first year, then ${formatMoney(offer.renewalCents)} a year`
}
