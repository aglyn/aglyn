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

import { Button, Sheet, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { FULFILLMENT_CARRIER_CHOICES } from '../../lib/model/order-fulfillment'
import { errorText } from '../commerce-context'
import { type CommerceMobileContext, newAttemptKey } from '../data/context'
import { CARRIER_MAX_LENGTH, TRACKING_NUMBER_MAX_LENGTH } from '../data/limits'
import { checkFulfillLines, fulfillOrder, type OrderDetail } from '../data/orders'
import { scannedTracking } from '../data/scanned-codes'
import { BarcodeScanner, SHIPPING_BARCODE_TYPES } from '../ui/barcode-scanner'
import { Stepper, SwitchRow } from '../ui/controls'
import { FilterChips, showError } from '../ui/parts'

/*
 * Shipping some or all of an order (AGL-3621): how many of each line go in
 * this parcel, the carrier and the tracking number — typed, or read off the
 * label with the camera — and whether the buyer is told. One attempt key per
 * opening, so a retry after a dropped connection is the same shipment.
 */

const OTHER = 'Other'
const CARRIERS = [...FULFILLMENT_CARRIER_CHOICES, OTHER].map((carrier) => ({ id: carrier, label: carrier }))

export function FulfillSheet({
  visible,
  commerce,
  detail,
  onClose,
  onDone,
}: {
  visible: boolean
  commerce: CommerceMobileContext
  detail: OrderDetail
  onClose: () => void
  onDone: () => void
}) {
  const theme = useMobileTheme()
  const shippable = useMemo(() => detail.lines.filter((line) => line.remainingQuantity > 0), [detail.lines])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [carrier, setCarrier] = useState<string>(FULFILLMENT_CARRIER_CHOICES[0])
  const [otherCarrier, setOtherCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [notify, setNotify] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [attemptKey, setAttemptKey] = useState(() => newAttemptKey('fulfill'))

  useEffect(() => {
    if (!visible) return
    setCounts(Object.fromEntries(shippable.map((line) => [line.lineItemId, line.remainingQuantity])))
    setTracking('')
    setNotify(true)
    setAttemptKey(newAttemptKey('fulfill'))
  }, [visible, shippable])

  const lines = shippable.map((line) => ({ lineItemId: line.lineItemId, quantity: counts[line.lineItemId] ?? 0 }))
  const problem = lines.some((line) => line.quantity > 0) ? checkFulfillLines(detail.order, lines) : 'Choose at least one item'
  const carrierName = (carrier === OTHER ? otherCarrier : carrier).trim().slice(0, CARRIER_MAX_LENGTH)
  const everything = shippable.every((line) => (counts[line.lineItemId] ?? 0) === line.remainingQuantity)

  const submit = useMutation({
    mutationFn: () =>
      fulfillOrder(commerce, {
        orderId: detail.id,
        attemptKey,
        ...(everything ? {} : { lines }),
        ...(tracking.trim() ? { trackingNumber: tracking.trim(), carrier: carrierName } : {}),
        notify,
      }),
    onSuccess: onDone,
    onError: (error) => showError('Could not fulfill', errorText(error)),
  })

  return (
    <Sheet visible={visible} onClose={onClose} title="Fulfill items">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        {shippable.map((line) => {
          const item = detail.order.lineItems?.[line.lineItemId]
          return (
            <View key={line.lineItemId} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1) }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2}>{item?.name ?? 'Item'}</Text>
                <Text variant="caption" tone="secondary">
                  {line.remainingQuantity} to ship
                </Text>
              </View>
              <Stepper
                testID={`fulfill-line-${line.lineItemId}`}
                label={item?.name ?? 'items'}
                value={counts[line.lineItemId] ?? 0}
                max={line.remainingQuantity}
                onChange={(next) => setCounts((current) => ({ ...current, [line.lineItemId]: next }))}
              />
            </View>
          )
        })}
        <View style={{ gap: theme.space(1) }}>
          <Text variant="caption" tone="secondary">
            Carrier
          </Text>
          <View style={{ marginHorizontal: -theme.space(2) }}>
            <FilterChips testID="fulfill-carrier" options={CARRIERS} value={carrier} onChange={setCarrier} />
          </View>
          {carrier === OTHER ? (
            <TextField label="Carrier name" value={otherCarrier} onChangeText={setOtherCarrier} maxLength={CARRIER_MAX_LENGTH} />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space(1) }}>
          <View style={{ flex: 1 }}>
            <TextField
              testID="fulfill-tracking"
              label="Tracking number (optional)"
              value={tracking}
              onChangeText={setTracking}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={TRACKING_NUMBER_MAX_LENGTH}
            />
          </View>
          <Button testID="fulfill-scan" title="Scan" variant="outlined" icon="barcode-outline" onPress={() => setScanning(true)} />
        </View>
        <SwitchRow
          testID="fulfill-notify"
          label="Tell the customer"
          hint={
            detail.order.customerEmail || detail.order.customerPhone
              ? 'Sends them the shipping update'
              : 'No email or phone on this order'
          }
          value={notify}
          onChange={setNotify}
        />
        {problem && lines.some((line) => line.quantity > 0) ? (
          <Text variant="caption" tone="error">
            {problem}
          </Text>
        ) : null}
        <Button
          testID="fulfill-submit"
          title={everything ? 'Fulfill all' : 'Fulfill selected'}
          icon="cube-outline"
          disabled={Boolean(problem) || (carrier === OTHER && Boolean(tracking.trim()) && !carrierName)}
          busy={submit.isPending}
          onPress={() => submit.mutate()}
        />
      </View>
      <BarcodeScanner
        visible={scanning}
        title="Scan the shipping label"
        hint="Point the camera at the tracking barcode on the label."
        barcodeTypes={SHIPPING_BARCODE_TYPES}
        onClose={() => setScanning(false)}
        onScanned={(data) => {
          setScanning(false)
          const read = scannedTracking(data)
          if (!read) {
            showError('That is not a tracking number', 'Try the barcode labeled with the tracking number.')
            return
          }
          setTracking(read.trackingNumber)
          if (read.carrier) setCarrier(read.carrier)
        }}
      />
    </Sheet>
  )
}
