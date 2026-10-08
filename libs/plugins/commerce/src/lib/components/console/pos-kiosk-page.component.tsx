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

import type { ConsolePublicPageProps } from '@aglyn/aglyn'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as CommerceModel from '../../model'
import { newAttemptKey, posNativeBridge } from './pos/pos-api'
import { PosItemDialog, posItemNeedsChoice, type PosItemChoice } from './pos/pos-item-dialog.component'
import { PosDisplayBrandMark, PosDisplayBrandScreen } from './pos-display/brand-screen'
import { PosDisplayPairingScreen } from './pos-display/pairing-screen'
import { displayMoney, type PosDisplayAnswer } from './pos-display/pos-display-api'
import { PosDisplayReceiptScreen } from './pos-display/receipt-screen'
import { PosDisplayTipScreen, posDisplayTouchSx } from './pos-display/tip-screen'
import { KioskDone, KioskPaying, KioskReview, type KioskPayOptions } from './pos-kiosk/kiosk-checkout'
import { KioskMenu, type KioskCartLine } from './pos-kiosk/kiosk-menu'
import { KioskStaffControl } from './pos-kiosk/kiosk-staff'
import {
  clearKioskCustomerStorage,
  kioskApi,
  readKioskToken,
  storeKioskToken,
} from './pos-kiosk/pos-kiosk-api'
import { useKioskIdle } from './pos-kiosk/use-kiosk-idle'

/** How often the kiosk asks after a card payment in flight. */
export const POS_KIOSK_PAYMENT_POLL_MS = 1_500

type Phase =
  | { kind: 'start' }
  | { kind: 'menu' }
  | { kind: 'review' }
  | { kind: 'tip'; method: 'reader' | 'tap' }
  | { kind: 'paying'; method: 'reader' | 'tap'; paymentId: string | null; chargeCents: number; failure: string | null }
  | { kind: 'receipt' }
  | { kind: 'done' }

type TipAnswer = { tipChoice: 'percent' | 'custom' | 'none'; tipPercent?: number; tipCents?: number }

/** A product as the register's item sheet takes it, from the kiosk's catalog. */
export function kioskItemProduct(product: CommerceModel.PosKioskProduct) {
  return {
    $id: product.id,
    name: product.name,
    slug: product.id,
    type: 'physical',
    status: 'active',
    options: product.options,
    modifierGroups: product.modifierGroups,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      options: variant.options,
      priceUsd: variant.priceCents / 100,
      // A sold-out variant reads as zero on hand; anything else as untracked,
      // so the kiosk never learns or shows a stock count.
      inventory: variant.soldOut ? 0 : null,
    })),
  } as unknown as CommerceModel.HostProduct & { $id: string }
}

/** The cart line a choice makes: same item and choices merge. */
export function kioskCartLine(
  product: CommerceModel.PosKioskProduct,
  choice: PosItemChoice,
): KioskCartLine {
  const variant = product.variants.find((candidate) => candidate.id === choice.variant.id) ?? product.variants[0]!
  const picked = choice.modifiers
    .map((pick) => {
      const group = product.modifierGroups.find((candidate) => candidate.id === pick.groupId)
      return group?.options.find((option) => option.id === pick.optionId)
    })
    .filter((option): option is CommerceModel.ProductModifierOption => Boolean(option))
  const label = CommerceModel.lineLabelWithModifiers(
    Object.keys(variant.options).length ? Object.values(variant.options).join(' / ') : undefined,
    picked,
  )
  return {
    key: `${product.id}:${variant.id}:${CommerceModel.modifierSelectionKey(choice.modifiers)}`,
    productId: product.id,
    ...(variant.id !== 'default' || product.variants.length > 1 ? { variantId: variant.id } : {}),
    quantity: Math.min(CommerceModel.POS_KIOSK_MAX_QUANTITY, choice.quantity),
    ...(choice.modifiers.length ? { modifiers: choice.modifiers } : {}),
    name: product.name,
    ...(label ? { label } : {}),
    unitCents: variant.priceCents + picked.reduce((sum, option) => sum + option.priceCents, 0),
  }
}

/**
 * The self-service kiosk (AGL-3623), served at `/kiosk/commerce/pos-kiosk`
 * with no staff session: a customer builds their own order and pays on the
 * register's card reader or Tap to Pay, or sends it to the counter.
 *
 * It holds one secret — the kiosk token from pairing — and everything the
 * customer chooses or types lives in this component's memory only. The idle
 * reset (and "Done", and "Start over") voids an unpaid order, drops the
 * cart, the tip and any email or phone, sweeps the kiosk's storage keys, and
 * remounts every screen, so the next customer finds nothing of the last.
 */
export default function PosKioskPage(_props: ConsolePublicPageProps) {
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [context, setContext] = useState<CommerceModel.PosKioskContext | null>(null)
  const [catalog, setCatalog] = useState<CommerceModel.PosKioskCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'start' })
  const [lines, setLines] = useState<KioskCartLine[]>([])
  const [itemProduct, setItemProduct] = useState<CommerceModel.PosKioskProduct | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [sale, setSale] = useState<CommerceModel.PosKioskSale | null>(null)
  const [tip, setTip] = useState<TipAnswer>({ tipChoice: 'none' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  // Bumped by every reset: keys every screen, so inputs never carry over.
  const [turn, setTurn] = useState(0)
  // One attempt per cart, and one per press of a payment button.
  const checkoutKey = useRef<string | null>(null)
  const payKey = useRef<string | null>(null)
  const saleRef = useRef(sale)
  saleRef.current = sale
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    setToken(readKioskToken())
  }, [])

  const unpaired = useCallback(() => {
    storeKioskToken(null)
    clearKioskCustomerStorage()
    setToken(null)
    setContext(null)
    setCatalog(null)
    setSale(null)
    setLines([])
    setPhase({ kind: 'start' })
  }, [])

  /** A response that says the kiosk is no longer paired ends the session. */
  const lost = useCallback(
    (status: number) => {
      if (status === 401) {
        unpaired()
        return true
      }
      return false
    },
    [unpaired],
  )

  // The kiosk's settings and the menu: read when paired, and again every
  // ten minutes while idle on the start screen, so an edit reaches it.
  const refresh = useCallback(async () => {
    if (!token) return
    const result = await kioskApi.context(token)
    if (lost(result.status)) return
    setOffline(!result.ok && result.status === 0)
    if (result.ok && result.value) setContext(result.value)
  }, [token, lost])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (phaseRef.current.kind === 'start') void refresh()
    }, 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!token) return undefined
    let active = true
    setCatalogLoading(true)
    void kioskApi.catalog(token, categoryId).then((result) => {
      if (!active) return
      setCatalogLoading(false)
      if (lost(result.status)) return
      if (result.ok && result.value) setCatalog(result.value)
      else setOffline(result.status === 0)
    })
    return () => {
      active = false
    }
  }, [token, categoryId, turn, lost])

  const currency = context?.currency ?? catalog?.currency ?? 'usd'
  const money = useCallback((cents: number) => displayMoney(cents, currency), [currency])

  /**
   * THE RESET: the unpaid order voided, every customer detail dropped from
   * memory and storage, and the screens remounted on the start screen.
   */
  const reset = useCallback(() => {
    const open = saleRef.current
    if (token && open && open.status === 'open') void kioskApi.abandon(token, open.orderId)
    setSale(null)
    setLines([])
    setTip({ tipChoice: 'none' })
    setItemProduct(null)
    setCartOpen(false)
    setNotice(null)
    setCategoryId(null)
    checkoutKey.current = null
    payKey.current = null
    clearKioskCustomerStorage()
    setPhase({ kind: 'start' })
    setTurn((value) => value + 1)
  }, [token])

  const idle = useKioskIdle({
    // Never while a card is being collected: the customer is at the reader.
    active: Boolean(token) && phase.kind !== 'start' && phase.kind !== 'paying',
    idleSeconds: context?.idleSeconds ?? CommerceModel.POS_KIOSK_IDLE_SECONDS_DEFAULT,
    warningSeconds: CommerceModel.POS_KIOSK_IDLE_WARNING_SECONDS,
    onExpire: reset,
  })

  // The order-number screen returns to the start on its own.
  useEffect(() => {
    if (phase.kind !== 'done') return undefined
    const timer = setTimeout(reset, CommerceModel.POS_KIOSK_DONE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [phase.kind, reset])

  const addChoice = useCallback((product: CommerceModel.PosKioskProduct, choice: PosItemChoice) => {
    const line = kioskCartLine(product, choice)
    checkoutKey.current = null
    setLines((current) => {
      const existing = current.find((candidate) => candidate.key === line.key)
      if (existing) {
        return current.map((candidate) =>
          candidate.key === line.key
            ? { ...candidate, quantity: Math.min(CommerceModel.POS_KIOSK_MAX_QUANTITY, candidate.quantity + line.quantity) }
            : candidate,
        )
      }
      if (current.length >= CommerceModel.POS_KIOSK_MAX_LINES) return current
      return [...current, line]
    })
  }, [])

  const tapProduct = useCallback(
    (product: CommerceModel.PosKioskProduct) => {
      const asItem = kioskItemProduct(product)
      if (posItemNeedsChoice(asItem)) {
        setItemProduct(product)
        return
      }
      const variant = asItem.variants[0]
      if (!variant || product.variants[0]?.soldOut) return
      addChoice(product, { variant, modifiers: [], quantity: 1 })
    },
    [addChoice],
  )

  const checkout = useCallback(async () => {
    if (!token || busy || lines.length === 0) return
    if (!checkoutKey.current) checkoutKey.current = newAttemptKey()
    setBusy(true)
    setNotice(null)
    const result = await kioskApi.checkout(
      token,
      lines.map(({ productId, variantId, quantity, modifiers }) => ({
        productId,
        ...(variantId ? { variantId } : {}),
        quantity,
        ...(modifiers ? { modifiers } : {}),
      })),
      checkoutKey.current,
    )
    setBusy(false)
    if (lost(result.status)) return
    if (!result.ok || !result.value?.sale) {
      // A refused cart is changed before it is tried again.
      checkoutKey.current = null
      setNotice(result.error ?? 'Your order could not be priced. Try again.')
      return
    }
    setSale(result.value.sale)
    setCartOpen(false)
    setPhase({ kind: 'review' })
  }, [token, busy, lines, lost])

  const backToMenu = useCallback(() => {
    const open = saleRef.current
    if (token && open && open.status === 'open') void kioskApi.abandon(token, open.orderId)
    setSale(null)
    checkoutKey.current = null
    setNotice(null)
    setPhase({ kind: 'menu' })
  }, [token])

  const sendToCounter = useCallback(async () => {
    const open = saleRef.current
    if (!token || !open) return
    setBusy(true)
    const result = await kioskApi.counter(token, open.orderId)
    setBusy(false)
    if (lost(result.status)) return
    if (!result.ok || !result.value?.sale) {
      setNotice(result.error ?? 'Your order could not be sent to the counter.')
      return
    }
    setSale(result.value.sale)
    setLines([])
    setPhase({ kind: 'done' })
  }, [token, lost])

  const startPayment = useCallback(
    async (method: 'reader' | 'tap', answer: TipAnswer) => {
      const open = saleRef.current
      if (!token || !open) return
      if (!payKey.current) payKey.current = newAttemptKey()
      setBusy(true)
      setNotice(null)
      const result = await kioskApi.pay(token, { orderId: open.orderId, method, ...answer }, payKey.current)
      if (lost(result.status)) return setBusy(false)
      if (!result.ok || !result.value) {
        setBusy(false)
        payKey.current = null
        setNotice(result.error ?? 'The card payment could not be started.')
        setPhase({ kind: 'review' })
        return
      }
      const { sale: next, paymentId, clientSecret, paymentIntentId } = result.value
      setSale(next)
      const tipCents = CommerceModel.posKioskTipCents(answer.tipChoice, {
        baseCents: open.dueCents,
        enabled: true,
        percentages: context?.tipping.percentages ?? [],
        percent: answer.tipPercent,
        cents: answer.tipCents,
      })
      const chargeCents = open.dueCents + (tipCents ?? 0)
      setPhase({ kind: 'paying', method, paymentId: paymentId ?? null, chargeCents, failure: null })
      setBusy(false)
      if (method === 'tap') {
        const bridge = posNativeBridge()
        if (!bridge || !clientSecret || !paymentIntentId) {
          setPhase({ kind: 'paying', method, paymentId: paymentId ?? null, chargeCents, failure: 'Tap to Pay is not available on this device.' })
          return
        }
        const collected = await bridge
          .collectCardPayment({ paymentIntentId, clientSecret, amountCents: chargeCents })
          .catch(() => ({ status: 'failed' as const, message: undefined }))
        if (collected.status !== 'collected') {
          setPhase({
            kind: 'paying',
            method,
            paymentId: paymentId ?? null,
            chargeCents,
            failure: collected.status === 'canceled' ? 'The payment was canceled.' : (collected.message ?? 'The card was not read.'),
          })
        }
      }
    },
    [token, lost, context],
  )

  // The card in flight, asked after until it is paid or it fails.
  const paymentId = phase.kind === 'paying' ? phase.paymentId : null
  const paymentFailed = phase.kind === 'paying' ? Boolean(phase.failure) : false
  useEffect(() => {
    if (!token || !paymentId || paymentFailed) return undefined
    const open = saleRef.current
    if (!open) return undefined
    let active = true
    const timer = setInterval(async () => {
      const result = await kioskApi.paymentStatus(token, open.orderId, paymentId)
      if (!active) return
      if (lost(result.status)) return
      const next = result.value?.sale
      if (!next) return
      setSale(next)
      if (next.status === 'paid') {
        clearInterval(timer)
        setLines([])
        payKey.current = null
        setPhase({ kind: 'receipt' })
        return
      }
      const status = next.payment?.id === paymentId ? next.payment.status : ''
      if (status === 'failed' || status === 'canceled') {
        clearInterval(timer)
        payKey.current = null
        setPhase((current) =>
          current.kind === 'paying'
            ? { ...current, failure: next.payment?.failureMessage ?? 'The card was declined.' }
            : current,
        )
      }
    }, POS_KIOSK_PAYMENT_POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [token, paymentId, paymentFailed, lost])

  const cancelPayment = useCallback(async () => {
    const open = saleRef.current
    if (!token || !open || phase.kind !== 'paying') return
    setBusy(true)
    if (phase.paymentId && !phase.failure) await kioskApi.cancelPayment(token, open.orderId, phase.paymentId)
    const fresh = await kioskApi.sale(token, open.orderId)
    setBusy(false)
    payKey.current = null
    if (fresh.value?.sale) setSale(fresh.value.sale)
    if (fresh.value?.sale.status === 'paid') {
      setPhase({ kind: 'receipt' })
      return
    }
    setPhase({ kind: 'review' })
  }, [token, phase])

  const answerReceipt = useCallback(
    async (answer: PosDisplayAnswer) => {
      const paid = saleRef.current
      if (!token || !paid || !answer.receiptChannel) return
      setBusy(true)
      const result = await kioskApi.receipt(token, {
        orderId: paid.orderId,
        channel: answer.receiptChannel,
        ...(answer.email ? { to: answer.email } : {}),
        ...(answer.phone ? { to: answer.phone } : {}),
        ...(answer.marketingOptIn ? { marketingOptIn: true } : {}),
      })
      setBusy(false)
      if (lost(result.status)) return
      if (!result.ok) {
        setNotice(result.error ?? 'Your receipt could not be sent. Ask at the counter.')
      }
      setPhase({ kind: 'done' })
    },
    [token, lost],
  )

  const pay: KioskPayOptions = useMemo(
    () => ({
      reader: Boolean(context?.payments.cardPresent && context.payments.reader),
      tap: Boolean(context?.payments.cardPresent && posNativeBridge()),
      counter: Boolean(context?.payments.payAtCounter),
    }),
    [context],
  )

  const choosePay = useCallback(
    (method: 'reader' | 'tap') => {
      if (context?.tipping.enabled) {
        setPhase({ kind: 'tip', method })
        return
      }
      setTip({ tipChoice: 'none' })
      void startPayment(method, { tipChoice: 'none' })
    },
    [context, startPayment],
  )

  if (token === undefined) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    )
  }

  if (!token) {
    return (
      <PosDisplayPairingScreen
        mode="kiosk"
        onPaired={(next) => {
          storeKioskToken(next)
          setToken(next)
        }}
      />
    )
  }

  const branding = context?.branding ?? null
  let screen
  if (phase.kind === 'start') {
    screen = (
      <PosDisplayBrandScreen branding={branding} message={branding?.message || 'Order here'}>
        <Button
          variant="contained"
          size="large"
          onClick={() => setPhase({ kind: 'menu' })}
          sx={(theme) => ({ ...posDisplayTouchSx(theme), px: 6 })}
        >
          {'Start order'}
        </Button>
      </PosDisplayBrandScreen>
    )
  } else if (phase.kind === 'menu') {
    screen = (
      <>
        {notice ? (
          <Alert severity="warning" onClose={() => setNotice(null)} sx={{ m: 2, mb: 0 }}>
            {notice}
          </Alert>
        ) : null}
        <KioskMenu
          catalog={catalog}
          loading={catalogLoading && !catalog}
          categoryId={categoryId}
          onCategory={setCategoryId}
          onProduct={tapProduct}
          lines={lines}
          currency={currency}
          onReview={() => void checkout()}
          onQuantity={(key, quantity) => {
            checkoutKey.current = null
            setLines((current) =>
              quantity <= 0
                ? current.filter((line) => line.key !== key)
                : current.map((line) => (line.key === key ? { ...line, quantity } : line)),
            )
          }}
          cartOpen={cartOpen}
          onCartOpen={setCartOpen}
          busy={busy}
        />
      </>
    )
  } else if (phase.kind === 'review' && sale) {
    screen = (
      <KioskReview
        sale={sale}
        currency={currency}
        pay={pay}
        busy={busy}
        notice={notice}
        onPay={choosePay}
        onCounter={() => void sendToCounter()}
        onBack={backToMenu}
      />
    )
  } else if (phase.kind === 'tip' && sale && context) {
    screen = (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={4} sx={{ alignItems: 'center' }}>
          <PosDisplayBrandMark branding={branding} />
          <PosDisplayTipScreen
            tip={{ baseCents: sale.dueCents, percentages: context.tipping.percentages, allowCustom: true }}
            promptId={`kiosk-${sale.orderId}`}
            busy={busy}
            currency={currency}
            onAnswer={(answer) => {
              const next: TipAnswer = {
                tipChoice: answer.tipChoice ?? 'none',
                ...(answer.tipPercent ? { tipPercent: answer.tipPercent } : {}),
                ...(answer.tipChoice === 'custom' ? { tipCents: answer.tipCents ?? 0 } : {}),
              }
              setTip(next)
              void startPayment(phase.method, next)
            }}
          />
          <Button onClick={() => setPhase({ kind: 'review' })} disabled={busy}>
            {'Back'}
          </Button>
        </Stack>
      </Container>
    )
  } else if (phase.kind === 'paying' && sale) {
    screen = (
      <KioskPaying
        chargeCents={phase.chargeCents}
        currency={currency}
        method={phase.method}
        failure={phase.failure}
        testMode={Boolean(context?.testMode && phase.method === 'reader')}
        busy={busy}
        onCancel={() => void cancelPayment()}
        onRetry={() => void startPayment(phase.method, tip)}
        onCounter={pay.counter ? () => void sendToCounter() : null}
        onSimulate={
          phase.paymentId
            ? () => void kioskApi.simulate(token, sale.orderId, phase.paymentId as string)
            : null
        }
      />
    )
  } else if (phase.kind === 'receipt' && sale && context) {
    screen = (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={4} sx={{ alignItems: 'center' }}>
          <PosDisplayBrandMark branding={branding} />
          <PosDisplayReceiptScreen
            receipt={{ channels: context.receipts, offerMarketing: context.offerMarketing }}
            promptId={`kiosk-${sale.orderId}`}
            busy={busy}
            onAnswer={(answer) => void answerReceipt(answer)}
          />
        </Stack>
      </Container>
    )
  } else if (phase.kind === 'done' && sale) {
    screen = <KioskDone sale={sale} currency={currency} onDone={reset} />
  } else {
    screen = <PosDisplayBrandScreen branding={branding} busy />
  }

  return (
    <Box key={turn} sx={{ position: 'relative', minHeight: '100dvh' }}>
      {offline ? (
        <Alert severity="warning" sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: (theme) => theme.zIndex.modal + 1 }}>
          {'Reconnecting…'}
        </Alert>
      ) : null}
      {screen}
      <PosItemDialog
        product={itemProduct ? kioskItemProduct(itemProduct) : null}
        onClose={() => setItemProduct(null)}
        onConfirm={(choice) => {
          const product = itemProduct
          setItemProduct(null)
          if (product) addChoice(product, choice)
        }}
        formatMoney={money}
        blockSoldOut
        maxQuantity={CommerceModel.POS_KIOSK_MAX_QUANTITY}
      />
      <Dialog open={idle.warning !== null} onClose={idle.stillHere} maxWidth="xs" fullWidth>
        <DialogTitle>{'Still there?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`This order will be cleared in ${idle.warning ?? 0} seconds.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={reset}>{'Start over'}</Button>
          <Button variant="contained" onClick={idle.stillHere}>
            {'I’m still here'}
          </Button>
        </DialogActions>
      </Dialog>
      {phase.kind === 'start' || phase.kind === 'menu' ? (
        <KioskStaffControl token={token} onExit={unpaired} onUnauthorized={unpaired} />
      ) : null}
    </Box>
  )
}

PosKioskPage.displayName = 'PosKioskPage'
