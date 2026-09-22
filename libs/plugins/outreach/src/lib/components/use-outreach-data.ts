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
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
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

/** The most sequences the list reads. */
export const OUTREACH_SEQUENCES_LIMIT = 200

/** The organization's sequences, newest first. */
export function useOutreachSequences(
  orgId: string | null,
): OutreachLoad<OutreachSequence[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachSequence[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId) return undefined
    return onSnapshot(
      query(
        collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.sequences),
        // Ordered, so the cap keeps the newest rather than an arbitrary set;
        // every sequence carries `createdAtMs`, stamped by the save route.
        orderBy('createdAtMs', 'desc'),
        limit(OUTREACH_SEQUENCES_LIMIT),
      ),
      (snapshot) => {
        const sequences = snapshot.docs
          .map((entry) => readStoredOutreachSequence(entry.id, entry.data()))
          .filter((sequence): sequence is OutreachSequence => sequence !== null)
          .sort((a, b) => b.createdAtMs - a.createdAtMs)
        setResult({ status: 'ready', data: sequences })
      },
      (error) => setResult(failed([], error, 'sequences')),
    )
  }, [firestore, orgId])
  return result
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

/**
 * The domains on the organization's do-not-contact list (AGL-3244),
 * alphabetically, live: an add or a remove through the route shows up here
 * without a reload, and so does a domain the sending runtime files after a
 * gateway block.
 */
export function useOutreachDoNotContactDomains(
  orgId: string | null,
): OutreachLoad<OutreachDoNotContactDomainEntry[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachDoNotContactDomainEntry[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId) return undefined
    return onSnapshot(
      collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.doNotContactDomains),
      (snapshot) => {
        const domains = snapshot.docs
          .map((entry) => ({ ...(entry.data() as OutreachDoNotContactDomainEntry), domain: entry.id }))
          .sort((a, b) => a.domain.localeCompare(b.domain))
        setResult({ status: 'ready', data: domains })
      },
      (error) => setResult(failed([], error, 'the do-not-contact domains')),
    )
  }, [firestore, orgId])
  return result
}

/** How many enrollments one page of the table reads; "Show more" reads another. */
export const OUTREACH_ENROLLMENTS_PAGE = 200

export interface OutreachEnrollmentsLoad extends OutreachLoad<
  OutreachEnrollment[]
> {
  /** Whether a further page may exist. */
  hasMore: boolean
  showMore(): void
}

/**
 * A sequence's enrollments, the most recently enrolled first.
 *
 * Paged by document id — an equality on `sequenceId` in the id's own order
 * needs no composite index — and sorted by enrollment time once read, so a
 * table of up to a page reads in the order people were enrolled.
 */
export function useOutreachEnrollments(
  orgId: string | null,
  sequenceId: string | null,
): OutreachEnrollmentsLoad {
  const firestore = useFirestore()
  const [pages, setPages] = useState(1)
  const [result, setResult] = useState<
    OutreachLoad<OutreachEnrollment[]> & { size: number }
  >({
    status: 'loading',
    data: [],
    size: 0,
  })
  useEffect(() => setPages(1), [orgId, sequenceId])
  useEffect(() => {
    if (!orgId || !sequenceId) {
      setResult({ status: 'loading', data: [], size: 0 })
      return undefined
    }
    return onSnapshot(
      query(
        collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.enrollments),
        where('sequenceId', '==', sequenceId),
        orderBy(documentId()),
        limit(pages * OUTREACH_ENROLLMENTS_PAGE),
      ),
      (snapshot) => {
        const enrollments = snapshot.docs
          .map((entry) => readStoredOutreachEnrollment(entry.id, entry.data()))
          .filter(
            (enrollment): enrollment is OutreachEnrollment =>
              enrollment !== null,
          )
          .sort((a, b) => b.createdAtMs - a.createdAtMs)
        setResult({ status: 'ready', data: enrollments, size: snapshot.size })
      },
      (error) =>
        setResult({ ...failed([], error, 'the enrollments'), size: 0 }),
    )
  }, [firestore, orgId, sequenceId, pages])
  return useMemo(
    () => ({
      status: result.status,
      data: result.data,
      hasMore: result.size >= pages * OUTREACH_ENROLLMENTS_PAGE,
      showMore: () => setPages((count) => count + 1),
    }),
    [result, pages],
  )
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
