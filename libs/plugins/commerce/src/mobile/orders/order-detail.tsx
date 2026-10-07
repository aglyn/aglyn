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

import type { MobilePluginContext, MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Screen, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Print from 'expo-print'
import { useState } from 'react'
import { Linking, Share, View } from 'react-native'
import { errorText, useCommerceContext } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import {
  cancelOrder,
  cancelShipment,
  commerceKeys,
  markOrderDelivered,
  money,
  type OrderDetail,
  orderQuery,
  storeSettingsQuery,
} from '../data/orders'
import { ORDER_STATUS_LABELS } from '../../lib/model/commerce-orders'
import { orderReceipt, receiptHtml, receiptStoreName, receiptText } from '../data/receipts'
import { confirmAction, Fact, IconAction, Pill, type PillTone, showError } from '../ui/parts'
import { FulfillSheet } from './fulfill-sheet'
import { ReceiptSheet } from './receipt-sheet'
import { RefundSheet } from './refund-sheet'

/*
 * One order (AGL-3621): who bought what, what has shipped, the money, and
 * every action the console's order dialog offers that a phone is the right
 * place for. Each action is offered from the same pure rule the route
 * re-asks under its own transaction, so a stale screen can only offer
 * something the route then refuses, never do something it should not.
 */

const STATUS_TONES: Record<string, PillTone> = {
  pending: 'warning',
  paid: 'info',
  partially_fulfilled: 'info',
  fulfilled: 'success',
  delivered: 'success',
  cancelled: 'neutral',
  refunded: 'neutral',
}

function addressLines(address: OrderDetail['order']['shippingAddress']): string[] {
  if (!address) return []
  return [
    address.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter((line): line is string => Boolean(line && line.trim()))
}

export function OrderDetailPanel({
  context,
  commerce,
  orderId,
}: {
  context: MobilePluginContext
  commerce: CommerceMobileContext
  orderId: string
}) {
  const theme = useMobileTheme()
  const client = useQueryClient()
  const query = useQuery(orderQuery(commerce, orderId))
  const store = useQuery(storeSettingsQuery(commerce))
  const currency = store.data?.currency
  const [sheet, setSheet] = useState<null | 'fulfill' | 'refund' | 'receipt'>(null)

  const refresh = () => client.invalidateQueries({ queryKey: commerceKeys.orders(commerce.hostId) })
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => refresh(),
    onError: (error) => showError('That did not go through', errorText(error)),
  })

  if (query.isPending) {
    return (
      <Screen>
        <Skeleton height={120} />
        <Skeleton height={160} />
      </Screen>
    )
  }
  const detail = query.data
  if (!detail) {
    return (
      <Screen>
        <EmptyState
          icon="receipt-outline"
          title={query.isError ? 'Could not load this order' : 'This order is gone'}
          body={query.isError ? errorText(query.error) : undefined}
          action={query.isError ? <Button title="Try again" onPress={() => void query.refetch()} /> : undefined}
        />
      </Screen>
    )
  }
  const { order } = detail
  const fmt = (cents: number) => money(cents, currency ? { currency } : null)
  const totals = order.totals
  const shipTo = addressLines(order.shippingAddress)

  const receipt = async () =>
    orderReceipt(detail.id, order, { storeName: await receiptStoreName(commerce), ...(currency ? { currency } : {}) })
  const print = async () => {
    try {
      await Print.printAsync({ html: receiptHtml(await receipt()) })
    } catch (error) {
      // Dismissing the printer picker rejects on some platforms; only a real failure is said.
      if (!/cancel/i.test(errorText(error, ''))) showError('Could not print', errorText(error))
    }
  }
  const share = async () => {
    await Share.share({ title: `Order #${detail.label}`, message: receiptText(await receipt()) }).catch(() => undefined)
  }

  return (
    <Screen>
      <Card
        title={`Order #${detail.label}`}
        actions={
          <View style={{ flexDirection: 'row', gap: theme.space(1) }}>
            <IconAction testID="order-print" icon="print-outline" label="Print receipt" onPress={() => void print()} />
            <IconAction testID="order-share" icon="share-outline" label="Share receipt" onPress={() => void share()} />
          </View>
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
          <Pill
            testID="order-status"
            label={ORDER_STATUS_LABELS[order.status] ?? order.status}
            tone={STATUS_TONES[order.status] ?? 'neutral'}
          />
          {detail.testMode ? <Pill label="Test mode" tone="warning" /> : null}
          {detail.refundState === 'partial' ? <Pill label="Partly refunded" tone="info" /> : null}
        </View>
        <Fact label="Placed" value={new Date(Number((order as { createdAtMs?: number }).createdAtMs) || Date.now()).toLocaleString()} />
        <Fact label="Total" value={fmt(totals?.totalCents ?? 0)} strong />
      </Card>

      <Card title="Customer">
        <Text>{order.customerName || 'Guest'}</Text>
        {order.customerEmail ? (
          <Button
            testID="order-email"
            title={order.customerEmail}
            variant="text"
            icon="mail-outline"
            onPress={() => void Linking.openURL(`mailto:${order.customerEmail}`)}
          />
        ) : null}
        {order.customerPhone ? (
          <Button
            title={order.customerPhone}
            variant="text"
            icon="call-outline"
            onPress={() => void Linking.openURL(`tel:${order.customerPhone}`)}
          />
        ) : null}
        {shipTo.length ? (
          <View>
            <Text variant="caption" tone="secondary">
              Ship to
            </Text>
            {shipTo.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </View>
        ) : null}
      </Card>

      <Card title="Items">
        {(order.lineItems ?? []).map((line, index) => {
          const state = detail.lines[index]
          return (
            <View key={`${line.productId}-${index}`} style={{ gap: 2 }}>
              <Fact label={`${line.quantity} × ${line.name}`} value={fmt(Math.round(line.unitAmountCents * line.quantity))} />
              {line.variantLabel ? (
                <Text variant="caption" tone="secondary">
                  {line.variantLabel}
                </Text>
              ) : null}
              {state?.requiresShipping && state.fulfilledQuantity > 0 ? (
                <Text variant="caption" tone="secondary">
                  {state.remainingQuantity ? `${state.fulfilledQuantity} shipped, ${state.remainingQuantity} to ship` : 'Shipped'}
                </Text>
              ) : null}
            </View>
          )
        })}
        {totals ? (
          <View style={{ gap: 2, paddingTop: theme.space(1) }}>
            <Fact label="Subtotal" value={fmt(totals.itemsCents)} />
            {totals.discountCents ? <Fact label="Discount" value={`−${fmt(totals.discountCents)}`} /> : null}
            {totals.shippingCents ? <Fact label="Shipping" value={fmt(totals.shippingCents)} /> : null}
            {totals.taxCents ? <Fact label="Tax" value={fmt(totals.taxCents)} /> : null}
            {totals.tipCents ? <Fact label="Tip" value={fmt(totals.tipCents)} /> : null}
            <Fact label="Total" value={fmt(totals.totalCents)} strong />
            {order.refundedCents ? <Fact label="Refunded" value={`−${fmt(order.refundedCents)}`} /> : null}
          </View>
        ) : null}
      </Card>

      {detail.shipments.length ? (
        <Card title="Shipments">
          {detail.shipments.map((shipment) => (
            <View key={shipment.id} style={{ gap: theme.space(0.5) }}>
              <Text>{shipment.summary}</Text>
              <Text variant="caption" tone="secondary">
                {[shipment.carrier, shipment.trackingNumber].filter(Boolean).join(' · ') || 'No tracking'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
                {shipment.trackingUrl ? (
                  <Button
                    title="Track"
                    variant="text"
                    icon="navigate-outline"
                    onPress={() => void Linking.openURL(shipment.trackingUrl as string)}
                  />
                ) : null}
                {shipment.labelUrl ? (
                  <Button
                    title="Label"
                    variant="text"
                    icon="document-outline"
                    onPress={() => void Linking.openURL(shipment.labelUrl as string)}
                  />
                ) : null}
                {shipment.editable ? (
                  <Button
                    title="Cancel shipment"
                    variant="text"
                    icon="close-circle-outline"
                    testID={`shipment-cancel-${shipment.id}`}
                    onPress={async () => {
                      const yes = await confirmAction({
                        title: 'Cancel this shipment?',
                        body: 'Its items go back to waiting to ship.',
                        confirm: 'Cancel shipment',
                        destructive: true,
                      })
                      if (yes) action.mutate(() => cancelShipment(commerce, { orderId, fulfillmentId: shipment.id }))
                    }}
                  />
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {order.note ? (
        <Card title="Note">
          <Text>{order.note}</Text>
        </Card>
      ) : null}

      <View style={{ gap: theme.space(1) }}>
        {detail.actions.fulfill ? (
          <Button testID="order-fulfill" title="Fulfill items" icon="cube-outline" onPress={() => setSheet('fulfill')} />
        ) : null}
        {detail.actions.markDelivered ? (
          <Button
            testID="order-delivered"
            title="Mark delivered"
            variant="outlined"
            icon="checkmark-done-outline"
            busy={action.isPending}
            onPress={() => action.mutate(() => markOrderDelivered(commerce, orderId))}
          />
        ) : null}
        {detail.actions.resendReceipt ? (
          <Button testID="order-receipt" title="Resend receipt" variant="outlined" icon="mail-outline" onPress={() => setSheet('receipt')} />
        ) : null}
        {detail.actions.refund ? (
          <Button testID="order-refund" title="Refund" variant="outlined" icon="return-down-back-outline" onPress={() => setSheet('refund')} />
        ) : null}
        {detail.actions.cancel ? (
          <Button
            testID="order-cancel"
            title="Cancel order"
            variant="text"
            icon="close-circle-outline"
            onPress={async () => {
              const yes = await confirmAction({
                title: `Cancel order #${detail.label}?`,
                body: 'Its stock goes back on the shelf. This cannot be undone.',
                confirm: 'Cancel order',
                destructive: true,
              })
              if (yes) action.mutate(() => cancelOrder(commerce, orderId))
            }}
          />
        ) : null}
        <Button
          title="Open in the console"
          variant="text"
          icon="open-outline"
          onPress={() => context.openConsolePath('/products/orders', 'site')}
        />
      </View>

      <FulfillSheet
        visible={sheet === 'fulfill'}
        commerce={commerce}
        detail={detail}
        onClose={() => setSheet(null)}
        onDone={() => {
          setSheet(null)
          void refresh()
        }}
      />
      <RefundSheet
        visible={sheet === 'refund'}
        commerce={commerce}
        detail={detail}
        currency={currency}
        onClose={() => setSheet(null)}
        onDone={() => {
          setSheet(null)
          void refresh()
        }}
      />
      <ReceiptSheet visible={sheet === 'receipt'} commerce={commerce} detail={detail} onClose={() => setSheet(null)} />
    </Screen>
  )
}

/** The order on its own screen, as a phone opens it from the list or a notification. */
export default function OrderScreen({ context, params }: MobileScreenProps) {
  const commerce = useCommerceContext(context)
  const orderId = params['orderId']
  if (!commerce || !orderId) return <EmptyState icon="receipt-outline" title="This order could not be opened" />
  return <OrderDetailPanel context={context} commerce={commerce} orderId={orderId} />
}
