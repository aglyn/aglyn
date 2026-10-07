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
import { Button, Card, EmptyState, Screen, Skeleton, Text, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { View } from 'react-native'
import { errorText, useCommerceContext } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import { money, storeSettingsQuery } from '../data/orders'
import { type SalesRange, salesReportQuery } from '../data/sales'
import { conversionPct, trafficQuery } from '../data/traffic'
import { COMMERCE_ORDERS_SCREEN } from '../screen-ids'
import { Bars } from '../ui/bars'
import { Fact, FilterChips } from '../ui/parts'

/*
 * Sales and traffic (AGL-3621): revenue, orders and the average order over
 * the last 7 or 30 days against the window before, revenue by day, by
 * channel and by product, and the site's visitors with the share who
 * bought. Test-mode orders never count; a window too large to read whole
 * says so rather than showing a smaller number as if it were the total.
 */

const RANGES: ReadonlyArray<{ id: `${SalesRange}`; label: string }> = [
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
]

function Tile({ label, value, delta, testID }: { label: string; value: string; delta?: string | null; testID?: string }) {
  const theme = useMobileTheme()
  return (
    <View
      testID={testID}
      style={{
        flexGrow: 1,
        flexBasis: 140,
        padding: theme.space(1.5),
        gap: theme.space(0.5),
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.background.paper,
      }}
    >
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="heading">{value}</Text>
      {delta ? (
        <Text variant="caption" tone="secondary">
          {delta}
        </Text>
      ) : null}
    </View>
  )
}

export function deltaLine(pct: number | null, days: number): string | null {
  return pct == null ? null : `${pct > 0 ? '+' : ''}${pct}% vs prior ${days} days`
}

export default function SalesScreen({ context }: MobileScreenProps) {
  const commerce = useCommerceContext(context)
  if (!commerce) return <EmptyState icon="globe-outline" title="Pick a site to see its sales" />
  return <SalesReport context={context} commerce={commerce} />
}

function SalesReport({ context, commerce }: { context: MobileScreenProps['context']; commerce: CommerceMobileContext }) {
  const theme = useMobileTheme()
  const { split } = useLayout()
  const [range, setRange] = useState<`${SalesRange}`>('7')
  const days = Number(range) as SalesRange
  const report = useQuery(salesReportQuery(commerce, days))
  const traffic = useQuery(trafficQuery(commerce, days))
  const store = useQuery(storeSettingsQuery(commerce))

  const currency = store.data?.currency
  const fmt = (cents: number) => money(cents, currency ? { currency } : null)
  const data = report.data
  const rate = data && traffic.data ? conversionPct(data.current.orders, traffic.data.visitors) : null

  return (
    <Screen>
      <View style={{ marginHorizontal: -theme.space(2) }}>
        <FilterChips testID="sales-range" options={RANGES} value={range} onChange={setRange} />
      </View>
      {report.isPending ? (
        <View style={{ gap: theme.space(1.5) }}>
          <Skeleton height={88} />
          <Skeleton height={140} />
        </View>
      ) : !data ? (
        <EmptyState
          icon="warning-outline"
          title="Could not load sales"
          body={errorText(report.error)}
          action={<Button title="Try again" onPress={() => void report.refetch()} />}
        />
      ) : (
        <View style={{ gap: theme.space(2) }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
            <Tile
              testID="sales-revenue"
              label="Revenue"
              value={fmt(data.current.revenueCents)}
              delta={deltaLine(data.revenueDeltaPct, days)}
            />
            <Tile
              testID="sales-orders"
              label="Orders"
              value={String(data.current.orders)}
              delta={deltaLine(data.ordersDeltaPct, days)}
            />
            <Tile testID="sales-average" label="Average order" value={fmt(data.current.averageCents)} />
            <Tile
              testID="sales-visitors"
              label="Visitors"
              value={traffic.data ? traffic.data.visitors.toLocaleString() : '—'}
              delta={rate == null ? null : `${rate}% bought`}
            />
          </View>
          {data.capped ? (
            <Text variant="caption" tone="secondary">
              This window has more orders than the app reads at once; the figures cover the most recent ones. The console has the full report.
            </Text>
          ) : null}
          <View style={{ flexDirection: split ? 'row' : 'column', gap: theme.space(2) }}>
            <Card title="Revenue by day" style={split ? { flex: 1 } : undefined}>
              <Bars
                testID="sales-days"
                bars={data.days.map((day) => ({
                  key: String(day.startMs),
                  value: day.revenueCents,
                  label: new Date(day.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                }))}
                summary={data.days
                  .map(
                    (day) =>
                      `${new Date(day.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${fmt(day.revenueCents)}`,
                  )
                  .join(', ')}
              />
            </Card>
            {traffic.data ? (
              <Card title="Visitors by day" style={split ? { flex: 1 } : undefined}>
                <Bars
                  testID="sales-traffic"
                  bars={traffic.data.days.map((day) => ({ key: day.day, value: day.visitors, label: day.day.slice(5) }))}
                  summary={traffic.data.days.map((day) => `${day.day}: ${day.visitors} visitors`).join(', ')}
                />
                <Fact label="Page views" value={traffic.data.views.toLocaleString()} />
              </Card>
            ) : null}
          </View>
          <View style={{ flexDirection: split ? 'row' : 'column', gap: theme.space(2) }}>
            <Card title="By channel" style={split ? { flex: 1 } : undefined}>
              {data.channels.length ? (
                data.channels.map((channel) => <Fact key={channel.channel} label={channel.label} value={fmt(channel.revenueCents)} />)
              ) : (
                <Text tone="secondary">No sales in this window.</Text>
              )}
            </Card>
            <Card title="Top products" style={split ? { flex: 1 } : undefined}>
              {data.topProducts.length ? (
                data.topProducts.map((product) => (
                  <Fact key={product.productId} label={`${product.name} · ${product.units} sold`} value={fmt(product.cents)} />
                ))
              ) : (
                <Text tone="secondary">No sales in this window.</Text>
              )}
            </Card>
          </View>
          <Button
            title="See orders"
            variant="outlined"
            icon="receipt-outline"
            onPress={() => context.navigate(COMMERCE_ORDERS_SCREEN)}
          />
        </View>
      )}
    </Screen>
  )
}
