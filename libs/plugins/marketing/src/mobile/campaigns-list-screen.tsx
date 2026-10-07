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

/**
 * The emails a site sent or scheduled — or, with no site picked, every site's
 * on the workspace — newest first (AGL-3622). The console's Emails list:
 * its Status filter and its subject search are clauses on the one Firestore
 * query it plans, so a match on page four is found. A phone pushes an email's
 * report; a tablet shows it beside the list.
 */

import { useOrgAccess } from '@aglyn/mobile-core'
import type { MobilePluginContext, MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, ChipRow, EmptyState, ListFooter, ListRow, SearchField, Skeleton, SplitView, useLayout } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { FlatList, View } from 'react-native'
import { emailListTimeMs } from '../lib/model/email-record'
import { CampaignSendDetail } from './campaign-send-detail'
import { CAMPAIGN_STATUS_FILTERS, campaignSendControls, useCampaignSends, type CampaignSendRecord } from './campaign-sends'
import { MARKETING_CAMPAIGN_SCREEN } from './screen-ids'

const ICON: Record<string, string> = {
  draft: 'document-text-outline',
  held: 'hand-left-outline',
  pending: 'time-outline',
  sending: 'paper-plane-outline',
  sent: 'checkmark-circle-outline',
  stopped: 'stop-circle-outline',
}

function rowSubtitle(send: CampaignSendRecord): string {
  const { display } = campaignSendControls(send)
  const at = emailListTimeMs(send)
  return at ? `${display.label} · ${new Date(at).toLocaleDateString()}` : display.label
}

export function CampaignSendsList({
  context,
  selected,
  onSelect,
}: {
  context: MobilePluginContext
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { firestore, orgId, hostId, uid } = context
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const access = useOrgAccess(firestore, orgId, uid)
  /*
   * Over the workspace the read is the console's org Emails page: unscoped,
   * which the rules admit only for an org-wide member. Anyone else picks a
   * site first, as the console sends them to that site's Emails page.
   */
  const needsSite = !hostId && access.loaded && !access.orgWide
  const list = useCampaignSends({
    firestore,
    orgId,
    hostId,
    status,
    search,
    enabled: Boolean(orgId) && (Boolean(hostId) || access.orgWide),
  })
  const filtering = status !== 'all' || Boolean(search.trim())

  if (!orgId) return <EmptyState icon="business-outline" title="Pick a workspace to see its emails" />
  if (needsSite) {
    return (
      <EmptyState
        icon="globe-outline"
        title="Choose a site to see its emails"
        body="Your access is to particular sites, so emails are listed one site at a time."
      />
    )
  }

  const header = (
    <View>
      <SearchField testID="campaigns-search" value={search} onChangeText={setSearch} placeholder="Search subjects" />
      <ChipRow testID="campaigns-status" options={CAMPAIGN_STATUS_FILTERS} value={status} onChange={setStatus} />
    </View>
  )

  if (!list.ready && !list.rows.length) {
    return (
      <View>
        {header}
        <View style={{ padding: 16, gap: 12 }} testID="campaigns-loading">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </View>
      </View>
    )
  }

  return (
    <FlatList
      testID="campaigns-list"
      data={list.error ? [] : list.rows}
      keyExtractor={(row) => row.$id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.error ? (
          <EmptyState icon="warning-outline" title="Could not load emails" body={list.error.message} />
        ) : filtering ? (
          <EmptyState icon="search-outline" title="No emails match" body="Try another status or fewer words." />
        ) : (
          <EmptyState icon="mail-outline" title="No emails yet" body="Emails you write in the console show up here." />
        )
      }
      onEndReached={list.loadMore}
      ListFooterComponent={
        <ListFooter hasMore={list.hasMore} onLoadMore={list.loadMore}>
          <Button
            title="Write an email in the console"
            variant="outlined"
            icon="open-outline"
            onPress={() => context.openConsolePath('/emails/messages', hostId ? 'site' : 'org')}
          />
        </ListFooter>
      }
      renderItem={({ item }) => {
        const { display } = campaignSendControls(item)
        return (
          <ListRow
            testID={`campaign-${item.$id}`}
            icon={ICON[display.state] ?? 'mail-outline'}
            title={String(item.subject || 'Untitled email')}
            subtitle={rowSubtitle(item)}
            selected={item.$id === selected}
            onPress={() => onSelect(item.$id)}
          />
        )
      }}
    />
  )
}

export default function CampaignsListScreen({ context, params }: MobileScreenProps) {
  const { split } = useLayout()
  const [selected, setSelected] = useState<string | null>(params.emailId ?? null)
  return (
    <SplitView
      list={
        <CampaignSendsList
          context={context}
          selected={split ? selected : null}
          onSelect={(id) => (split ? setSelected(id) : context.navigate(MARKETING_CAMPAIGN_SCREEN, { emailId: id }))}
        />
      }
      detail={<CampaignSendDetail context={context} sendId={selected} />}
    />
  )
}
