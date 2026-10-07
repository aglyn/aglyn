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

import type { MobileWidgetProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useQuery } from '@tanstack/react-query'
import { View } from 'react-native'
import { useCommerceContext } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import { money, storeSettingsQuery } from '../data/orders'
import { salesReportQuery, todaySalesQuery } from '../data/sales'
import { COMMERCE_ORDERS_SCREEN, COMMERCE_SALES_SCREEN } from '../screen-ids'
import { Bars } from '../ui/bars'
import { Fact } from '../ui/parts'
import { deltaLine } from './sales-screen'

/*
 * The commerce glance on the app's home (AGL-3621): today's takings and
 * what is waiting to ship, and the last seven days at a glance. Each opens
 * the screen that answers the next question.
 */

function TodayCard({ context, commerce }: MobileWidgetProps & { commerce: CommerceMobileContext }) {
  const theme = useMobileTheme()
  const today = useQuery(todaySalesQuery(commerce))
  const store = useQuery(storeSettingsQuery(commerce))
  const currency = store.data?.currency
  return (
    <Card title="Today">
      {today.data ? (
        <View style={{ gap: theme.space(0.5) }}>
          <Text variant="title" testID="today-revenue">
            {money(today.data.revenueCents, currency ? { currency } : null)}
          </Text>
          <Fact label="Orders" value={String(today.data.orders)} />
          <Fact label="To ship" value={String(today.data.toFulfill)} />
          {today.data.toFulfill ? (
            <Button
              testID="today-to-ship"
              title="Ship orders"
              variant="text"
              icon="cube-outline"
              onPress={() => context.navigate(COMMERCE_ORDERS_SCREEN, { filter: 'unfulfilled' })}
            />
          ) : null}
        </View>
      ) : today.isError ? (
        <Text tone="secondary">Sales could not be loaded.</Text>
      ) : (
        <Skeleton height={64} />
      )}
    </Card>
  )
}

export function TodayWidget({ context }: MobileWidgetProps) {
  const commerce = useCommerceContext(context)
  return commerce ? <TodayCard context={context} commerce={commerce} /> : null
}

function TrendCard({ context, commerce }: MobileWidgetProps & { commerce: CommerceMobileContext }) {
  const report = useQuery(salesReportQuery(commerce, 7))
  const store = useQuery(storeSettingsQuery(commerce))
  const currency = store.data?.currency
  const fmt = (cents: number) => money(cents, currency ? { currency } : null)
  const data = report.data
  return (
    <Card
      title="Last 7 days"
      actions={<Button title="Details" variant="text" onPress={() => context.navigate(COMMERCE_SALES_SCREEN)} />}
    >
      {data ? (
        <View>
          <Text variant="heading">{fmt(data.current.revenueCents)}</Text>
          {deltaLine(data.revenueDeltaPct, 7) ? (
            <Text variant="caption" tone="secondary">
              {deltaLine(data.revenueDeltaPct, 7)}
            </Text>
          ) : null}
          <Bars
            height={48}
            bars={data.days.map((day) => ({
              key: String(day.startMs),
              value: day.revenueCents,
              label: new Date(day.startMs).toLocaleDateString(undefined, { weekday: 'short' }),
            }))}
            summary={`Revenue over the last 7 days: ${fmt(data.current.revenueCents)}`}
          />
        </View>
      ) : report.isError ? (
        <Text tone="secondary">Sales could not be loaded.</Text>
      ) : (
        <Skeleton height={80} />
      )}
    </Card>
  )
}

export function SalesTrendWidget({ context }: MobileWidgetProps) {
  const commerce = useCommerceContext(context)
  return commerce ? <TrendCard context={context} commerce={commerce} /> : null
}
