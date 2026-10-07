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
 * The Inbox's reads, live (AGL-3622), through the Firebase JS SDK under the
 * console's own rules: the list on the console's planned query, one
 * submission, the replies sent to it, and the site it was sent to (its
 * name for the reply subject, its address for the page link and its
 * `memberRoles` for what the reader may do).
 */

import { listQueryConstraints, listWindowLimit, listWindowRows, useLiveDoc, useMobileAuth } from '@aglyn/mobile-core'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { planListQuery, type ListQueryPlan } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  collection,
  collectionGroup,
  type Firestore,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FORM_SUBMISSIONS_COLLECTION, type SubmissionListSpec, type SubmissionRow } from './submission-query'

export interface SubmissionList {
  rows: SubmissionRow[]
  plan: ListQueryPlan | null
  ready: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => void
}

/**
 * The submissions the spec asks for, newest first, a growing window with
 * one probe row past it (the same window `useMobileListQuery` keeps). One
 * hook for both sources, because the organization's Inbox is a collection
 * group query and the site's a collection.
 */
export function useSubmissionList(firestore: unknown, spec: SubmissionListSpec | null): SubmissionList {
  const specKey = spec ? JSON.stringify(spec) : null
  const plan = useMemo(
    () => (spec ? planListQuery(spec.declaration, spec.request, nameSearchNormalizers) : null),
    // The spec is data; its JSON is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [specKey],
  )
  const [pages, setPages] = useState(1)
  const [state, setState] = useState<{ docs: SubmissionRow[]; ready: boolean; error: Error | null }>({
    docs: [],
    ready: false,
    error: null,
  })
  useEffect(() => setPages(1), [specKey])
  useEffect(() => {
    setState((prior) => ({ docs: prior.docs, ready: false, error: null }))
    if (!spec || !plan || !firestore) return
    const db = firestore as Firestore
    const source =
      spec.source.kind === 'group'
        ? collectionGroup(db, spec.source.collectionId)
        : collection(db, spec.source.path[0], ...spec.source.path.slice(1))
    return onSnapshot(
      query(source, ...listQueryConstraints(plan), limit(listWindowLimit(pages))),
      (snapshot) =>
        setState({
          docs: snapshot.docs.map((row) => ({ ...(row.data() as object), $id: row.id }) as SubmissionRow),
          ready: true,
          error: null,
        }),
      (error) => setState({ docs: [], ready: true, error }),
    )
    // The spec and plan are keyed by specKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, specKey, pages])
  const { rows, hasMore } = listWindowRows(state.docs, pages)
  const loadMore = useCallback(() => {
    if (hasMore) setPages((current) => current + 1)
  }, [hasMore])
  return { rows, plan, ready: state.ready, error: state.error, hasMore, loadMore }
}

/** One submission, live; `data` is null once it is gone. */
export function useSubmission(firestore: unknown, hostId: string | null, id: string | null) {
  return useLiveDoc<Omit<SubmissionRow, '$id'>>(firestore, hostId && id ? ['hosts', hostId, FORM_SUBMISSIONS_COLLECTION, id] : null)
}

/** The site a submission was sent to: its name, address and member roles. */
export interface SubmissionSiteDoc {
  displayName?: string
  subdomain?: string
  memberRoles?: Record<string, string>
}

export function useSubmissionSite(firestore: unknown, hostId: string | null) {
  return useLiveDoc<SubmissionSiteDoc>(firestore, hostId ? ['hosts', hostId] : null)
}

/** How many sent replies the reader lists, as the console's composer does. */
export const SENT_REPLIES_LIMIT = 10

export interface SentReply {
  $id: string
  to?: string
  subject?: string
  message?: string
  sentAtMs?: number
}

/**
 * The replies sent to one submission, newest first, kept under it by the
 * reply route; one past the window says the thread has more.
 */
export function useSentReplies(
  firestore: unknown,
  hostId: string | null,
  id: string | null,
): { replies: SentReply[]; more: boolean; ready: boolean } {
  const [state, setState] = useState<{ replies: SentReply[]; ready: boolean }>({ replies: [], ready: false })
  useEffect(() => {
    setState({ replies: [], ready: false })
    if (!firestore || !hostId || !id) return
    return onSnapshot(
      query(
        collection(firestore as Firestore, 'hosts', hostId, FORM_SUBMISSIONS_COLLECTION, id, 'replies'),
        orderBy('sentAtMs', 'desc'),
        limit(SENT_REPLIES_LIMIT + 1),
      ),
      (snapshot) =>
        setState({
          replies: snapshot.docs.map((row) => ({ ...(row.data() as object), $id: row.id }) as SentReply),
          ready: true,
        }),
      () => setState({ replies: [], ready: true }),
    )
  }, [firestore, hostId, id])
  return {
    replies: state.replies.slice(0, SENT_REPLIES_LIMIT),
    more: state.replies.length > SENT_REPLIES_LIMIT,
    ready: state.ready,
  }
}

/**
 * The signed-in account's address: where the reply route directs answers
 * (`Reply-To`), which the composer states before a reply is sent.
 */
export function useAccountEmail(): string | null {
  const { user } = useMobileAuth()
  return user?.email ?? null
}

/** The form a submission was sent to, for the order and labels of its fields. */
export function useSubmissionForm(firestore: unknown, hostId: string | null, formId: string | null | undefined) {
  return useLiveDoc<{ fields?: unknown }>(firestore, hostId && formId ? ['hosts', hostId, 'forms', formId] : null)
}
