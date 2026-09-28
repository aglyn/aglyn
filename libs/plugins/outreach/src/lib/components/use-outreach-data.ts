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
'use client'

import type { CampaignLinkRollup } from '@aglyn/shared-ui-email-campaigns/model'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import type {
  ListQueryDeclaration,
  ListQueryPlan,
  ListQueryRequest,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  collection,
  doc,
  type DocumentData,
  documentId,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  type Query,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  OUTREACH_COLLECTIONS,
  OUTREACH_LINK_ROLLUP_PATH,
  type OutreachDoNotContactDomainEntry,
  type OutreachEnrollment,
  type OutreachEnrollmentStatus,
  type OutreachSequence,
} from '../model/outreach.types'
import {
  readStoredOutreachEnrollment,
  readStoredOutreachSequence,
} from '../model/stored-records'
import { OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY } from '../model/do-not-contact-domain-list-query'
import {
  OUTREACH_ENROLLMENT_LIST_QUERY,
  outreachEnrollmentListBase,
} from '../model/enrollment-list-query'
import { OUTREACH_SEQUENCE_LIST_QUERY } from '../model/sequence-list-query'

/**
 * The Outreach documents the console reads LIVE (AGL-2980): sequences,
 * enrollments, and the mailboxes they send from.
 *
 * Read straight from Firestore — the rules let an org-wide member holding
 * `outreach.use` on an entitled organization read them, and every write goes
 * through a route — so what a page shows is what the routes and the sending
 * runtime wrote, the moment it lands.
 *
 * Every hook answers one of four states, and a page renders each: still
 * loading, ready, failed, or REFUSED — the rules said no, which is a reader
 * who may not see Outreach here rather than something that went wrong.
 */

export type OutreachLoadStatus = 'loading' | 'ready' | 'error' | 'refused'

export interface OutreachLoad<T> {
  status: OutreachLoadStatus
  data: T
}

const denied = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'permission-denied'

function failed<T>(data: T, error: unknown, what: string): OutreachLoad<T> {
  if (denied(error)) return { status: 'refused', data }
  console.error(`[outreach] ${what} could not be read`, error)
  return { status: 'error', data }
}

/**
 * One page of a list whose every filter and search word is on its Firestore
 * query (AGL-3321): the rows of the page on screen, whether another page
 * exists, the pager, and the plan — what the query holds and what it could
 * not take, which the list says above itself.
 */
export interface OutreachListPage<T> {
  status: OutreachLoadStatus
  rows: T[]
  hasMore: boolean
  page: number
  setPage(page: number): void
  pageSize: number
  setPageSize(pageSize: number): void
  plan: ListQueryPlan
}

/**
 * A list read through `useListQuery`, in this module's four states and with
 * each document read through its stored-record reader. A document the reader
 * cannot make sense of is left out, as every Outreach read leaves it out.
 */
function useOutreachListQuery<T>(options: {
  collection: Query<DocumentData> | null
  declaration: ListQueryDeclaration
  request: ListQueryRequest
  deps: readonly unknown[]
  read(id: string, data: DocumentData): T | null
  what: string
}): OutreachListPage<T> {
  const listed = useListQuery<DocumentData & { $id: string }>({
    collection: options.collection,
    declaration: options.declaration,
    request: options.request,
    deps: options.deps,
    idField: '$id',
  })
  const { read, what } = options
  const rows = useMemo(
    () =>
      listed.rows
        .map((row) => read(String(row.$id), row))
        .filter((row): row is NonNullable<typeof row> => row !== null) as T[],
    [listed.rows, read],
  )
  const refused = listed.serverDenied || denied(listed.error)
  useEffect(() => {
    if (listed.status === 'error' && !refused) {
      console.error(`[outreach] ${what} could not be read`, listed.error)
    }
  }, [listed.status, listed.error, refused, what])
  return {
    status:
      listed.status === 'loading'
        ? 'loading'
        : listed.status === 'error'
          ? refused
            ? 'refused'
            : 'error'
          : 'ready',
    rows,
    hasMore: listed.hasMore,
    page: listed.page,
    setPage: listed.setPage,
    pageSize: listed.pageSize,
    setPageSize: listed.setPageSize,
    plan: listed.plan,
  }
}

const readSequence = (id: string, data: DocumentData) =>
  readStoredOutreachSequence(id, data)

/**
 * The organization's sequences, newest first, one page at a time — each
 * clause and the search on the query (`OUTREACH_SEQUENCE_LIST_QUERY`).
 */
export function useOutreachSequenceList(
  orgId: string | null,
  request: ListQueryRequest,
): OutreachListPage<OutreachSequence> {
  const firestore = useFirestore()
  return useOutreachListQuery({
    collection: orgId
      ? collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.sequences)
      : null,
    declaration: OUTREACH_SEQUENCE_LIST_QUERY,
    request,
    deps: [firestore, orgId],
    read: readSequence,
    what: 'sequences',
  })
}

/** One sequence, or `null` once it is known not to exist. */
export function useOutreachSequence(
  orgId: string | null,
  sequenceId: string | null,
): OutreachLoad<OutreachSequence | null> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachSequence | null>>({
    status: 'loading',
    data: null,
  })
  useEffect(() => {
    setResult({ status: 'loading', data: null })
    if (!orgId || !sequenceId) return undefined
    return onSnapshot(
      doc(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.sequences, sequenceId),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: readStoredOutreachSequence(
            snapshot.id,
            snapshot.exists() ? snapshot.data() : undefined,
          ),
        }),
      (error) => setResult(failed(null, error, 'the sequence')),
    )
  }, [firestore, orgId, sequenceId])
  return result
}

/**
 * A sequence's per-destination click rollup (AGL-3239), or `null` until a
 * click has been counted.
 *
 * One document, whatever the sequence's size: the aggregate exists so the
 * table is not a read of every enrollment. A sequence that tracks nothing
 * never has one, and an absent document is not an error.
 */
export type OutreachSequenceLinksLoad = OutreachLoad<CampaignLinkRollup | null>

export function useOutreachSequenceLinks(
  orgId: string | null,
  sequenceId: string | null,
): OutreachSequenceLinksLoad {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachSequenceLinksLoad>({
    status: 'loading',
    data: null,
  })
  useEffect(() => {
    setResult({ status: 'loading', data: null })
    if (!orgId || !sequenceId) return undefined
    return onSnapshot(
      doc(
        firestore,
        'orgs',
        orgId,
        OUTREACH_COLLECTIONS.sequences,
        sequenceId,
        OUTREACH_LINK_ROLLUP_PATH[0],
        OUTREACH_LINK_ROLLUP_PATH[1],
      ),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: snapshot.exists() ? (snapshot.data() as CampaignLinkRollup) : null,
        }),
      (error) => setResult(failed(null, error, 'the link report')),
    )
  }, [firestore, orgId, sequenceId])
  return result
}

const readDomain = (id: string, data: DocumentData): OutreachDoNotContactDomainEntry => ({
  ...(data as OutreachDoNotContactDomainEntry),
  domain: id,
})

/**
 * The domains on the organization's do-not-contact list (AGL-3244),
 * alphabetically — the document id is the domain — one page at a time, live:
 * an add or a remove through the route shows up without a reload, and so
 * does a domain the sending runtime files after a gateway block. Each clause
 * and the search are on the query (`OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY`).
 */
export function useOutreachDoNotContactDomainList(
  orgId: string | null,
  request: ListQueryRequest,
): OutreachListPage<OutreachDoNotContactDomainEntry> {
  const firestore = useFirestore()
  return useOutreachListQuery({
    collection: orgId
      ? collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.doNotContactDomains)
      : null,
    declaration: OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY,
    request,
    deps: [firestore, orgId],
    read: readDomain,
    what: 'the do-not-contact domains',
  })
}

const readEnrollment = (id: string, data: DocumentData) =>
  readStoredOutreachEnrollment(id, data)

/**
 * A sequence's enrollments, the most recently enrolled first, one page at a
 * time — the sequence is the query's base (`sequenceId ==`), and each clause
 * and the search are on it beside that (`OUTREACH_ENROLLMENT_LIST_QUERY`).
 */
export function useOutreachEnrollmentList(
  orgId: string | null,
  sequenceId: string | null,
  request: Omit<ListQueryRequest, 'base'>,
): OutreachListPage<OutreachEnrollment> {
  const firestore = useFirestore()
  return useOutreachListQuery({
    collection:
      orgId && sequenceId
        ? collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.enrollments)
        : null,
    declaration: OUTREACH_ENROLLMENT_LIST_QUERY,
    request: { ...request, base: sequenceId ? outreachEnrollmentListBase(sequenceId) : [] },
    deps: [firestore, orgId, sequenceId],
    read: readEnrollment,
    what: 'the enrollments',
  })
}

/** The counts the sequence list shows beside each sequence. */
export interface OutreachSequenceCounts {
  enrolled: number
  active: number
  replied: number
  bounced: number
  optedOut: number
}

const COUNTED: ReadonlyArray<
  [keyof OutreachSequenceCounts, OutreachEnrollmentStatus | null]
> = [
  ['enrolled', null],
  ['active', 'active'],
  ['replied', 'replied'],
  ['bounced', 'bounced'],
  ['optedOut', 'opted_out'],
]

/**
 * Each sequence's enrollment counts, by server-side aggregation — one count
 * per figure, never a read of the enrollments themselves. Recounted when the
 * sequences asked about change — the list asks about the page on screen —
 * and absent while counting, or if a count failed.
 */
export function useOutreachSequenceCounts(
  orgId: string | null,
  sequenceIds: readonly string[],
): Record<string, OutreachSequenceCounts> {
  const firestore = useFirestore()
  const [counts, setCounts] = useState<Record<string, OutreachSequenceCounts>>(
    {},
  )
  const key = sequenceIds.join(',')
  useEffect(() => {
    if (!orgId || !key) return undefined
    let current = true
    const enrollments = collection(
      firestore,
      'orgs',
      orgId,
      OUTREACH_COLLECTIONS.enrollments,
    )
    Promise.all(
      key.split(',').map(async (sequenceId) => {
        const figures = await Promise.all(
          COUNTED.map(async ([, status]) => {
            const counted = await getCountFromServer(
              status
                ? query(
                    enrollments,
                    where('sequenceId', '==', sequenceId),
                    where('status', '==', status),
                  )
                : query(enrollments, where('sequenceId', '==', sequenceId)),
            )
            return counted.data().count
          }),
        )
        return [
          sequenceId,
          Object.fromEntries(
            COUNTED.map(([name], index) => [name, figures[index]]),
          ) as unknown as OutreachSequenceCounts,
        ] as const
      }),
    )
      .then((entries) => current && setCounts(Object.fromEntries(entries)))
      .catch((error: unknown) =>
        console.error('[outreach] enrollment counts could not be read', error),
      )
    return () => {
      current = false
    }
  }, [firestore, orgId, key])
  return counts
}
