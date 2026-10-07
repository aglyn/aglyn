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

import { searchWords } from '@aglyn/mobile-core'
import type { MobilePluginContext, MobileScreenProps } from '@aglyn/mobile-plugin-host'
import {
  Button,
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
  useMobileTheme,
} from '@aglyn/mobile-ui'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, ScrollView, View } from 'react-native'
import {
  CRM_LIST_KINDS,
  CRM_LIST_LABELS,
  CRM_STATUS_CHOICES,
  crmDefaultStatus,
  crmListSpec,
  crmOffersMine,
  type CrmListKind,
  isCrmListKind,
} from './crm-lists'
import { CRM_SCOPE_GAP_COPY, type CrmMobileScope, crmSuiteIncluded, isCrmMobileScope } from './crm-mobile-scope'
import { crmSubtitle, crmTitle, type CrmPresentContext } from './crm-present'
import { CrmRecordDetail } from './crm-record-detail'
import { CrmSuiteLocked } from './crm-suite-locked'
import { CRM_RECORD_SCREENS } from './screen-ids'
import { useCrmList } from './use-crm-list'
import { useCrmMobileScope } from './use-crm-mobile-scope'
import { useCrmPipelines, useCrmRoster, useLeadStatusPicklist } from './use-crm-reads'

/*
 * THE CRM TAB (AGL-3622): leads, contacts, companies and deals behind one
 * switcher, each list on the console section's own query — the search box
 * and the chips are clauses of that query, never a match over loaded rows.
 * Phones push a record; tablets show it beside the list.
 */

/** How long the search waits for typing to settle before it asks. */
const SEARCH_SETTLE_MS = 300

const LIST_ICONS: Readonly<Record<CrmListKind, string>> = {
  leads: 'flash-outline',
  contacts: 'person-outline',
  companies: 'business-outline',
  deals: 'cash-outline',
}

/**
 * The list a screen opens on: its own, a link's `list`, else Contacts — the
 * section a bare `/crm` lands on in the console (the rail's first).
 */
export function initialCrmList(fixed: CrmListKind | undefined, params: MobileScreenProps['params']): CrmListKind {
  if (fixed) return fixed
  const asked = params['list']
  return isCrmListKind(asked) ? asked : 'contacts'
}

function CrmList({
  kind,
  context,
  selectedId,
  onOpen,
}: {
  kind: CrmListKind
  context: MobilePluginContext
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const theme = useMobileTheme()
  const { scope, org } = useCrmMobileScope(context.firestore, context.orgId, context.hostId, context.uid)
  // Nothing is read until the plan is known to carry the CRM.
  const included = crmSuiteIncluded(org)
  const ready = isCrmMobileScope(scope) && included === true
  const [status, setStatus] = useState(() => crmDefaultStatus(kind))
  const [mine, setMine] = useState(false)
  const [pipelinePick, setPipelinePick] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [search, setSearch] = useState<string[]>([])
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchWords(text)), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [text])
  const statuses = useLeadStatusPicklist(context.firestore, ready && kind === 'leads' ? context.orgId : null)
  const pipelines = useCrmPipelines(
    context.firestore,
    kind === 'deals' ? context.orgId : null,
    ready ? (scope as CrmMobileScope).visibleTo : undefined,
  )
  const roster = useCrmRoster(context.api, context.orgId, context.uid)
  const pipelineId = pipelinePick ?? pipelines.defaultPipeline?.$id ?? null

  const spec = useMemo(
    () =>
      ready
        ? crmListSpec({ kind, scope: scope as CrmMobileScope, uid: context.uid, filters: { status, mine, pipelineId }, search })
        : null,
    [ready, kind, scope, context.uid, status, mine, pipelineId, search],
  )
  const list = useCrmList(context.firestore, spec)
  const present: CrmPresentContext = {
    leadStatuses: statuses.picklist,
    viewing: ready ? (scope as CrmMobileScope).consentGroup : null,
    org,
    pipelineById: pipelines.byId,
    ownerLabel: roster.labelFor,
  }

  if (included === false) return <CrmSuiteLocked context={context} />
  if (!isCrmMobileScope(scope) || !ready) {
    const gap = CRM_SCOPE_GAP_COPY[isCrmMobileScope(scope) ? 'loading' : scope]
    return <EmptyState icon="people-outline" title={gap.title} body={gap.body} />
  }

  const filtering = status !== crmDefaultStatus(kind) || mine || search.length > 0
  const header = (
    <View>
      <SearchField
        testID="crm-search"
        value={text}
        onChangeText={setText}
        placeholder={`Search ${CRM_LIST_LABELS[kind].toLowerCase()}`}
      />
      <ChipRow testID="crm-status" options={CRM_STATUS_CHOICES[kind]} value={status} onChange={setStatus} />
      {crmOffersMine(kind) || (kind === 'deals' && pipelines.active.length > 1) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.space(1), paddingHorizontal: theme.space(2), paddingBottom: theme.space(1) }}
        >
          {crmOffersMine(kind) ? (
            <Chip testID="crm-mine" icon="person-circle-outline" label="Mine" selected={mine} onPress={() => setMine(!mine)} />
          ) : null}
          {kind === 'deals' && pipelines.active.length > 1
            ? pipelines.active.map((pipeline) => (
                <Chip
                  key={pipeline.$id}
                  testID={`crm-pipeline-${pipeline.$id}`}
                  icon="git-commit-outline"
                  label={pipeline.name}
                  selected={pipeline.$id === pipelineId}
                  onPress={() => setPipelinePick(pipeline.$id)}
                />
              ))
            : null}
        </ScrollView>
      ) : null}
      {list.notices.map((notice) => (
        <Text key={notice} testID="crm-list-notice" variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(2) }}>
          {notice}
        </Text>
      ))}
    </View>
  )

  if (kind === 'deals' && pipelines.ready && !pipelines.defaultPipeline) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <EmptyState
          icon="cash-outline"
          title="No pipeline yet"
          body="Open Deals in the console once to set up the Sales pipeline."
          action={
            <Button title="Open Deals in the console" variant="outlined" onPress={() => context.openConsolePath('/crm/deals', scope.hostId ? 'site' : 'org')} />
          }
        />
      </View>
    )
  }

  const body =
    !list.ready && !list.rows.length && !list.error ? (
      <View style={{ padding: theme.space(2), gap: theme.space(1.5) }} testID="crm-list-loading">
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </View>
    ) : list.error ? (
      <EmptyState icon="warning-outline" title={`Could not load ${CRM_LIST_LABELS[kind].toLowerCase()}`} body={list.error.message} />
    ) : (
      <FlatList
        data={list.rows}
        keyExtractor={(row) => row.$id}
        ListEmptyComponent={
          <EmptyState
            icon={LIST_ICONS[kind]}
            title={filtering ? `No ${CRM_LIST_LABELS[kind].toLowerCase()} match these filters` : `No ${CRM_LIST_LABELS[kind].toLowerCase()} yet`}
          />
        }
        ListFooterComponent={<ListFooter hasMore={list.hasMore} loading={!list.ready} onLoadMore={list.loadMore} />}
        onEndReached={list.hasMore ? list.loadMore : undefined}
        renderItem={({ item }) => (
          <ListRow
            testID={`crm-row-${item.$id}`}
            icon={LIST_ICONS[kind]}
            title={crmTitle(kind, item, present)}
            subtitle={crmSubtitle(kind, item, present)}
            selected={item.$id === selectedId}
            onPress={() => onOpen(item.$id)}
          />
        )}
      />
    )

  return (
    <View style={{ flex: 1 }}>
      {header}
      {body}
    </View>
  )
}

/** The CRM home, or one list when the screen was opened for it. */
export function CrmHome({ params, context, fixed }: MobileScreenProps & { fixed?: CrmListKind }) {
  const { split } = useLayout()
  const [kind, setKind] = useState<CrmListKind>(() => initialCrmList(fixed, params))
  const [selected, setSelected] = useState<string | null>(null)
  const open = (id: string) => {
    if (split) setSelected(id)
    else context.navigate(CRM_RECORD_SCREENS[kind], { recordId: id })
  }
  const list = (
    <View style={{ flex: 1 }}>
      <ChipRow<CrmListKind>
        testID="crm-lists"
        options={CRM_LIST_KINDS.map((value) => ({ value, label: CRM_LIST_LABELS[value] }))}
        value={kind}
        onChange={(value) => {
          setKind(value)
          setSelected(null)
        }}
      />
      {/* Keyed by the list: each keeps its own chips and search from a fresh start. */}
      <CrmList key={kind} kind={kind} context={context} selectedId={selected} onOpen={open} />
    </View>
  )
  const detail = selected ? (
    <CrmRecordDetail key={`${kind}/${selected}`} kind={kind} id={selected} context={context} />
  ) : (
    <EmptyState icon={LIST_ICONS[kind]} title={`Pick one of the ${CRM_LIST_LABELS[kind].toLowerCase()} to see it here`} />
  )
  return <SplitView list={list} detail={detail} />
}

export default function CrmHomeScreen(props: MobileScreenProps) {
  return <CrmHome {...props} />
}
export const LeadsScreen = (props: MobileScreenProps) => <CrmHome {...props} fixed="leads" />
export const ContactsScreen = (props: MobileScreenProps) => <CrmHome {...props} fixed="contacts" />
export const CompaniesScreen = (props: MobileScreenProps) => <CrmHome {...props} fixed="companies" />
export const DealsScreen = (props: MobileScreenProps) => <CrmHome {...props} fixed="deals" />
