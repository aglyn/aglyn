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
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { errorText } from '../commerce-context'
import { type CommerceMobileContext, newAttemptKey } from '../data/context'
import { minorUnitsFromText, textFromMinorUnits } from '../data/money-input'
import { checkRefundAmount, money, type OrderDetail, proposedRefundCents, refundOrder } from '../data/orders'
import { CheckRow } from '../ui/controls'
import { confirmAction, Fact, showError } from '../ui/parts'

/*
 * A refund from the phone (AGL-3621): the whole remainder, or the lines that
 * came back, priced after their share of the discount — and any amount the
 * merchant settles on, up to what is left. Through the console's refund
 * route, under one attempt key per opening: a second tap or a retry after a
 * dropped connection cannot refund twice.
 */

export function RefundSheet({
  visible,
  commerce,
  detail,
  currency,
  onClose,
  onDone,
}: {
  visible: boolean
  commerce: CommerceMobileContext
  detail: OrderDetail
  currency: string | undefined
  onClose: () => void
  onDone: () => void
}) {
  const theme = useMobileTheme()
  const [picked, setPicked] = useState<number[]>([])
  const [amount, setAmount] = useState('')
  const [attemptKey, setAttemptKey] = useState(() => newAttemptKey('refund'))
  const fmt = (cents: number) => money(cents, currency ? { currency } : null)

  useEffect(() => {
    if (!visible) return
    setPicked([])
    setAmount(textFromMinorUnits(detail.refundableCents, currency))
    setAttemptKey(newAttemptKey('refund'))
  }, [visible, detail.refundableCents, currency])

  const toggle = (lineItemId: number) => {
    const next = picked.includes(lineItemId) ? picked.filter((id) => id !== lineItemId) : [...picked, lineItemId]
    setPicked(next)
    setAmount(textFromMinorUnits(proposedRefundCents(detail, next), currency))
  }

  const cents = minorUnitsFromText(amount, currency)
  const problem = cents == null ? 'Enter an amount' : checkRefundAmount(cents, detail.refundableCents, { order: detail.order, lineItemIds: picked })
  const whole = cents === detail.refundableCents && !picked.length

  const submit = useMutation({
    mutationFn: () =>
      refundOrder(commerce, {
        orderId: detail.id,
        amountCents: whole ? null : (cents as number),
        lineItemIds: picked,
        attemptKey,
      }),
    onSuccess: onDone,
    onError: (error) => showError('Refund failed', errorText(error)),
  })

  return (
    <Sheet visible={visible} onClose={onClose} title="Refund">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        <Fact label="Left to refund" value={fmt(detail.refundableCents)} strong />
        {detail.order.lineItems?.length ? (
          <View>
            <Text variant="caption" tone="secondary">
              Items coming back (optional)
            </Text>
            {detail.order.lineItems.map((line, index) => (
              <CheckRow
                key={`${line.productId}-${index}`}
                testID={`refund-line-${index}`}
                label={`${line.quantity} × ${line.name}`}
                detail={line.variantLabel}
                checked={picked.includes(index)}
                onToggle={() => toggle(index)}
              />
            ))}
          </View>
        ) : null}
        <TextField
          testID="refund-amount"
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          error={amount ? problem : null}
        />
        <Text variant="caption" tone="secondary">
          The money goes back the way they paid.
        </Text>
        <Button
          testID="refund-submit"
          title={cents != null && !problem ? `Refund ${fmt(cents)}` : 'Refund'}
          icon="return-down-back-outline"
          disabled={Boolean(problem)}
          busy={submit.isPending}
          onPress={async () => {
            const yes = await confirmAction({
              title: `Refund ${fmt(cents as number)}?`,
              body: 'A refund cannot be undone.',
              confirm: 'Refund',
              destructive: true,
            })
            if (yes) submit.mutate()
          }}
        />
      </View>
    </Sheet>
  )
}
