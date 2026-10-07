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
 * A SITE'S FORMS (AGL-3622): the console's Forms list, natively. Each row
 * says what the form has collected; a form opens its figures and its
 * submissions. Status and the search are the console's, on one Firestore
 * query. Creating and editing a form opens the console, which owns the
 * designer and the plan's form allowance.
 */

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import {
  Button,
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
import { useEffect, useState } from 'react'
import { FlatList, View } from 'react-native'
import { FORM_STATUS_OPTIONS } from '../lib/constants/form-list-query'
import { FormDetail } from './form-detail'
import { FORM_SCREEN } from './screen-ids'
import { recorded, useFormList, type FormRow, type FormStatusFilter } from './use-forms'

const SEARCH_SETTLE_MS = 300

/** What a form row says under its name. */
export function formRowSummary(row: FormRow): string {
  const submissions = recorded(row.stats?.submissions)
  const lastAt = recorded(row.stats?.lastSubmissionAtMs)
  const count =
    submissions == null || submissions === 0
      ? 'No submissions yet'
      : `${submissions.toLocaleString()} ${submissions === 1 ? 'submission' : 'submissions'}`
  return lastAt == null ? count : `${count} · last ${new Date(lastAt).toLocaleDateString()}`
}

export default function FormsListScreen({ params, context }: MobileScreenProps) {
  const theme = useMobileTheme()
  const { split } = useLayout()
  const [status, setStatus] = useState<FormStatusFilter>('false')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [text])
  const list = useFormList(context.firestore, context.hostId, status, search)
  const [selected, setSelected] = useState<string | null>(params['formId'] || null)

  const open = (formId: string) => {
    if (split) setSelected(formId)
    else context.navigate(FORM_SCREEN, { formId })
  }
  const filtering = status !== 'false' || search.trim().length > 0
  const notices = [...list.plan.notices, ...list.plan.refused.map((refusal) => refusal.reason)]

  const body = !list.ready && !list.rows.length ? (
    <View style={{ padding: theme.space(2), gap: theme.space(1.5) }} testID="forms-loading">
      <Skeleton height={44} />
      <Skeleton height={44} />
      <Skeleton height={44} />
    </View>
  ) : list.error ? (
    <EmptyState icon="warning-outline" title="Could not load this site's forms" />
  ) : (
    <FlatList
      data={list.rows}
      keyExtractor={(row) => row.$id}
      ListEmptyComponent={
        <EmptyState
          icon="document-text-outline"
          title={filtering ? 'No forms match these filters' : 'No forms yet'}
          body={filtering ? undefined : 'Forms you create in the console show up here.'}
        />
      }
      ListFooterComponent={
        <ListFooter hasMore={list.hasMore} loading={!list.ready} onLoadMore={list.loadMore}>
          <Button
            title="Manage forms in the console"
            variant="outlined"
            icon="open-outline"
            onPress={() => context.openConsolePath('/forms', 'site')}
          />
        </ListFooter>
      }
      onEndReached={list.loadMore}
      renderItem={({ item }) => (
        <ListRow
          testID={`form-row-${item.$id}`}
          icon={item.retired ? 'archive-outline' : 'document-text-outline'}
          title={item.displayName || item.$id}
          subtitle={formRowSummary(item)}
          selected={item.$id === selected}
          onPress={() => open(item.$id)}
        />
      )}
    />
  )

  return (
    <SplitView
      list={
        <View style={{ flex: 1, backgroundColor: theme.colors.background.default }}>
          <SearchField testID="forms-search" value={text} onChangeText={setText} placeholder="Search forms" />
          <ChipRow<FormStatusFilter>
            testID="forms-status"
            options={FORM_STATUS_OPTIONS as { value: FormStatusFilter; label: string }[]}
            value={status}
            onChange={setStatus}
          />
          {notices.map((notice) => (
            <Text key={notice} variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(2) }}>
              {notice}
            </Text>
          ))}
          {body}
        </View>
      }
      detail={<FormDetail context={context} formId={selected} />}
    />
  )
}
