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

import { ICON_VARIANT_ORGANIZATION } from '@aglyn/shared-data-enums'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import EmptyState from '../../../components/empty-state.component'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgScope } from '../../../hooks/use-org-scope'
import { useWorkspacePage } from '../../../hooks/use-workspace-page'
import { billingHrefFor, resolveBillingEntry } from '../../../utils/billing-entry'
import { readOutcome } from '../../../utils/read-outcome'

/**
 * The org-agnostic billing entry point (AGL-2430) — `/billing`.
 *
 * ## Why it exists
 *
 * Stripe's Dashboard lets an account replace the links in its subscription
 * emails ("Payment method updates"), and it takes ONE URL for every customer
 * in the account — there is nothing to interpolate an org slug into. Console
 * routing is org-scoped, so before this page the only pasteable URLs were the
 * marketing homepage (what is configured today) or a console root that drops
 * the customer on a workspace list with no mention of billing.
 *
 * The consequence of the current setting is not cosmetic. A card fails,
 * Stripe emails the customer, the link lands on `aglyn.com`, there is no way
 * to update the card from there, Stripe retries and eventually cancels the
 * subscription. This page is the destination that makes those emails safe to
 * point at us.
 *
 * ## Why the workspace comes from the session
 *
 * Because the URL cannot carry it. `useOrgScope` already holds the signed-in
 * account's memberships — the same list `(home)/page.tsx` jumps off — so the
 * resolution is a read this console was doing anyway.
 *
 * ## Four cases, and the one that is easy to get wrong
 *
 *  - **Not signed in** — handled ABOVE this component by the `(app)` group's
 *    `AuthenticatedLayout`, which pushes `/signin?continue=<this path>` and
 *    comes back HERE afterwards. That is why this page lives inside `(app)`
 *    rather than at the app root: a bespoke redirect would have had to
 *    reinvent the return target, and the failure mode of getting it wrong is
 *    silent — the customer signs in and lands on a dashboard, which is
 *    exactly the dead end this page exists to remove.
 *  - **One workspace** — straight through, no interstitial.
 *  - **Several** — a picker. We cannot know which card failed from a static
 *    URL, and guessing would send a customer to the wrong ledger.
 *  - **None** — say so. Not a workspace list, not a spinner.
 *
 * ## What is deliberately absent
 *
 * No suspension filter, no plan gate, no entitlement check. A workspace
 * locked for non-payment is the single most likely arrival here, and hiding
 * its billing page would make the lock a deadlock. See `utils/billing-entry`.
 */
function BillingEntry() {
  const {
    orgs,
    loading,
    confirmed,
    hasMoreOrgs,
    loadMoreOrgs,
    error: orgsError,
    retry: retryOrgs,
  } = useOrgScope()
  const router = useRouter()
  const orgsRead = readOutcome({ ready: !loading, error: orgsError })
  const destination = useMemo(() => resolveBillingEntry(orgs), [orgs])

  /**
   * Gated on `confirmed`, not merely `loading` — the AGL-1149 lesson the org
   * jump page learned the hard way. The console runs a persistent multi-tab
   * Firestore cache and `loading` goes false on the FIRST snapshot, which is
   * the cached one; an account that has since joined a second workspace would
   * be redirected into their old one before the server snapshot lands. A
   * redirect is not a render you can correct a beat later.
   *
   * `orgsError` holds too: an errored membership listen says nothing about
   * what workspaces exist (AGL-1260), and redirecting off a denied read is
   * how you tell a paying customer they have no workspace.
   */
  useEffect(() => {
    if (loading || !confirmed || orgsError) return void 0
    if (destination.kind !== 'billing') return void 0
    router.replace(destination.href)
  }, [loading, confirmed, orgsError, destination, router])

  /** Only ever read in the `choose` render; empty everywhere else. */
  const choices = destination.kind === 'choose' ? destination.orgs : []
  // Paged on the console's own footer (AGL-2501), like the workspace picker
  // at the console root — the same list, and now the same control.
  const {
    visible: visibleChoices,
    page: choicePage,
    setPage: setChoicePage,
    pageSize: choicePageSize,
    hasMore: hasMoreChoicePages,
  } = useWorkspacePage(choices, {
    hasMoreRows: hasMoreOrgs,
    loadMoreRows: loadMoreOrgs,
  })
  /**
   * Four renders, decided in this order — and the order is the correctness.
   *
   *  - a failed read outranks everything, because every statement below it
   *    would be a claim about an account we could not read (AGL-1066);
   *  - an unconfirmed list is a SPINNER, not a picker: `resolveBillingEntry`
   *    has an answer for the cached snapshot and it is not one this page may
   *    act on OR show;
   *  - a resolved single workspace is also a spinner, because the redirect
   *    above is already in flight;
   *  - only then is the picker or the zero-state a true thing to render.
   */
  const view: 'degraded' | 'resolving' | 'no-workspace' | 'choose' = orgsError
    ? 'degraded'
    : loading || !confirmed || destination.kind === 'billing'
      ? 'resolving'
      : destination.kind === 'no-workspace'
        ? 'no-workspace'
        : 'choose'

  return (
    <DashboardLayout
      disableDefaultBreadcrumb
      // `#payments` and not the bare topic (which the org-scoped billing page
      // already owns): the reader who lands here followed a payment problem,
      // so the heading about payment methods and failed payments is the one
      // they are standing in front of.
      help={{ topic: 'billing', anchor: '#payments' }}
      breadcrumbItems={[{ children: 'Billing' }]}
      header={{
        children: 'Billing',
        icon: { path: ICON_VARIANT_ORGANIZATION.path },
      }}
    >
      {view === 'resolving' ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {view !== 'choose' ? (
            <EmptyState
              read={orgsRead}
              subject="your workspaces"
              onRetry={retryOrgs}
              iconPath={ICON_VARIANT_ORGANIZATION.path}
              title={'No workspace to bill'}
              description={
                'This account is not a member of any workspace, so there is ' +
                'nothing to pay for yet. If you were expecting a bill, you ' +
                'may have signed in with a different email address than the ' +
                'one the invoice was sent to.'
              }
              action={
                // The console root is the workspace jump page and has no
                // `Route` entry — it is the one path with no template to
                // build. A literal `/` here, never a bare MUI `href`.
                <AppLink componentVariant="button" variant="contained" href="/">
                  {'Go to your console'}
                </AppLink>
              }
            />
          ) : (
            <Stack spacing={3}>
              <Box>
                <Typography variant="h6" component="h1">
                  {'Choose a workspace'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {'You manage billing for several organizations — pick the ' +
                    'one you want to update.'}
                </Typography>
              </Box>
              <GridItems
                spacing={3}
                items={visibleChoices.map((org) => ({
                  size: { xs: 12, sm: 6, md: 4 },
                  children: (
                    <CardDisplay
                      contentGutterX
                      contentGutterY
                      HeaderProps={{
                        avatar: (
                          <MdiIcon
                            color="primary"
                            fontSize="large"
                            path={ICON_VARIANT_ORGANIZATION.path}
                          />
                        ),
                      }}
                      header={org.orgName ?? org.slug ?? org.$id}
                      subheader={org.slug}
                      actions={
                        <AppLink
                          componentVariant="button"
                          variant="contained"
                          href={billingHrefFor(org.slug as string)}
                        >
                          {'Billing'}
                        </AppLink>
                      }
                    >
                      <Typography variant="body2" color="text.secondary">
                        {'Payment method, plan, invoices and usage for this ' +
                          'organization.'}
                      </Typography>
                    </CardDisplay>
                  ),
                }))}
              />
              {/* The membership list is a WINDOW, not the whole truth
                  (AGL-2336): an agency past the page size would otherwise see
                  a complete-looking picker missing the workspace they came to
                  pay for. The footer says which part of it is on screen. */}
              <ListPagination
                page={choicePage}
                pageSize={choicePageSize}
                rowCount={visibleChoices.length}
                hasMore={hasMoreChoicePages}
                onPageChange={setChoicePage}
                labelDisplayedRows={({ from, to, count }) =>
                  `${from}–${to} of ${count === -1 ? 'more than ' + to : count} workspaces`
                }
              />
            </Stack>
          )}
        </Container>
      )}
    </DashboardLayout>
  )
}

export default BillingEntry
BillingEntry.displayName = 'Page:BillingEntry'
