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
import { EmptyState, ListRow, SplitView, TextField, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useCommerceContext } from '../commerce-context'
import type { CommerceMobileContext } from '../data/context'
import {
  money,
  ORDER_FILTERS,
  type OrderFilterId,
  type OrderRow,
  ordersListQuery,
  storeSettingsQuery,
} from '../data/orders'
import { COMMERCE_ORDER_SCREEN } from '../screen-ids'
import { FilterChips, Pill } from '../ui/parts'
import { PagedList } from '../ui/paged-list'
import { OrderDetailPanel } from './order-detail'

/*
 * The site's orders (AGL-3621): the console's order list, one status chip
 * per question a merchant asks of it, and the order itself beside the list
 * on a tablet or pushed over it on a phone.
 */

const SEARCH_SETTLE_MS = 350

export function orderSubtitle(row: OrderRow, currency: string | undefined): string {
  const when = new Date(row.createdAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const items = `${row.itemCount} item${row.itemCount === 1 ? '' : 's'}`
  return [row.statusLabel, items, money(row.netCents, currency ? { currency } : null), when].join(' · ')
}

function useSettled(value: string): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return settled
}

export function OrdersList({
  commerce,
  selectedId,
  onOpen,
  initialFilter = 'all',
  customer,
}: {
  commerce: CommerceMobileContext
  selectedId: string | null
  onOpen: (orderId: string) => void
  initialFilter?: OrderFilterId
  customer?: string
}) {
  const theme = useMobileTheme()
  const [filter, setFilter] = useState<OrderFilterId>(initialFilter)
  const [text, setText] = useState('')
  const search = useSettled(text.trim())
  const store = useQuery(storeSettingsQuery(commerce))
  const query = useInfiniteQuery(ordersListQuery(commerce, { filter, search, ...(customer ? { customer } : {}) }))
  const currency = store.data?.currency
  return (
    <PagedList<OrderRow>
      testID="orders-list"
      query={query}
      failed="Could not load this site's orders"
      header={
        <View>
          <View style={{ paddingHorizontal: theme.space(2), paddingTop: theme.space(2) }}>
            <TextField
              label="Search orders"
              placeholder="Order number, email or product"
              value={text}
              onChangeText={setText}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              testID="orders-search"
            />
          </View>
          <FilterChips testID="orders-filter" options={ORDER_FILTERS} value={filter} onChange={setFilter} />
        </View>
      }
      empty={
        <EmptyState
          icon="receipt-outline"
          title={search || filter !== 'all' ? 'No orders match' : 'No orders yet'}
          body={search || filter !== 'all' ? 'Try another filter or search.' : 'Orders from your store and register show up here.'}
        />
      }
      renderItem={(row) => (
        <ListRow
          testID={`order-${row.id}`}
          icon={row.disputeOpen ? 'alert-circle-outline' : 'receipt-outline'}
          title={`#${row.label} · ${row.customer}`}
          subtitle={orderSubtitle(row, currency)}
          selected={row.id === selectedId}
          onPress={() => onOpen(row.id)}
          trailing={row.testMode ? <Pill label="Test" tone="warning" /> : row.disputeOpen ? <Pill label="Dispute" tone="error" /> : undefined}
        />
      )}
    />
  )
}

export default function OrdersScreen({ context, params }: MobileScreenProps) {
  const commerce = useCommerceContext(context)
  const { split } = useLayout()
  const [selected, setSelected] = useState<string | null>(params['orderId'] ?? null)
  const initialFilter = ORDER_FILTERS.some((entry) => entry.id === params['filter'])
    ? (params['filter'] as OrderFilterId)
    : 'all'
  if (!commerce) return <EmptyState icon="globe-outline" title="Pick a site to see its orders" />
  const open = (orderId: string) => {
    if (split) setSelected(orderId)
    else context.navigate(COMMERCE_ORDER_SCREEN, { orderId })
  }
  return (
    <SplitView
      list={
        <OrdersList
          commerce={commerce}
          selectedId={split ? selected : null}
          onOpen={open}
          initialFilter={initialFilter}
          customer={params['customer']}
        />
      }
      detail={
        selected ? (
          <OrderDetailPanel key={selected} context={context} commerce={commerce} orderId={selected} />
        ) : (
          <EmptyState icon="receipt-outline" title="Pick an order to see it here" />
        )
      }
    />
  )
}
