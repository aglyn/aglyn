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
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import BillingOpenInvoicesCardComponent from '../../../../../../components/billing/billing-open-invoices-card.component'
import { docsHelp } from '../../../../../../constants/docs-links'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'
import { stripeOtherModeInvoiceNotice } from '../../../../../../utils/stripe-mode-notice'

/**
 * What is owed, and what has already been paid.
 *
 * ## Outstanding appears here AND on Plan, deliberately
 *
 * A customer arriving from a dunning email is signed out, lands on the
 * org-agnostic entry, and is dropped on the billing landing — which is Plan.
 * Making them find a tab called Invoices before they can pay is exactly the
 * hunting this split is supposed to remove. So the card is on both, and that
 * duplication is a decision rather than an oversight.
 *
 * It is safe to duplicate because the card holds no state worth desynchronising
 * and the route refuses a second payment: `pay` re-reads the invoice from
 * Stripe and answers `alreadyPaid` if it has been settled, whichever copy the
 * button was pressed on.
 */
const BillingInvoicesSection: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { orgId } = useCurrentOrg()
  const { can, loaded: permissionsLoaded } = useOrgPermissions()

  // Invoice history (AGL-248, AGL-534), billing.view-gated server-side.
  // Cursor-paginated; "Load more" appends older invoices.
  const [invoices, setInvoices] = useState<Array<{
    id: string
    number: string | null
    status: string | null
    amountDueCents: number
    totalCents: number
    currency: string
    created: string | null
    paidAt: string | null
    periodEnd: string | null
    hostedInvoiceUrl: string | null
    invoicePdf: string | null
    receiptUrl: string | null
  }> | null>(null)
  const [invoicesHasMore, setInvoicesHasMore] = useState(false)
  const [invoiceCursor, setInvoiceCursor] = useState<string | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  /**
   * This deployment's Stripe mode, but ONLY when it is the reason the list is
   * empty (AGL-2486). `null` means the empty list is a real observation.
   */
  const [invoicesOtherMode, setInvoicesOtherMode] = useState<
    'live' | 'test' | null
  >(null)
  const fetchInvoices = useCallback(
    async (cursor?: string | null) => {
      if (!orgId || !user) return
      setInvoicesLoading(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/billing/invoices?orgId=${encodeURIComponent(orgId)}` +
            (cursor ? `&startingAfter=${encodeURIComponent(cursor)}` : ''),
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        if (!response.ok) return
        const payload = await response.json()
        setInvoices((previous) =>
          cursor
            ? [...(previous ?? []), ...(payload.invoices ?? [])]
            : (payload.invoices ?? []),
        )
        setInvoicesHasMore(payload.hasMore === true)
        setInvoiceCursor(payload.nextCursor ?? null)
        // Only the route can know this — the browser has no idea which Stripe
        // key the server holds. Strict `=== true` so an older cached response
        // that predates the field reads as "a real empty list", not as a
        // mode problem.
        setInvoicesOtherMode(
          payload.otherModeOnly === true
            ? payload.deploymentMode === 'live'
              ? 'live'
              : 'test'
            : null,
        )
      } catch {
        // The card keeps its current state on failure.
      } finally {
        setInvoicesLoading(false)
      }
    },
    [orgId, user],
  )
  useEffect(() => {
    // `!permissionsLoaded ||`, never `permissionsLoaded && !can(…)`. Written
    // the second way this fires DURING the permission read: `can()` fails open
    // to an owner's map while `loaded` is false, so the guard could only refuse
    // once the answer was already in — which is exactly when it is no longer
    // needed. The route 403s a reader without `billing.view`, so this was not
    // the leak; it is the same mistake one layer down, and asking a question
    // you are not yet entitled to ask is how a fail-open on the other side
    // becomes a real one.
    if (!orgId || !user || !permissionsLoaded || !can('billing.view')) return
    void fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, user, permissionsLoaded])

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={'Outstanding'}
        subheader={'Anything unpaid, and the button that settles it.'}
        help={docsHelp('billing', {
          anchor: '#outstanding',
          excerpt:
            'Paying an invoice that failed, including when the subscription has already been cancelled.',
        })}
        contentGutterX
        contentGutterY
      >
        <BillingOpenInvoicesCardComponent
          orgId={orgId}
          canManage={can('billing.manage')}
        />
      </CardDisplay>
      <CardDisplay
                          header={'Billing history'}
                          help={docsHelp('billing', {
                            anchor: '#payments',
                            excerpt:
                              'Invoices from Stripe with status and amounts, plus ' +
                              'links to the hosted invoice, PDF, and receipt.',
                          })}
                          contentGutterX
                          contentGutterY
                        >
                          {invoices === null ? (
                            <Typography variant="body2" color="text.secondary">
                              {'Invoices appear here once billing is configured.'}
                            </Typography>
                          ) : invoices.length === 0 ? (
                            // An empty list has two meanings and they are not
                            // interchangeable (AGL-2486): never billed, or
                            // billed in the Stripe mode this deployment cannot
                            // read. Only the second one gets an Alert.
                            invoicesOtherMode ? (
                              <Alert severity="info">
                                {stripeOtherModeInvoiceNotice(invoicesOtherMode)}
                              </Alert>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                {'No invoices yet.'}
                              </Typography>
                            )
                          ) : (
                            <>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>{'Invoice'}</TableCell>
                                    <TableCell>{'Date'}</TableCell>
                                    <TableCell>{'Status'}</TableCell>
                                    <TableCell>{'Amount'}</TableCell>
                                    <TableCell align="right">{'Documents'}</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {invoices.map((invoice) => (
                                    <TableRow key={invoice.id}>
                                      <TableCell>
                                        {invoice.number ?? invoice.id}
                                      </TableCell>
                                      <TableCell>
                                        {invoice.created
                                          ? new Date(
                                              invoice.created,
                                            ).toLocaleDateString()
                                          : '—'}
                                      </TableCell>
                                      <TableCell>
                                        <Chip
                                          label={invoice.status ?? '—'}
                                          size="small"
                                          variant="outlined"
                                          color={
                                            invoice.status === 'paid'
                                              ? 'success'
                                              : invoice.status === 'open'
                                                ? 'warning'
                                                : 'default'
                                          }
                                        />
                                      </TableCell>
                                      <TableCell>
                                        {`$${(invoice.totalCents / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`}
                                      </TableCell>
                                      <TableCell align="right">
                                        <Stack
                                          direction="row"
                                          spacing={1.5}
                                          sx={{ justifyContent: 'flex-end' }}
                                        >
                                          {invoice.hostedInvoiceUrl ? (
                                            <Link
                                              href={invoice.hostedInvoiceUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              variant="body2"
                                            >
                                              {'View'}
                                            </Link>
                                          ) : null}
                                          {invoice.invoicePdf ? (
                                            <Link
                                              href={invoice.invoicePdf}
                                              variant="body2"
                                            >
                                              {'PDF'}
                                            </Link>
                                          ) : null}
                                          {invoice.receiptUrl ? (
                                            <Link
                                              href={invoice.receiptUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              variant="body2"
                                            >
                                              {'Receipt'}
                                            </Link>
                                          ) : null}
                                        </Stack>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                              {invoicesHasMore ? (
                                <Box sx={{ textAlign: 'center', mt: 1 }}>
                                  <Button
                                    size="small"
                                    color="primary"
                                    disabled={invoicesLoading}
                                    onClick={() => void fetchInvoices(invoiceCursor)}
                                  >
                                    {invoicesLoading
                                      ? 'Loading…'
                                      : 'Load older invoices'}
                                  </Button>
                                </Box>
                              ) : null}
                            </>
                          )}
                        </CardDisplay>
    </Stack>
  )
}
BillingInvoicesSection.displayName = 'Page:BillingInvoices'

export default BillingInvoicesSection
