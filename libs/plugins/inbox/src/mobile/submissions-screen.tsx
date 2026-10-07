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
 * THE INBOX (AGL-3622): the form messages a site collected, newest first,
 * each a thread of the message and the replies sent to it.
 *
 * The console's Submissions section, natively: the same query (Read, and
 * the search over the words of the message, on one Firestore query), the
 * organization's every-site list for a member who reaches every site, and
 * one form's submissions when the Forms screens hand a form over. Phones
 * push the reader; tablets show it beside the list. Members & leads and
 * Campaigns, the Inbox's other sections, open in the console.
 *
 * A link may name one submission (`?submission=`): the console's own record
 * address, `/{org}/hosts/{site}/inbox/submissions?submission={id}`, or the
 * host-link shape a notification stores, `/{hostId}/inbox/submissions?…`,
 * whose first segment is the site's id rather than a workspace's slug.
 */

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { searchWords, useOrgAccess } from '@aglyn/mobile-core'
import {
  Button,
  ChipRow,
  EmptyState,
  Icon,
  ListFooter,
  ListRow,
  SearchField,
  Skeleton,
  SplitView,
  Text,
  useLayout,
  useMobileTheme,
} from '@aglyn/mobile-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, View } from 'react-native'
import { relativeTime, submissionSender } from '../lib/model/submission-presenter'
import { INBOX_SUBMISSION_SCREEN } from './screen-ids'
import { SubmissionDetail } from './submission-detail'
import {
  SUBMISSION_READ_CHOICES,
  messageTextOf,
  receivedAtMs,
  submissionListSpec,
  submissionSite,
  type SubmissionReadFilter,
  type SubmissionScope,
} from './submission-query'
import { useSubmissionList } from './use-submissions'

/** How long the search waits for typing to settle before it asks. */
const SEARCH_SETTLE_MS = 300

/**
 * The site a submission link names: the picked site for a console address,
 * or the first segment of a notification's host-link (`/{hostId}/…`), which
 * reaches the deep link as `orgSlug` with no `hostSlug` beside it.
 */
export function linkedSubmissionSite(
  params: MobileScreenProps['params'],
  context: Pick<MobileScreenProps['context'], 'hostId' | 'orgSlug'>,
): string | null {
  if (!params['submission']) return null
  const first = params['orgSlug']
  if (first && !params['hostSlug'] && first !== context.orgSlug) return first
  return context.hostId
}

export default function SubmissionsScreen({ params, context }: MobileScreenProps) {
  const theme = useMobileTheme()
  const { split } = useLayout()
  const access = useOrgAccess(context.firestore, context.orgId, context.uid)
  const formId = params['formId'] || null
  const formName = params['formName'] || null
  // An org-level link (`/{org}/inbox…`) asks for every site's, where the reader may list them.
  const orgLink = Boolean(params['orgSlug'] && !params['hostSlug'] && params['orgSlug'] === context.orgSlug)
  const [scopePick, setScopePick] = useState<SubmissionScope | null>(null)
  const offersOrg = access.orgWide && !formId && Boolean(context.orgId)
  const scope: SubmissionScope = offersOrg ? (scopePick ?? (orgLink && !params['submission'] ? 'org' : 'site')) : 'site'
  const [read, setRead] = useState<SubmissionReadFilter>('all')
  const [text, setText] = useState('')
  const [search, setSearch] = useState<string[]>([])
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchWords(text)), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const spec = useMemo(
    () =>
      submissionListSpec({ scope, hostId: context.hostId, orgId: context.orgId, formId, read, search }),
    [scope, context.hostId, context.orgId, formId, read, search],
  )
  const list = useSubmissionList(context.firestore, spec)
  const listHostId = scope === 'site' ? context.hostId : null
  const [selected, setSelected] = useState<{ hostId: string; id: string } | null>(null)

  const open = (hostId: string | null, id: string) => {
    if (!hostId) return
    if (split) setSelected({ hostId, id })
    else context.navigate(INBOX_SUBMISSION_SCREEN, { hostId, id, ...(scope === 'org' ? { showSite: '1' } : {}) })
  }

  // A link that names one submission opens it on arrival, once per id.
  const linkedId = params['submission'] ?? null
  const linkedSite = linkedSubmissionSite(params, context)
  const openedLink = useRef<string | null>(null)
  useEffect(() => {
    if (!linkedId || !linkedSite || openedLink.current === linkedId) return
    openedLink.current = linkedId
    open(linkedSite, linkedId)
    // Opened once per linked id; `open` reads the layout of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedId, linkedSite])

  const searching = search.length > 0
  const filtering = read !== 'all' || searching
  const notices = [
    ...(list.plan?.notices ?? []),
    ...(list.plan?.refused ?? []).map((refusal) => refusal.reason),
  ]

  const header = (
    <View>
      {formId ? (
        <View style={{ paddingHorizontal: theme.space(2), paddingTop: theme.space(1.5) }}>
          <Text variant="label">{formName ? `Submissions to ${formName}` : 'Submissions to this form'}</Text>
        </View>
      ) : null}
      {offersOrg ? (
        <ChipRow<SubmissionScope>
          testID="inbox-scope"
          options={[
            { value: 'site', label: 'This site' },
            { value: 'org', label: 'All sites' },
          ]}
          value={scope}
          onChange={(value) => {
            setScopePick(value)
            setSelected(null)
          }}
        />
      ) : null}
      <SearchField testID="inbox-search" value={text} onChangeText={setText} placeholder="Search submissions" />
      <ChipRow<SubmissionReadFilter> testID="inbox-read" options={SUBMISSION_READ_CHOICES} value={read} onChange={setRead} />
      {notices.map((notice) => (
        <Text key={notice} variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(2) }}>
          {notice}
        </Text>
      ))}
    </View>
  )

  const emptyTitle = filtering
    ? 'No submissions match these filters'
    : formId
      ? 'No submissions carry this form’s id yet'
      : scope === 'org'
        ? 'No form submissions on any site yet'
        : 'No form submissions yet'
  const emptyBody = filtering
    ? undefined
    : formId
      ? 'Messages this form’s design collected before it became a form entity are in the Inbox, filed under the name they were sent with.'
      : scope === 'org'
        ? undefined
        : 'Add a Contact Form element to a page. Visitor messages arrive here.'

  const body = !list.ready && !list.rows.length ? (
    <View style={{ padding: theme.space(2), gap: theme.space(1.5) }} testID="inbox-loading">
      <Skeleton height={44} />
      <Skeleton height={44} />
      <Skeleton height={44} />
    </View>
  ) : list.error ? (
    <EmptyState icon="warning-outline" title="Could not load these submissions" />
  ) : (
    <FlatList
      data={list.rows}
      keyExtractor={(row) => `${row.hostId ?? ''}/${row.$id}`}
      ListEmptyComponent={<EmptyState icon="mail-outline" title={emptyTitle} body={emptyBody} />}
      ListFooterComponent={
        <ListFooter hasMore={list.hasMore} loading={!list.ready} onLoadMore={list.loadMore}>
          <Button
            title="Open the Inbox in the console"
            variant="outlined"
            icon="open-outline"
            onPress={() => context.openConsolePath('/inbox', scope === 'org' ? 'org' : 'site')}
          />
        </ListFooter>
      }
      onEndReached={list.loadMore}
      renderItem={({ item }) => {
        const sender = submissionSender(item.fields)
        const site = submissionSite(item, listHostId)
        return (
          <ListRow
            testID={`inbox-row-${item.$id}`}
            title={sender.label}
            subtitle={`${item.formName ?? 'Form'} · ${messageTextOf(item)}`}
            selected={selected?.id === item.$id}
            onPress={() => open(site, item.$id)}
            trailing={
              <View style={{ alignItems: 'flex-end', gap: theme.space(0.5) }}>
                <Text variant="caption" tone="secondary">
                  {relativeTime(receivedAtMs(item))}
                </Text>
                {item.read ? null : (
                  <View accessibilityLabel="Unread" testID={`inbox-unread-${item.$id}`}>
                    <Icon name="ellipse" size={10} color={theme.colors.primary.main} />
                  </View>
                )}
              </View>
            }
          />
        )
      }}
    />
  )

  return (
    <SplitView
      list={
        <View style={{ flex: 1, backgroundColor: theme.colors.background.default }}>
          {header}
          {body}
        </View>
      }
      detail={
        <SubmissionDetail
          context={context}
          hostId={selected?.hostId ?? null}
          submissionId={selected?.id ?? null}
          showSite={scope === 'org'}
          onDeleted={() => setSelected(null)}
        />
      }
    />
  )
}
