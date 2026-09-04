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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

export interface StorefrontTaxSummaryCardProps {
  hostId: string
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

interface Jurisdiction {
  transactionCount: number
  totalSalesCents: number
  taxableSalesCents: number
  taxCollectedCents: number
}

interface Bucket {
  transactionCount: number
  grossCents: number
  taxableSalesCents: number
  taxCollectedCents: number
  byJurisdiction: Record<string, Jurisdiction>
}

interface Summary {
  periodStart: string
  periodEnd: string
  transactionCount: number
  aglynLiable: Bucket
  merchantManual: Bucket
  connectedAccountLiable: Bucket
  attention: {
    rowsMissingTaxableBase: number
    rowsMissingAddress: number
    nonUsdRows: number
    rowsMissingPaidAt: number
    rowsUnclassified: number
  }
}

interface Payload {
  summary: Summary
  truncated: boolean
  undatedRows: number
  caveats: { refundsNotReflected: boolean }
}

/** The last twelve calendar months, newest first, as UTC month bounds. */
function monthOptions(): Array<{ value: string; label: string; from: string; to: string }> {
  const now = new Date()
  return Array.from({ length: 12 }, (_item, index) => {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1),
    )
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index + 1, 1),
    )
    return {
      value: start.toISOString(),
      label: start.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      from: start.toISOString(),
      to: end.toISOString(),
    }
  })
}

/**
 * The sales tax this merchant's own storefront collected (AGL-2440).
 *
 * `storefrontTaxCollected` has recorded every taxed storefront sale since
 * AGL-1904 and every reader of it was Aglyn's — the staff tax return, the DSAR
 * export. The merchant, whose sales these are, could see one order's
 * `totals.taxCents` at a time and nothing else. This card is that absence
 * closed, and closing it is all it does.
 *
 * ## THE NUMBER, NOT THE LABEL
 *
 * This card presents the buckets SEPARATELY and prints no per-row verdict on
 * who must remit which one.
 *
 * The copy may not say that Aglyn makes no determination: Aglyn IS a
 * marketplace facilitator for storefront sales and the Terms publish that at
 * §10.7 (AGL-1956), so such a line would contradict the company's own
 * contract.
 *
 * Separate buckets and no per-row verdict still hold, because §10.7 is
 * narrow: it binds Aglyn only where applicable law gives it a collection
 * obligation for the transaction in question, which is a per-sale,
 * per-jurisdiction test and not a fact about a merchant. So the copy still
 * describes HOW each figure was computed — who calculated the rate, and
 * against whose registration — and adds only what §10.7 itself says about the
 * bucket Aglyn holds. There is still no "yours to remit" column and no total
 * across the buckets. A merged "tax collected" figure would be the
 * banned determination wearing a neutral name: it would sum tax Aglyn holds
 * and remits with tax the merchant owes, the exact conflation the module warns
 * about in bold — *the two store modes are DIFFERENT FACTS and must never be
 * summed*. That is why the three groups never share a total row, and why the
 * grand total in the header is a TRANSACTION COUNT rather than an amount.
 *
 * ## Why the caveats are on the card and not in a tooltip
 *
 * Both are properties of the DATA, not of the law, and both change what a
 * merchant should do with the number: refunds are not yet reflected, so the
 * figure over-states whenever they have refunded; and a row whose taxable base
 * Stripe did not state is counted out loud rather than treated as a zero-base
 * sale. A figure someone may file from cannot carry its completeness caveats
 * behind a hover.
 *
 * ## Why it is route-backed and not a listener
 *
 * `storefrontTaxCollected` is denied to every client in the rules — the
 * collection spans every merchant and a row carries a shopper's address. The
 * server route applies the `hostId` boundary. Nothing here can read another
 * merchant's sales because nothing here reads the collection at all.
 */
export function StorefrontTaxSummaryCard(props: StorefrontTaxSummaryCardProps) {
  const { hostId } = props
  const { data: user } = useUser()
  const months = useMemo(() => monthOptions(), [])
  const [period, setPeriod] = useState(months[0].value)
  const [payload, setPayload] = useState<Payload | null>(null)
  /**
   * Three outcomes, not two (the AGL-1380 rule). "No tax collected" is a claim
   * about this merchant's sales; rendering it because a request FAILED would
   * tell a merchant who collected tax that they collected none — on the one
   * surface where that mistake could reach a filing.
   */
  const [loadState, setLoadState] = useState<'pending' | 'error' | 'loaded'>(
    'pending',
  )
  const [retryNonce, setRetryNonce] = useState(0)

  const selected = months.find((month) => month.value === period) ?? months[0]

  const load = useCallback(async () => {
    const search = new URLSearchParams({
      hostId,
      from: selected.from,
      to: selected.to,
    })
    const response = await authorizedFetch(
      user,
      `/api/hosts/tax-summary?${search.toString()}`,
    )
    if (!response.ok) throw new Error('tax summary failed')
    return (await response.json()) as Payload
  }, [user, hostId, selected.from, selected.to])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadState('pending')
    load()
      .then((next) => {
        if (cancelled) return
        setPayload(next)
        setLoadState('loaded')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [load, user, retryNonce])

  const groups = payload
    ? ([
        {
          key: 'aglynLiable',
          bucket: payload.summary.aglynLiable,
          title: `Tax Stripe calculated against ${PLATFORM_BRAND_NAME}’s registrations`,
          how:
            'Automatic tax was on for these sales. Stripe computed the rate ' +
            `against the tax registrations on ${PLATFORM_BRAND_NAME}’s platform ` +
            `account, and ${PLATFORM_BRAND_NAME} holds what was collected.`,
        },
        {
          key: 'merchantManual',
          bucket: payload.summary.merchantManual,
          title: 'Tax your store calculated at your own rate',
          how:
            'Automatic tax was off for these sales. The rate came from the ' +
            'tax settings you configured on this store, applied to your own ' +
            'declared origin.',
        },
        {
          key: 'connectedAccountLiable',
          bucket: payload.summary.connectedAccountLiable,
          title: 'Tax Stripe calculated against your connected account',
          how:
            'Automatic tax was on and Stripe named your connected account ' +
            'as the liable party for these sales.',
        },
      ] as const)
    : []

  return (
    <CardDisplay
      header={'Storefront sales tax'}
      subheader={'What your storefront collected, grouped by how it was calculated.'}
      help={pluginDocsHelp('commerce', {
        anchor: '#storefront-sales-tax',
        excerpt:
          'What your storefront collected in sales tax, grouped by how each ' +
          `figure was calculated. ${PLATFORM_BRAND_NAME} does not provide tax advice.`,
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <TextField
          select
          size="small"
          label="Period"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          sx={{ maxWidth: '16rem' }}
        >
          {months.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>

        {loadState === 'pending' ? (
          <Typography variant="body2" color="text.secondary">
            Loading your sales tax…
          </Typography>
        ) : loadState === 'error' || !payload ? (
          <Alert
            severity="warning"
            action={
              <Button
                size="small"
                color="inherit"
                onClick={() => setRetryNonce((nonce) => nonce + 1)}
              >
                Retry
              </Button>
            }
          >
            We couldn’t load your sales tax for this period. This figure is
            blank because the request failed, not because no tax was collected.
          </Alert>
        ) : (
          <>
            {/*
              THE NON-ADVISORY NOTE, first and unmissable. Rendered ABOVE the
              numbers because it governs how all of them should be read.

              It now states the position Terms §10.7 publishes (AGL-1956)
              instead of the sentence it used to carry — "Aglyn does not make
              that determination for you" — which the Terms themselves have
              contradicted since 2026-08-24. What it still does NOT do is
              reach a per-merchant or per-jurisdiction verdict: §10.7 binds
              Aglyn only where applicable law gives it an obligation, so the
              note describes which bucket Aglyn holds and remits and leaves
              the rest where the merchant's own rate put it.
            */}
            <Alert severity="info">
              These figures show what was collected and how each was
              calculated. For storefront sales {PLATFORM_BRAND_NAME} acts as a
              marketplace facilitator: where applicable law gives{' '}
              {PLATFORM_BRAND_NAME} a collection obligation, the tax it
              calculated is added on top at checkout, held by{' '}
              {PLATFORM_BRAND_NAME} rather than transferred to your connected
              payment account, and remitted by {PLATFORM_BRAND_NAME}. Tax
              calculated at a rate you configured yourself stays yours. See
              Terms of Service §10.7.{' '}
              <strong>
                {PLATFORM_BRAND_NAME} does not provide tax advice.
              </strong>{' '}
              Please confirm your obligations with a qualified tax
              professional.
            </Alert>

            <Typography variant="body2" color="text.secondary">
              {`${payload.summary.transactionCount} taxed ${
                payload.summary.transactionCount === 1 ? 'sale' : 'sales'
              } in this period.`}
            </Typography>

            {payload.summary.transactionCount === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No storefront sale carried tax in this period.
              </Typography>
            ) : null}

            {groups
              .filter((group) => group.bucket.transactionCount > 0)
              .map((group) => (
                <Box key={group.key}>
                  <Divider sx={{ mb: 1.5 }} />
                  <Typography variant="subtitle2">{group.title}</Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                    sx={{ mb: 1 }}
                  >
                    {group.how}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={3}
                    sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}
                  >
                    <Box>
                      <Typography variant="h6">
                        {usd(group.bucket.taxCollectedCents)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        tax collected
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h6">
                        {usd(group.bucket.grossCents)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        gross, tax included
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h6">
                        {group.bucket.transactionCount}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {group.bucket.transactionCount === 1
                          ? 'sale'
                          : 'sales'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{'Jurisdiction'}</TableCell>
                        <TableCell align="right">{'Sales'}</TableCell>
                        <TableCell align="right">{'Taxable base'}</TableCell>
                        <TableCell align="right">{'Tax'}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(
                        group.bucket.byJurisdiction as Record<
                          string,
                          Jurisdiction
                        >,
                      ).map(([code, jurisdiction]) => (
                          <TableRow key={code}>
                            <TableCell>
                              {code === 'unknown' ? 'Not stated' : code}
                            </TableCell>
                            <TableCell align="right">
                              {usd(jurisdiction.totalSalesCents)}
                            </TableCell>
                            <TableCell align="right">
                              {usd(jurisdiction.taxableSalesCents)}
                            </TableCell>
                            <TableCell align="right">
                              {usd(jurisdiction.taxCollectedCents)}
                            </TableCell>
                          </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ))}

            {/*
              WHAT THE NUMBER DOES NOT YET INCLUDE. Facts about the data, on
              the card rather than behind a hover, because each one changes
              what a merchant should do with the figure.
            */}
            <Divider />
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                {'Refunds are not reflected. A refunded sale keeps its full ' +
                  'tax here, so these figures over-state whenever you have ' +
                  'refunded in this period.'}
              </Typography>
              {payload.summary.attention.rowsMissingTaxableBase > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`${payload.summary.attention.rowsMissingTaxableBase} sale(s) collected tax but Stripe did not state the amount the rate was applied to. Their tax is counted; their taxable base is not, so “Taxable base” above is understated.`}
                </Typography>
              ) : null}
              {payload.summary.attention.rowsMissingAddress > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`${payload.summary.attention.rowsMissingAddress} sale(s) carried no customer address and are grouped under “Not stated”.`}
                </Typography>
              ) : null}
              {payload.summary.attention.nonUsdRows > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`${payload.summary.attention.nonUsdRows} sale(s) were in a currency other than USD and are summed here without conversion.`}
                </Typography>
              ) : null}
              {payload.summary.attention.rowsUnclassified > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`${payload.summary.attention.rowsUnclassified} sale(s) could not be classified and are excluded from every group above rather than guessed into one.`}
                </Typography>
              ) : null}
              {payload.undatedRows > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`${payload.undatedRows} recorded sale(s) carry no payment date and fall outside every period, including this one.`}
                </Typography>
              ) : null}
              {payload.truncated ? (
                <Typography variant="caption" color="warning.main">
                  {'This period has more sales than one report can read. The ' +
                    'figures above are PARTIAL — narrow the period.'}
                </Typography>
              ) : null}
            </Stack>
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
StorefrontTaxSummaryCard.displayName = 'StorefrontTaxSummaryCard'

export default StorefrontTaxSummaryCard
