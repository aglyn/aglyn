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
import { outreachEmailDomain } from '../engine/do-not-contact-domain'
import { readOutreachHistoryEntry } from '../model/enrollment-history'
import {
  OUTREACH_COLLECTIONS,
  OUTREACH_ENROLLMENT_HISTORY,
  OUTREACH_ENROLLMENT_HISTORY_MAX,
  type OutreachDomainIntel,
  type OutreachEnrollment,
  type OutreachEnrollmentHistoryEntry,
} from '../model/outreach.types'
import { readStoredOutreachEnrollment } from '../model/stored-records'
// The reader alone, which touches no database: the same one the gates use,
// so the page and the engine read one document one way.
import { readStoredOutreachDomainIntel } from '../storage/domain-intel-store'
import type { OutreachLoad } from './use-outreach-data'

/**
 * What ONE enrollment's detail view reads (AGL-3332), and nothing else
 * reads: the enrollment itself, its history, and what the organization
 * knows about the person's mail domain.
 *
 * Each is its own listen, opened when the view mounts and closed when it
 * leaves, so the enrollments table — which lists hundreds of people — never
 * pays for any of it.
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
 * What the organization knows about the domain an address is at (AGL-3326):
 * its mail gateway and what that gateway did with the organization's mail,
 * or `null` when the domain was never looked up.
 */
export function useOutreachDomainIntel(
  orgId: string | null,
  email: string | null,
): OutreachLoad<OutreachDomainIntel | null> {
  const firestore = useFirestore()
  const domain = outreachEmailDomain(email)
  const [result, setResult] = useState<OutreachLoad<OutreachDomainIntel | null>>({
    status: 'loading',
    data: null,
  })
  useEffect(() => {
    setResult({ status: 'loading', data: null })
    if (!orgId || !domain) {
      setResult({ status: 'ready', data: null })
      return undefined
    }
    return onSnapshot(
      doc(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.domainIntel, domain),
      (snapshot) =>
        setResult({
          status: 'ready',
          data: readStoredOutreachDomainIntel(snapshot.id, snapshot.exists() ? snapshot.data() : undefined),
        }),
      (error) => setResult(failed(null, error, 'the domain’s mail gateway')),
    )
  }, [firestore, orgId, domain])
  return result
}
