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
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'
import { errorText } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import type { OrderDetail } from '../data/orders'
import { checkReceiptRecipient, type ReceiptChannel, receiptChannels, sendReceipt } from '../data/receipts'
import { FilterChips, showError } from '../ui/parts'

/*
 * "Resend receipt" (AGL-3621), as the console's order dialog offers it: by
 * email, or by text when the platform can send one, to the address on the
 * order or one the merchant types. The route keeps the role gate and the
 * per-order hourly limit.
 */

const CHANNEL_LABELS: Record<ReceiptChannel, string> = { email: 'Email', sms: 'Text' }

export function ReceiptSheet({
  visible,
  commerce,
  detail,
  onClose,
}: {
  visible: boolean
  commerce: CommerceMobileContext
  detail: OrderDetail
  onClose: () => void
}) {
  const theme = useMobileTheme()
  const channels = useQuery({
    queryKey: ['commerce', commerce.hostId, 'receipt-channels'],
    queryFn: () => receiptChannels(commerce),
    enabled: visible,
    staleTime: 5 * 60_000,
  })
  const [channel, setChannel] = useState<ReceiptChannel>('email')
  const [to, setTo] = useState('')
  const recipientFor = (next: ReceiptChannel) =>
    String((next === 'sms' ? detail.order.customerPhone : detail.order.customerEmail) ?? '')

  useEffect(() => {
    if (!visible) return
    setChannel('email')
    setTo(recipientFor('email'))
    // Only on opening: what the merchant types after that is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const options = (['email', 'sms'] as const)
    .filter((id) => (channels.data ? channels.data[id] : id === 'email'))
    .map((id) => ({ id, label: CHANNEL_LABELS[id] }))
  const problem = checkReceiptRecipient(channel, to)
  const send = useMutation({
    mutationFn: () => sendReceipt(commerce, { orderId: detail.id, channel, to }),
    onSuccess: () => {
      onClose()
      Alert.alert('Receipt sent', `Sent to ${to.trim()}.`)
    },
    onError: (error) => showError('The receipt was not sent', errorText(error)),
  })

  return (
    <Sheet visible={visible} onClose={onClose} title="Resend receipt">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        {options.length > 1 ? (
          <View style={{ marginHorizontal: -theme.space(2) }}>
            <FilterChips
              testID="receipt-channel"
              options={options}
              value={channel}
              onChange={(next) => {
                setChannel(next)
                setTo(recipientFor(next))
              }}
            />
          </View>
        ) : null}
        {channels.data && !channels.data.email && !channels.data.sms ? (
          <Text tone="error">Receipts cannot be sent right now. Try again later.</Text>
        ) : null}
        <TextField
          testID="receipt-to"
          label={channel === 'sms' ? 'Phone number' : 'Email address'}
          value={to}
          onChangeText={setTo}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={channel === 'sms' ? 'phone-pad' : 'email-address'}
          error={to ? problem : null}
        />
        <Button
          testID="receipt-send"
          title="Send receipt"
          icon="send-outline"
          disabled={Boolean(problem)}
          busy={send.isPending}
          onPress={() => send.mutate()}
        />
      </View>
    </Sheet>
  )
}
