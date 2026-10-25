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
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import { HOLDING_STATUSES, type DomainRegistrationView } from '../model/registration'
import { isOfferedName } from '../model/search-candidates'
import { BoughtDomainPanel } from './bought-domain-panel.component'
import { replacementSentence } from './connect-site-dialog.component'
import { DomainSearch } from './domain-search.component'
import {
  useDomainsFetch,
  type DomainOfferView,
  type RegistrationsAnswer,
} from './domains-api'
import { PurchaseDialog } from './purchase-dialog.component'

export { priceLine } from './domain-search.component'

/*
 * GET A DOMAIN, on the site's Custom Domain page (AGL-3962).
 *
 * For someone who has never bought a domain: type the business name, pick a
 * result whose price — this year AND every year after — is in front of them,
 * say who it is registered to, done. The site goes live at it with no DNS
 * step, because the name is bought in the account that hosts the site.
 *
 * A site that already has a domain can still buy one (AGL-4040): the new
 * name goes into the workspace, unassigned, and the card says so before the
 * click. The workspace's Domains page, one click away in the header, lists
 * every name the workspace holds and connects any of them to any site.
 *
 * Every reason the site cannot buy right now is said BEFORE the click
 * (AGL-3853): the plan, the billing permission, a payment not yet cleared.
 * A deployment that sells no names draws nothing.
 *
 * `?domain=<name>` arrives with the owner from Billing, where a staff-made
 * bundle link named the name they chose together (AGL-3955): the box opens
 * with it and searches it once, so its price is in front of them.
 */

/** While a name is registering or connecting, the card re-reads this often. */
const POLL_MS = 5000
/** The address's name for a domain to open the search with. */
export const PREFILL_DOMAIN_PARAM = 'domain'

/**
 * The `?domain=` the page was opened with, when it is a name this card can
 * sell; '' for anything else, which is ignored rather than searched.
 */
export function prefillDomainFrom(search: string): string {
  const value = String(new URLSearchParams(search).get(PREFILL_DOMAIN_PARAM) ?? '')
    .trim()
    .toLowerCase()
  return isOfferedName(value) ? value : ''
}

export type BuyDomainCardProps = ConsoleHostDomainZoneProps & ConsoleWidgetEntitlementProps

export default function BuyDomainCard(props: BuyDomainCardProps) {
  const { hostId, org, entitled, upgrade, connectedDomain } = props
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<RegistrationsAnswer | null>(null)
  const [buying, setBuying] = useState<DomainOfferView | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [using, setUsing] = useState<DomainRegistrationView | null>(null)
  const [usingBusy, setUsingBusy] = useState(false)
  // Read from the location in an effect rather than `useSearchParams`, which
  // would ask every page this zone sits on for a Suspense boundary.
  const [prefill, setPrefill] = useState('')
  useEffect(() => {
    setPrefill(prefillDomainFrom(window.location.search))
  }, [])

  const orgSlug = typeof org?.['slug'] === 'string' ? (org['slug'] as string) : ''
  const billingHref = orgSlug ? `/${orgSlug}/billing` : null
  const domainsHref = orgSlug ? `/${orgSlug}/domains` : null

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

  const help = pluginDocsHelp('buyADomain')
  const headerAction = domainsHref ? (
    <Button size="small" href={domainsHref}>
      {'All domains'}
    </Button>
  ) : undefined

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

  const holding = state.registrations.filter(managedHere)
  const intoWorkspace = state.buyTarget === 'workspace'
  const blocked = !state.canBuy
  const blockedReason = state.refusal?.message ?? ''
  const replacing = using && connectedDomain ? replacementSentence(using.domain, 'This site', connectedDomain) : null

  const connectHere = async (registration: DomainRegistrationView) => {
    setUsingBusy(true)
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
      setUsingBusy(false)
      setUsing(null)
      void refresh()
    }
  }

  return (
    <CardDisplay
      header={holding.length ? 'Your domain' : 'Get a domain'}
      help={help}
      contentGutterX
      contentGutterY
      HeaderProps={{ action: headerAction }}
    >
      <Stack spacing={2}>
        {holding.length ? (
          <Stack spacing={2} divider={<Divider flexItem />}>
            {holding.map((registration) => (
              <BoughtDomainPanel
                key={registration.domain}
                scope={{ hostId }}
                registration={registration}
                billingPermission={state.billingPermission}
                billingHref={billingHref}
                domainsHref={domainsHref}
                onChanged={() => void refresh()}
              />
            ))}
          </Stack>
        ) : null}
        {holding.length ? <Divider flexItem /> : null}
        {holding.length ? (
          <Typography variant="subtitle1" component="h3">
            {'Get another domain'}
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {intoWorkspace
            ? 'This site already has a domain, so a name you buy here goes into your workspace’s domains, not connected. Connect it to any site from the Domains page.'
            : 'Search for a name for your site. We register it to you and connect it for you, so there are no DNS records to add.'}
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
                    disabled={usingBusy}
                    onClick={() =>
                      connectedDomain && connectedDomain !== registration.domain
                        ? setUsing(registration)
                        : void connectHere(registration)
                    }
                  >
                    {'Use for this site'}
                  </Button>
                </Stack>
              ))}
            </Stack>
          </Alert>
        ) : null}

        <DomainSearch
          scope={{ hostId }}
          blocked={blocked}
          blockedReason={blockedReason}
          prefill={prefill}
          resetKey={resetKey}
          onBuy={setBuying}
        />
      </Stack>

      <PurchaseDialog
        open={Boolean(buying)}
        scope={{ hostId }}
        offer={buying}
        defaults={state.contactDefaults}
        intoWorkspace={intoWorkspace}
        onClose={() => setBuying(null)}
        onBought={(registration, workspace) => {
          setBuying(null)
          setResetKey((key) => key + 1)
          enqueueSnackbar(
            workspace
              ? `${registration.domain} is yours. It’s in your workspace’s domains.`
              : registration.status === 'active'
                ? `${registration.domain} is yours and connected to your site`
                : `${registration.domain} is yours. We’re finishing the setup now.`,
            { variant: 'success', persist: false },
          )
          void refresh()
        }}
      />

      <Dialog open={Boolean(using)} onClose={usingBusy ? undefined : () => setUsing(null)} fullWidth maxWidth="xs">
        <DialogTitle>{using ? `Use ${using.domain} for this site?` : ''}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{replacing}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUsing(null)} disabled={usingBusy}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={usingBusy}
            onClick={() => using && void connectHere(using)}
          >
            {connectedDomain ? `Replace ${connectedDomain}` : 'Connect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

/** A name the card manages: held, or lapsed. */
function managedHere(registration: DomainRegistrationView): boolean {
  return HOLDING_STATUSES.includes(registration.status) || registration.status === 'expired'
}
