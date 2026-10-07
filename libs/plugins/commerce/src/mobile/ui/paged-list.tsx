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

import { EmptyState, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native'
import type { ListPage } from '../data/list-page'

/*
 * One console list on the phone (AGL-3621): pages read as the person
 * scrolls, pull to re-read, and whatever the query planner could not put on
 * the query said above the rows instead of silently dropped.
 */

export function planMessages(page: ListPage<unknown> | undefined): string[] {
  if (!page) return []
  return [...page.plan.refused.map((refusal) => refusal.reason), ...page.plan.notices]
}

export function PagedList<T extends { id: string }>({
  query,
  renderItem,
  header,
  empty,
  failed,
  testID,
}: {
  query: UseInfiniteQueryResult<InfiniteData<ListPage<T>>>
  renderItem: (row: T) => ReactElement
  header?: ReactNode
  empty: ReactElement
  failed: string
  testID?: string
}) {
  const theme = useMobileTheme()
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? []
  const messages = planMessages(query.data?.pages[0])
  const top = (
    <View>
      {header}
      {messages.map((message) => (
        <Text key={message} variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(2) }}>
          {message}
        </Text>
      ))}
    </View>
  )
  if (query.isPending) {
    return (
      <View testID={testID ? `${testID}-loading` : undefined}>
        {top}
        <View style={{ padding: theme.space(2), gap: theme.space(1.5) }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </View>
      </View>
    )
  }
  if (query.isError && !rows.length) {
    return (
      <View>
        {top}
        <EmptyState icon="warning-outline" title={failed} body={(query.error as Error | null)?.message} />
      </View>
    )
  }
  return (
    <FlatList
      testID={testID}
      data={rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => renderItem(item)}
      ListHeaderComponent={top}
      ListEmptyComponent={empty}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
      }}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} />
      }
      ListFooterComponent={
        query.isFetchingNextPage ? <ActivityIndicator style={{ padding: theme.space(2) }} /> : null
      }
    />
  )
}
