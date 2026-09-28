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

import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { readOutreachHistoryEntry } from '../model/enrollment-history'
import {
  OUTREACH_COLLECTIONS,
  OUTREACH_ENROLLMENT_HISTORY,
  OUTREACH_ENROLLMENT_HISTORY_MAX,
  type OutreachEnrollment,
  type OutreachEnrollmentHistoryEntry,
} from '../model/outreach.types'
import { readStoredOutreachEnrollment } from '../model/stored-records'
import type { OutreachEnrollmentGatewayResponse } from '../model/outreach-api'
import type { OutreachApi } from './use-outreach-api'
import type { OutreachLoad } from './use-outreach-data'

/**
 * What ONE enrollment's detail view reads (AGL-3332), and nothing else
 * reads: the enrollment itself, its history, and the mail gateway in front
 * of the person's domain.
 *
 * The first two are listens, opened when the view mounts and closed when it
 * leaves, so the enrollments table — which lists hundreds of people — never
 * pays for any of it; the gateway is one server read per page.
 */

const denied = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'permission-denied'

function failed<T>(data: T, error: unknown, what: string): OutreachLoad<T> {
  if (denied(error)) return { status: 'refused', data }
  console.error(`[outreach] ${what} could not be read`, error)
  return { status: 'error', data }
}

/** One enrollment, live, or `null` once it is known not to exist. */
export function useOutreachEnrollment(
  orgId: string | null,
  enrollmentId: string | null,
): OutreachLoad<OutreachEnrollment | null> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachEnrollment | null>>({
    status: 'loading',
    data: null,
  })
  useEffect(() => {
    setResult({ status: 'loading', data: null })
    if (!orgId || !enrollmentId) return undefined
    return onSnapshot(
      doc(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.enrollments, enrollmentId),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: readStoredOutreachEnrollment(snapshot.id, snapshot.exists() ? snapshot.data() : undefined),
        }),
      (error) => setResult(failed(null, error, 'the enrollment')),
    )
  }, [firestore, orgId, enrollmentId])
  return result
}

/**
 * The enrollment's history rows, newest first — every row it can hold, which
 * is bounded by `OUTREACH_ENROLLMENT_HISTORY_MAX` on the writing side.
 */
export function useOutreachEnrollmentHistory(
  orgId: string | null,
  enrollmentId: string | null,
): OutreachLoad<OutreachEnrollmentHistoryEntry[]> {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachLoad<OutreachEnrollmentHistoryEntry[]>>({
    status: 'loading',
    data: [],
  })
  useEffect(() => {
    setResult({ status: 'loading', data: [] })
    if (!orgId || !enrollmentId) return undefined
    return onSnapshot(
      query(
        collection(
          firestore,
          'orgs',
          orgId,
          OUTREACH_COLLECTIONS.enrollments,
          enrollmentId,
          OUTREACH_ENROLLMENT_HISTORY,
        ),
        orderBy('atMs', 'desc'),
        limit(OUTREACH_ENROLLMENT_HISTORY_MAX),
      ),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: snapshot.docs
            .map((entry) => readOutreachHistoryEntry(entry.id, entry.data()))
            .filter((entry): entry is OutreachEnrollmentHistoryEntry => entry !== null),
        }),
      (error) => setResult(failed([], error, 'the enrollment’s history')),
    )
  }, [firestore, orgId, enrollmentId])
  return result
}

/**
 * The mail gateway in front of the person's domain (AGL-3326, AGL-3328),
 * and what it did with mail from the enrollment's sending domain — asked of
 * the server once per page, because the domain's MX lives in the platform's
 * cache, which no member reads.
 */
export function useOutreachEnrollmentGateway(
  api: Pick<OutreachApi, 'readEnrollmentGateway'>,
  enrollmentId: string | null,
): OutreachLoad<OutreachEnrollmentGatewayResponse | null> {
  const [result, setResult] = useState<OutreachLoad<OutreachEnrollmentGatewayResponse | null>>({
    status: 'loading',
    data: null,
  })
  useEffect(() => {
    let live = true
    setResult({ status: 'loading', data: null })
    if (!enrollmentId) return undefined
    api.readEnrollmentGateway(enrollmentId).then(
      (answer) => {
        if (live) setResult({ status: 'ready', data: answer })
      },
      (error: unknown) => {
        if (!live) return
        const status = (error as { status?: unknown } | null)?.status
        if (status === 403) setResult({ status: 'refused', data: null })
        else setResult(failed(null, error, 'the domain’s mail gateway'))
      },
    )
    return () => {
      live = false
    }
  }, [api, enrollmentId])
  return result
}
