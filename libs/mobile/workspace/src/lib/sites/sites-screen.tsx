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

import { describeHostStatus } from '@aglyn/aglyn/app-utils/host-status'
import { SITE_FILTER_OPTIONS } from '@aglyn/aglyn/app-utils/site-list-query'
import type { MobilePluginContext, MobileScreenProps } from '@aglyn/mobile-plugin-host'
import {
  Chip,
  ChipRow,
  EmptyState,
  ListFooter,
  ListRow,
  SearchField,
  Skeleton,
  SplitView,
  Text,
  useLayout,
} from '@aglyn/mobile-ui'
import { useState } from 'react'
import { FlatList, View } from 'react-native'
import { WORKSPACE_SITE_SCREEN } from '../screen-ids'
import { SiteDetail } from './site-detail'
import { hostDisplayDomain, siteName, statusTone, type HostDoc, type SiteMembershipRow } from './site-model'
import { useHostDoc, useSiteList, type CustomDomainFilter } from './use-sites'

const DOMAIN_CHIPS: ReadonlyArray<{ value: CustomDomainFilter; label: string }> = [
  { value: 'all', label: 'Any domain' },
  ...SITE_FILTER_OPTIONS.hasCustomDomain.map((option) => ({
    value: option.value as CustomDomainFilter,
    label: option.value === 'true' ? 'Custom domain' : 'No custom domain',
  })),
]

/** One site's row: the membership row's name, the host document's status. */
function SiteRow({
  row,
  context,
  selected,
  onPress,
}: {
  row: SiteMembershipRow
  context: MobilePluginContext
  selected: boolean
  onPress: () => void
}) {
  const host = useHostDoc(context.firestore, row.$id)
  const status = host.data ? describeHostStatus(host.data as HostDoc) : null
  return (
    <ListRow
      testID={`site-${row.$id}`}
      icon="globe-outline"
      title={siteName(row)}
      subtitle={hostDisplayDomain((host.data as HostDoc | null) ?? row) ?? undefined}
      selected={selected}
      onPress={onPress}
      trailing={status ? <Chip label={status.label} tone={statusTone(status)} /> : null}
    />
  )
}

export default function SitesScreen({ context }: MobileScreenProps) {
  const { split } = useLayout()
  const [search, setSearch] = useState('')
  const [customDomain, setCustomDomain] = useState<CustomDomainFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const list = useSiteList({
    firestore: context.firestore,
    uid: context.uid,
    orgId: context.orgId,
    search,
    customDomain,
  })
  const filtering = customDomain !== 'all' || search.trim() !== ''

  const open = (row: SiteMembershipRow) => {
    if (split) setSelected(row.$id)
    else context.navigate(WORKSPACE_SITE_SCREEN, { hostId: row.$id })
  }

  const body = !list.ready ? (
    <View style={{ padding: 16, gap: 12 }} testID="sites-loading">
      <Skeleton height={44} />
      <Skeleton height={44} />
      <Skeleton height={44} />
    </View>
  ) : list.error ? (
    <EmptyState icon="warning-outline" title="These sites could not be loaded" body="Check your connection and try again." />
  ) : (
    <FlatList
      testID="sites-list"
      data={list.rows}
      keyExtractor={(row) => row.$id}
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        filtering ? (
          <EmptyState icon="search-outline" title="No sites match these filters" />
        ) : (
          <EmptyState
            icon="globe-outline"
            title="No sites yet"
            body="Sites you create in the console show up here."
          />
        )
      }
      ListFooterComponent={<ListFooter hasMore={list.hasMore} onLoadMore={list.loadMore} />}
      renderItem={({ item }) => (
        <SiteRow row={item} context={context} selected={split && item.$id === selected} onPress={() => open(item)} />
      )}
    />
  )

  const listPane = (
    <View style={{ flex: 1 }}>
      <SearchField
        testID="sites-search"
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name, slug or domain"
      />
      <ChipRow<CustomDomainFilter> testID="sites-domain" options={DOMAIN_CHIPS} value={customDomain} onChange={setCustomDomain} />
      {list.plan.notices.map((notice) => (
        <Text key={notice} variant="caption" tone="secondary" style={{ paddingHorizontal: 16 }}>
          {notice}
        </Text>
      ))}
      {body}
    </View>
  )

  return (
    <SplitView
      list={listPane}
      detail={
        selected ? (
          <SiteDetail key={selected} hostId={selected} context={context} />
        ) : (
          <EmptyState icon="globe-outline" title="Pick a site to see it here" />
        )
      }
    />
  )
}
