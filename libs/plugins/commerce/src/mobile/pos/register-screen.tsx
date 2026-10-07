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

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, EmptyState, ListRow, Notice, Screen, Skeleton, Text, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useQuery } from '@tanstack/react-query'
import type { Firestore } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatOrderMoney } from '../../lib/model/buyer-notifications'
import { type CommerceMobileContext, newAttemptKey } from '../data/context'
import { storeSettingsQuery } from '../data/orders'
import {
  cartAdd,
  cartCount,
  cartSetDiscount,
  cartSetQuantity,
  cartSubtotalCents,
  EMPTY_CART,
  type PosCart,
  type PosCartPick,
  readStoredCart,
} from './cart'
import { CartPanel } from './cart-panel'
import {
  findItemByCode,
  itemNeedsSheet,
  pickOf,
  type PosItem,
  posKeys,
  type PosVariant,
  variantSoldOut,
} from './catalog'
import { CatalogPanel } from './catalog-panel'
import { Checkout } from './checkout'
import { ItemSheet } from './item-sheet'
import {
  cartStorageKey,
  type PendingSale,
  pendingSaleKey,
  posRegistersQuery,
  readPendingSale,
  registerChoiceKey,
  type PosRegister,
} from './registers'
import { fetchPosContext, openSale, type PosOpenedSale, salePayment } from './sale-api'
import { useStoredState } from './use-stored'

/*==========================================
 * THE REGISTER (AGL-3618), Aglyn POS's main screen.
 *
 * On a tablet the item grid and the sale sit side by side, and checkout
 * takes the sale's place; on a phone the grid fills the screen, the sale is
 * a bar along the bottom that opens full height, and checkout is its own
 * sheet. The basket, the quick keys and a sale in progress are kept on the
 * device, so a crash, a restart or a dropped connection never loses a sale.
 *=========================================*/

type Toast = { tone: 'success' | 'warning' | 'error'; message: string } | null

const readString = (raw: unknown) => (typeof raw === 'string' && raw ? raw : null)

export default function PosRegisterScreen({ context }: MobileScreenProps) {
  const hostId = context.hostId
  if (!hostId) {
    return <EmptyState icon="storefront-outline" title="Choose a store" body="Pick the store this register sells for." />
  }
  return <RegisterForSite context={context} hostId={hostId} />
}

function RegisterForSite({ context, hostId }: { context: MobileScreenProps['context']; hostId: string }) {
  const firestore = context.firestore as Firestore
  const registers = useQuery(posRegistersQuery(firestore, hostId))
  const [chosenId, setChosenId, chosenReady] = useStoredState<string | null>(registerChoiceKey(hostId), readString, null)
  const [picking, setPicking] = useState(false)
  const list = registers.data ?? []
  const register = list.find((entry) => entry.id === chosenId) ?? (list.length === 1 ? list[0] : null)

  if (registers.isPending || !chosenReady) {
    return (
      <Screen>
        <Skeleton height={44} />
        <Skeleton height={200} />
      </Screen>
    )
  }
  if (registers.isError) {
    return (
      <Screen>
        <Notice tone="error" message="The registers could not be loaded." action={{ label: 'Retry', onPress: () => void registers.refetch() }} />
      </Screen>
    )
  }
  if (!list.length) {
    return (
      <EmptyState
        icon="calculator-outline"
        title="No registers yet"
        body="Add a register on the Point of sale page in the console, then come back."
        action={<Button title="Open Point of sale" variant="outlined" onPress={() => context.openConsolePath('/pos', 'site')} />}
      />
    )
  }
  if (!register || picking) {
    return (
      <Screen padded={false}>
        <Text variant="heading" style={{ padding: 16 }}>
          Which register is this?
        </Text>
        {list.map((entry) => (
          <ListRow
            key={entry.id}
            testID={`register-${entry.id}`}
            title={entry.name}
            icon="calculator-outline"
            selected={entry.id === register?.id}
            onPress={() => {
              setChosenId(entry.id)
              setPicking(false)
            }}
          />
        ))}
      </Screen>
    )
  }
  return (
    <Register
      key={register.id}
      context={context}
      hostId={hostId}
      firestore={firestore}
      register={register}
      canSwitch={list.length > 1}
      onSwitchRegister={() => setPicking(true)}
    />
  )
}

function Register(props: {
  context: MobileScreenProps['context']
  hostId: string
  firestore: Firestore
  register: PosRegister
  canSwitch: boolean
  onSwitchRegister: () => void
}) {
  const { context, hostId, firestore, register } = props
  const theme = useMobileTheme()
  const layout = useLayout()
  const online = context.online !== false
  const reader = context.cardReader ?? null

  const [cart, setCart] = useStoredState<PosCart>(cartStorageKey(hostId, register.id), readStoredCart, EMPTY_CART)
  // The grid reopens on the view it was left on (quick keys or everything).
  const [quickKeys, setQuickKeys] = useStoredState<boolean>(
    `aglyn.pos.grid-view.${hostId}.${register.id}`,
    (raw) => raw === true,
    true,
  )
  const [pending, setPending, pendingReady] = useStoredState<PendingSale | null>(
    pendingSaleKey(hostId, register.id),
    (raw) => readPendingSale(raw, Date.now()),
    null,
  )
  const [opened, setOpened] = useState<PosOpenedSale | null>(null)
  const [charging, setCharging] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [sheetItem, setSheetItem] = useState<PosItem | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  /** One open-sale attempt per basket: a retry after a lost answer finds the same sale. */
  const openAttempt = useRef<{ cart: string; key: string } | null>(null)

  const posContext = useQuery({
    queryKey: posKeys.context(hostId),
    queryFn: () => fetchPosContext(context.api, hostId),
    staleTime: 60_000,
  })
  // Only the store's currency is read, so the commerce context needs no API.
  const store = useQuery(storeSettingsQuery({ firestore, hostId } as CommerceMobileContext))
  const currency = store.data?.currency ?? 'USD'
  const money = useCallback((cents: number) => formatOrderMoney(cents, currency), [currency])
  const inCart = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const line of cart.lines) counts[line.productId] = (counts[line.productId] ?? 0) + line.quantity
    return counts
  }, [cart.lines])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  // A sale this register left open (the app was closed mid-checkout):
  // re-read it and pick up where it stopped.
  const resumed = useRef(false)
  useEffect(() => {
    if (!pendingReady || resumed.current || !pending || opened || !online) return
    resumed.current = true
    void salePayment({ api: context.api, hostId, orderId: pending.orderId, step: { action: 'sale' } })
      .then((answer) => {
        if (answer.sale.status === 'pending') {
          setOpened({
            orderId: pending.orderId,
            totals: { totalCents: answer.sale.totalCents },
            dueCents: answer.sale.dueCents,
            stockWarnings: [],
          })
          setToast({ tone: 'warning', message: 'This register had a sale open. Finish or cancel it.' })
        } else {
          setPending(null)
          if (answer.sale.status === 'paid') setCart(EMPTY_CART)
        }
      })
      .catch(() => {
        resumed.current = false
      })
  }, [context.api, hostId, online, opened, pending, pendingReady, setCart, setPending])

  const addVariant = useCallback(
    (item: PosItem, variant: PosVariant, quantity = 1, chosen?: PosCartPick) => {
      const pick = chosen ?? pickOf(item, variant)
      if ('problem' in pick) {
        setToast({ tone: 'error', message: pick.problem })
        return
      }
      setCart((current) => cartAdd(current, pick, quantity))
      if (variantSoldOut(variant)) {
        setToast({ tone: 'warning', message: `${item.name} shows none in stock. The sale can go ahead.` })
      }
    },
    [setCart],
  )

  const onPick = useCallback(
    (item: PosItem) => {
      if (itemNeedsSheet(item)) setSheetItem(item)
      else if (item.variants[0]) addVariant(item, item.variants[0])
    },
    [addVariant],
  )

  const onCode = useCallback(
    async (code: string) => {
      try {
        const found = await findItemByCode(firestore, hostId, code)
        if (found.kind === 'found' && found.item.modifierGroups.some((group) => group.min > 0)) {
          // A scanned item with a required choice still needs the choice.
          setSheetItem(found.item)
        } else if (found.kind === 'found') {
          addVariant(found.item, found.variant)
          setToast({ tone: 'success', message: `Added ${found.item.name}${found.variant.label ? `, ${found.variant.label}` : ''}` })
        } else {
          setToast({
            tone: 'warning',
            message: found.kind === 'missing' ? `No product matches “${found.code}”.` : 'That code could not be read.',
          })
        }
      } catch {
        setToast({ tone: 'error', message: 'Could not reach the catalog. Try again.' })
      }
    },
    [addVariant, firestore, hostId],
  )

  const scan = context.scanCode
    ? async () => {
        const code = await context.scanCode!('Scan an item’s barcode')
        if (code) await onCode(code)
      }
    : undefined

  const charge = useCallback(async () => {
    if (!online) return
    const fingerprint = JSON.stringify([cart.lines.map((line) => [line.key, line.quantity]), cart.discountPct, cart.customerEmail])
    if (openAttempt.current?.cart !== fingerprint) openAttempt.current = { cart: fingerprint, key: newAttemptKey('pos-open') }
    setCharging(true)
    try {
      const sale = await openSale({
        api: context.api,
        hostId,
        registerId: register.id,
        locationId: register.locationId,
        cart,
        attemptKey: openAttempt.current.key,
      })
      setPending({ orderId: sale.orderId, totalCents: sale.totals.totalCents, openedAtMs: Date.now() })
      setOpened(sale)
      if (sale.stockWarnings.length) {
        setToast({ tone: 'warning', message: 'Some items show less stock than this sale. It can still go ahead.' })
      }
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : 'The sale could not be started.' })
    } finally {
      setCharging(false)
    }
  }, [cart, context.api, hostId, online, register.id, register.locationId, setPending])

  const finish = useCallback(
    (message: string | null) => {
      openAttempt.current = null
      setOpened(null)
      setCartOpen(false)
      setPending(null)
      if (message) {
        setCart(EMPTY_CART)
        setToast({ tone: 'success', message })
      }
    },
    [setCart, setPending],
  )

  const columns = layout.split
    ? Math.max(3, Math.floor((layout.width - 400) / 170))
    : layout.landscape
      ? 5
      : 3

  const chargeBlocked = !online ? 'No connection. The sale is kept until you are back online.' : null
  const cartPanel = (
    <CartPanel
      cart={cart}
      money={money}
      onQuantity={(key, quantity) => setCart((current) => cartSetQuantity(current, key, quantity))}
      onDiscount={(pct) => setCart((current) => cartSetDiscount(current, pct))}
      onClear={() => setCart(EMPTY_CART)}
      onCharge={() => void charge()}
      chargeBlocked={chargeBlocked}
      charging={charging}
    />
  )
  const checkout = opened ? (
    <Checkout
      api={context.api}
      hostId={hostId}
      opened={opened}
      context={posContext.data ?? null}
      cardReader={reader}
      online={online}
      money={money}
      customerEmail={cart.customerEmail}
      onFinished={() => finish('Sale complete.')}
      onVoided={() => {
        finish(null)
        setToast({ tone: 'warning', message: 'Sale canceled. The items are still in the basket.' })
      }}
    />
  ) : null

  const readerLabel = reader
    ? reader.state.connected
      ? reader.state.label ?? 'Reader connected'
      : 'Connect a reader'
    : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.default }} edges={['left', 'right']}>
      <View
        style={[
          styles.bar,
          {
            gap: theme.space(1),
            paddingHorizontal: theme.space(1.5),
            paddingVertical: theme.space(0.75),
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.background.paper,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Register ${register.name}${props.canSwitch ? '. Switch register' : ''}`}
          disabled={!props.canSwitch}
          onPress={props.onSwitchRegister}
          style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
          testID="register-name"
        >
          <Text variant="label" numberOfLines={1}>
            {register.name}
          </Text>
          {posContext.data?.testMode ? (
            <Text variant="caption" tone="error">
              Test mode
            </Text>
          ) : null}
        </Pressable>
        {readerLabel ? (
          <Pressable
            testID="reader-chip"
            accessibilityRole="button"
            accessibilityLabel={`Card reader: ${readerLabel}`}
            onPress={() => reader?.manage()}
            style={{
              minHeight: 36,
              justifyContent: 'center',
              paddingHorizontal: theme.space(1.5),
              borderRadius: 18,
              backgroundColor: reader?.state.connected ? theme.colors.success.main : theme.colors.background.default,
              borderWidth: reader?.state.connected ? 0 : 1,
              borderColor: theme.colors.divider,
            }}
          >
            <Text
              variant="caption"
              style={{ color: reader?.state.connected ? theme.colors.success.contrastText : theme.colors.text.primary }}
            >
              {readerLabel}
            </Text>
          </Pressable>
        ) : null}
        <Button title="Shifts & returns" variant="text" onPress={() => context.openConsolePath('/pos', 'site')} />
      </View>
      {!online ? (
        <View style={{ padding: theme.space(1) }}>
          <Notice tone="warning" testID="register-offline" message="Offline. Keep ringing items up; take payment when the connection is back." />
        </View>
      ) : null}
      {toast ? (
        <View style={{ paddingHorizontal: theme.space(1), paddingTop: theme.space(1) }}>
          <Notice tone={toast.tone} message={toast.message} testID="register-toast" />
        </View>
      ) : null}

      {layout.split ? (
        <View style={styles.split}>
          <View style={{ flex: 1 }}>
            <CatalogPanel
              firestore={firestore}
              hostId={hostId}
              columns={columns}
              money={money}
              quickKeys={quickKeys}
              onQuickKeys={setQuickKeys}
              inCart={inCart}
              onPick={onPick}
              onScan={scan}
              onSubmitCode={(code) => void onCode(code)}
            />
          </View>
          <View style={[styles.side, { borderLeftColor: theme.colors.divider }]}>{checkout ?? cartPanel}</View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <CatalogPanel
            firestore={firestore}
            hostId={hostId}
            columns={columns}
            money={money}
            quickKeys={quickKeys}
            onQuickKeys={setQuickKeys}
            inCart={inCart}
            onPick={onPick}
            onScan={scan}
            onSubmitCode={(code) => void onCode(code)}
          />
          <Pressable
            testID="cart-bar"
            accessibilityRole="button"
            accessibilityLabel={`Open the sale, ${cartCount(cart)} items`}
            onPress={() => setCartOpen(true)}
            style={[
              styles.cartBar,
              {
                margin: theme.space(1),
                padding: theme.space(1.5),
                borderRadius: theme.radius,
                backgroundColor: theme.colors.primary.main,
              },
            ]}
          >
            <Text variant="label" style={{ color: theme.colors.primary.contrastText, flex: 1 }}>
              {cartCount(cart) ? `${cartCount(cart)} item${cartCount(cart) === 1 ? '' : 's'}` : 'No items'}
            </Text>
            <Text variant="label" style={{ color: theme.colors.primary.contrastText }}>
              {money(cartSubtotalCents(cart))} · Review
            </Text>
          </Pressable>
          <Modal
            visible={cartOpen || Boolean(opened)}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => {
              // A sale being paid closes only through its own buttons.
              if (!opened) setCartOpen(false)
            }}
          >
            <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.default }}>
              {checkout ?? (
                <>
                  <Button title="Keep selling" variant="text" icon="chevron-down" onPress={() => setCartOpen(false)} />
                  {cartPanel}
                </>
              )}
            </SafeAreaView>
          </Modal>
        </View>
      )}

      <ItemSheet
        item={sheetItem}
        money={money}
        onClose={() => setSheetItem(null)}
        onAdd={(pick, quantity, variant) => {
          if (sheetItem) addVariant(sheetItem, variant, quantity, pick)
          setSheetItem(null)
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  split: { flex: 1, flexDirection: 'row' },
  side: { width: 400, borderLeftWidth: StyleSheet.hairlineWidth },
  cartBar: { flexDirection: 'row', alignItems: 'center' },
})
