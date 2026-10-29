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

import * as Aglyn from '@aglyn/aglyn'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { StripeCheckoutContact } from '@stripe/stripe-js'
import { forwardRef, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  formatOrderMoney,
  readStorefrontCheckoutWallets,
  type QuotePageAddress,
  type QuotePageView,
  type StorefrontCheckoutWallets,
} from '../model'
import type { QuotePageProps } from './quote-page'
import { StorefrontPaymentElementFallback } from './storefront-payment-element-fallback'

/** The Payment Element, lazily: Stripe.js loads only when a customer presses Pay. */
const StorefrontPaymentElement = lazy(() =>
  import('./storefront-payment-element').then((module) => ({
    default: module.StorefrontPaymentElement,
  })),
)

type LoadState =
  | { kind: 'loading' }
  | { kind: 'missing'; message: string }
  | { kind: 'replaced'; storeName: string }
  | { kind: 'ready'; view: QuotePageView }

/** After a payment returns here, how often and how long the page asks whether it landed. */
const CONFIRM_POLL_MS = 2_000
const CONFIRM_POLLS = 15

function dateLabel(atMs: number | null): string {
  if (!atMs) return ''
  return new Date(atMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function addressLines(address: QuotePageAddress): string[] {
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [address.name, address.line1, address.line2, cityLine, address.country].filter(
    (line): line is string => Boolean(line),
  )
}

function stripeContact(address: QuotePageAddress | null): StripeCheckoutContact | undefined {
  if (!address?.country) return undefined
  return {
    name: address.name,
    address: {
      country: address.country,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postal_code: address.postalCode,
    },
  }
}

function AddressBlock({ label, lines }: { label: string; lines: string[] }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      {lines.map((line, index) => (
        <Typography key={index} variant="body2">
          {line}
        </Typography>
      ))}
    </Stack>
  )
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
      <Typography variant={strong ? 'subtitle1' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle1' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {value}
      </Typography>
    </Stack>
  )
}

/**
 * The customer's quote page (AGL-4094), loaded when the page draws it (see
 * `quote-page.tsx`): what a customer sees when they open
 * the pay link a business sent them. The commerce page resolver serves it at
 * `/pay-quote` inside the site's own header and footer; a business can also
 * place it on a page of their own design at that address.
 *
 * The quote is read AFTER hydration from `?q=&t=`, so the page itself is the
 * same for every customer and may be cached, and the quote never is. Pay asks
 * the server for a fresh payment for the quote as the page shows it: Stripe's
 * own page, or the payment form here when in-page payments are on. Nothing
 * here decides a quote is paid; after paying, the page reads that from the
 * server like any other visit.
 */
const QuotePageBody = forwardRef<HTMLDivElement, QuotePageProps>((props, ref) => {
  const { heading, ...rest } = props
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { hostId } = Aglyn.useSite()
  const siteFetch = Aglyn.useSiteFetch()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  const [nativeCheckout, setNativeCheckout] = useState<{
    clientSecret: string
    publishableKey: string
    wallets?: StorefrontCheckoutWallets
  } | null>(null)
  /** What a return from paying turned out to be: still being confirmed, or not paid. */
  const [returned, setReturned] = useState<'confirming' | 'unconfirmed' | 'failed' | null>(null)
  const link = useRef({ quoteId: '', token: '', sessionId: '' })

  const load = useCallback(async (): Promise<LoadState> => {
    const { quoteId, token } = link.current
    try {
      const response = await siteFetch(
        `/api/commerce/quote-view?hostId=${encodeURIComponent(hostId ?? '')}` +
          `&q=${encodeURIComponent(quoteId)}&t=${encodeURIComponent(token)}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return { kind: 'missing', message: String(payload?.error ?? 'We could not find that quote.') }
      }
      if (payload?.state === 'replaced') return { kind: 'replaced', storeName: String(payload.storeName ?? '') }
      return { kind: 'ready', view: payload as QuotePageView }
    } catch {
      return { kind: 'missing', message: 'This quote could not be loaded. Check your connection and try again.' }
    }
  }, [hostId, siteFetch])

  useEffect(() => {
    if (!hostId) return
    const params = new URLSearchParams(window.location.search)
    link.current = {
      quoteId: params.get('q') ?? '',
      token: params.get('t') ?? '',
      sessionId: params.get('session_id') ?? '',
    }
    if (!link.current.quoteId || !link.current.token) {
      setState({ kind: 'missing', message: 'Open this page from the link you were sent with your quote.' })
      return
    }
    let live = true
    void (async () => {
      const first = await load()
      if (!live) return
      setState(first)
      const sessionId = link.current.sessionId
      if (first.kind !== 'ready' || first.view.status !== 'unpaid' || !sessionId) return
      // Back from paying: the payment may have landed before the record of it.
      const status = await siteFetch(
        `/api/commerce/checkout-status?hostId=${encodeURIComponent(hostId)}` +
          `&sessionId=${encodeURIComponent(sessionId)}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)
      if (!live) return
      if (status?.status === 'open') {
        setReturned('failed')
        return
      }
      if (status?.status !== 'complete') return
      setReturned('confirming')
      for (let poll = 0; poll < CONFIRM_POLLS && live; poll++) {
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS))
        if (!live) return
        const next = await load()
        if (!live) return
        if (next.kind === 'ready' && next.view.status !== 'unpaid') {
          setState(next)
          setReturned(null)
          return
        }
      }
      if (live) setReturned('unconfirmed')
    })()
    return () => {
      live = false
    }
  }, [hostId, load, siteFetch])

  const view = state.kind === 'ready' ? state.view : null

  const pay = useCallback(async () => {
    if (!view || paying) return
    setPaying(true)
    setPayError('')
    setReturned(null)
    // One key per press: a press is one attempt, and a retry after a failure is a new one.
    const attemptKey =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      const response = await siteFetch('/api/commerce/quote-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptKey },
        body: JSON.stringify({
          hostId,
          q: link.current.quoteId,
          t: link.current.token,
          v: view.version,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      // A session with a client secret is the in-page form; checked before the
      // redirect, so a form is never navigated away from.
      if (response.ok && payload?.clientSecret && payload?.publishableKey) {
        setNativeCheckout({
          clientSecret: String(payload.clientSecret),
          publishableKey: String(payload.publishableKey),
          wallets: readStorefrontCheckoutWallets(payload.wallets),
        })
        setPaying(false)
        return
      }
      if (response.ok && payload?.url) {
        window.location.assign(String(payload.url))
        return
      }
      if (payload?.replaced) {
        setState({ kind: 'replaced', storeName: view.storeName })
        return
      }
      if (payload?.reason === 'paid' || payload?.reason === 'updated') {
        const next = await load()
        setState(next)
      }
      setPayError(String(payload?.error ?? 'Your payment could not be set up. Try again.'))
      setPaying(false)
    } catch {
      setPayError('Your payment could not be set up. Check your connection and try again.')
      setPaying(false)
    }
  }, [view, paying, siteFetch, hostId, load])

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[{ p: 3, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }, ...nodeSx]}
      >
        <Typography variant="body2" color="text.secondary">
          {'Quote — a customer’s quote and its Pay button render here'}
        </Typography>
      </Box>
    )
  }

  if (state.kind === 'loading') {
    return (
      <Box ref={ref} {...rest} sx={[{ py: 6, textAlign: 'center' }, ...nodeSx]}>
        <CircularProgress size={28} aria-label="Loading your quote" />
      </Box>
    )
  }

  if (state.kind === 'missing') {
    return (
      <Box ref={ref} {...rest} sx={nodeSx}>
        <Stack spacing={2}>
          <Typography variant="h4" component="h1">
            {heading || 'Your quote'}
          </Typography>
          <Alert severity="info">{state.message}</Alert>
        </Stack>
      </Box>
    )
  }

  if (state.kind === 'replaced') {
    const business = state.storeName || 'The business'
    return (
      <Box ref={ref} {...rest} sx={nodeSx}>
        <Stack spacing={2}>
          {state.storeName ? (
            <Typography variant="overline" color="text.secondary">
              {state.storeName}
            </Typography>
          ) : null}
          <Typography variant="h4" component="h1">
            {'This quote was updated'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {`${business} updated this quote and sent you a newer link. Open their most recent message to see it.`}
          </Typography>
        </Stack>
      </Box>
    )
  }

  const quote = state.view
  const money = (cents: number) => formatOrderMoney(cents, quote.currency)
  // The same signed link as the page's data; the server makes the PDF from the same view.
  const pdfHref =
    `/api/commerce/quote-pdf?hostId=${encodeURIComponent(hostId)}` +
    `&q=${encodeURIComponent(link.current.quoteId)}&t=${encodeURIComponent(link.current.token)}`
  const unpaid = quote.status === 'unpaid'
  const addresses = [
    quote.customerName || quote.company
      ? { label: 'Prepared for', lines: [quote.customerName, quote.company].filter((line): line is string => Boolean(line)) }
      : null,
    quote.billTo ? { label: 'Bill to', lines: addressLines(quote.billTo) } : null,
    quote.shipTo ? { label: 'Ship to', lines: addressLines(quote.shipTo) } : null,
  ].filter((block): block is { label: string; lines: string[] } => Boolean(block && block.lines.length))
  const totalRows = (
    [
      ['Subtotal', money(quote.totals.itemsCents), true],
      [
        quote.discountLabel ? `Discount (${quote.discountLabel})` : 'Discount',
        `−${money(quote.totals.discountCents)}`,
        quote.totals.discountCents > 0,
      ],
      ['Shipping', money(quote.totals.shippingCents), quote.totals.shippingCents > 0],
      [quote.taxLabel, money(quote.totals.taxCents), quote.totals.taxCents > 0],
      // `Tax is added at payment`, with no figure: Stripe works it out from the address.
      [quote.taxLabel, '', quote.taxAtPayment],
    ] as Array<[string, string, boolean]>
  ).filter(([, , shown]) => shown)

  return (
    <Box ref={ref} {...rest} sx={nodeSx}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          {quote.storeName ? (
            <Typography variant="overline" color="text.secondary">
              {quote.storeName}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="h4" component="h1">
              {heading || quote.number}
            </Typography>
            <Chip
              label={quote.statusLabel}
              color={quote.status === 'paid' ? 'success' : unpaid ? 'primary' : 'default'}
              size="small"
            />
          </Stack>
          {quote.dateMs ? (
            <Typography variant="body2" color="text.secondary">
              {`Dated ${dateLabel(quote.dateMs)}`}
            </Typography>
          ) : null}
          <Box>
            <Button variant="outlined" size="small" href={pdfHref} download>
              {'Download PDF'}
            </Button>
          </Box>
        </Stack>

        {addresses.length ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 3 }}>
            {addresses.map((block) => (
              <AddressBlock key={block.label} label={block.label} lines={block.lines} />
            ))}
          </Stack>
        ) : null}

        <Stack spacing={1.5}>
          <Typography variant="h6" component="h2">
            {'Items'}
          </Typography>
          {quote.lines.map((line, index) => (
            <Stack key={index} direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
              <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                <Typography variant="body2">
                  {line.name}
                  {line.variantLabel ? ` (${line.variantLabel})` : ''}
                </Typography>
                {line.description ? (
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                    {line.description}
                  </Typography>
                ) : null}
                <Typography variant="caption" color="text.secondary">
                  {[
                    line.included ? `${line.quantity} included` : `${line.quantity} × ${money(line.unitAmountCents)}`,
                    line.sku ? `SKU ${line.sku}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ flexShrink: 0 }}>
                {line.included ? 'Included' : money(line.amountCents)}
              </Typography>
            </Stack>
          ))}
          <Divider />
          {totalRows.map(([label, value]) => (
            <TotalRow key={`${label}-${value}`} label={label} value={value} />
          ))}
          <TotalRow label="Total" value={money(quote.totals.totalCents)} strong />
        </Stack>

        {quote.notes ? (
          <Stack spacing={0.5}>
            <Typography variant="h6" component="h2">
              {'Notes'}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
              {quote.notes}
            </Typography>
          </Stack>
        ) : null}
        {quote.terms ? (
          <Stack spacing={0.5}>
            <Typography variant="h6" component="h2">
              {'Terms'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
              {quote.terms}
            </Typography>
          </Stack>
        ) : null}

        {unpaid ? (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              {returned === 'confirming' ? (
                <Alert severity="info" icon={<CircularProgress size={20} />}>
                  {'Thank you. We’re confirming your payment.'}
                </Alert>
              ) : returned === 'unconfirmed' ? (
                <Alert severity="info">
                  {'Your payment is still being confirmed. Your receipt will arrive by email.'}
                </Alert>
              ) : quote.approvalRequired ? (
                <Alert severity="info">
                  {`${quote.storeName || 'The business'} asks you to approve the proof before you pay.`}
                </Alert>
              ) : quote.payable ? (
                <>
                  {returned === 'failed' ? (
                    <Alert severity="warning">{'Your payment did not go through. Nothing was charged.'}</Alert>
                  ) : null}
                  {nativeCheckout ? (
                    <Suspense fallback={<StorefrontPaymentElementFallback />}>
                      <StorefrontPaymentElement
                        clientSecret={nativeCheckout.clientSecret}
                        publishableKey={nativeCheckout.publishableKey}
                        wallets={nativeCheckout.wallets}
                        payLabel={quote.taxAtPayment ? 'Pay now' : `Pay ${money(quote.totals.totalCents)}`}
                        defaultShippingAddress={stripeContact(quote.shipTo)}
                        // An expired or unloadable session is replaced by a new press.
                        onRestart={() => {
                          setNativeCheckout(null)
                          void pay()
                        }}
                        onCancel={() => setNativeCheckout(null)}
                      />
                    </Suspense>
                  ) : (
                    <Button
                      variant="contained"
                      size="large"
                      onClick={() => void pay()}
                      disabled={paying}
                      sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                    >
                      {paying
                        ? 'Opening…'
                        : quote.taxAtPayment
                          ? `Pay ${money(quote.totals.totalCents)} plus tax`
                          : `Pay ${money(quote.totals.totalCents)}`}
                    </Button>
                  )}
                  {payError ? <Alert severity="error">{payError}</Alert> : null}
                </>
              ) : (
                <Alert severity="info">
                  {`Contact ${quote.storeName || 'the business'} to pay this quote.`}
                </Alert>
              )}
            </Stack>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body1">
                {quote.status === 'paid'
                  ? quote.paidAtMs
                    ? `Paid ${dateLabel(quote.paidAtMs)}. Thank you.`
                    : 'Paid. Thank you.'
                  : `This quote is ${quote.statusLabel.toLowerCase()}.`}
              </Typography>
              {quote.receiptUrl ? (
                <Button variant="outlined" href={quote.receiptUrl}>
                  {'View your order'}
                </Button>
              ) : null}
            </Stack>
          </Paper>
        )}

        <Typography variant="body2" color="text.secondary">
          {`Questions about this quote? Contact ${quote.storeName || 'the business'}.`}
        </Typography>
      </Stack>
    </Box>
  )
})
QuotePageBody.displayName = 'QuotePageBody'

export default QuotePageBody

