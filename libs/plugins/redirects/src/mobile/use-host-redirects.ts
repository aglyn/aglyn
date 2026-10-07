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
 * A site's redirect rules, live (AGL-3620). The same collection and the
 * same rules the console's Redirects page reads — `hosts/{hostId}/redirects`,
 * which a member of the site may read — through the Firebase JS SDK, so the
 * app holds no privilege the console does not.
 */

import { collection, limit, onSnapshot, query, type Firestore } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { REDIRECT_DEFAULT_PRIORITY, type HostRedirect } from '../lib/model/redirects'

/**
 * The console Redirects page's own ceiling (`REDIRECT_CEILING`): a window
 * the page holds whole, so the app shows the same rules the console does.
 */
export const REDIRECTS_WINDOW = 200

export interface RedirectRow extends HostRedirect {
  id: string
}

/** Evaluation order, as the serve path applies it: priority, then source. */
export function inEvaluationOrder(rows: readonly RedirectRow[]): RedirectRow[] {
  // A soft-deleted rule is gone for the console and for the serve path.
  return rows.filter((row) => !(row as { deletedAt?: unknown }).deletedAt).sort(
    (a, b) =>
      (a.priority ?? REDIRECT_DEFAULT_PRIORITY) - (b.priority ?? REDIRECT_DEFAULT_PRIORITY) ||
      a.source.localeCompare(b.source),
  )
}

export function useHostRedirects(
  firestore: unknown,
  hostId: string | null,
): { rows: RedirectRow[]; ready: boolean; error: boolean } {
  const [state, setState] = useState<{ rows: RedirectRow[]; ready: boolean; error: boolean }>({
    rows: [],
    ready: false,
    error: false,
  })
  useEffect(() => {
    setState({ rows: [], ready: false, error: false })
    if (!hostId) return
    return onSnapshot(
      query(collection(firestore as Firestore, 'hosts', hostId, 'redirects'), limit(REDIRECTS_WINDOW)),
      (snapshot) =>
        setState({
          rows: inEvaluationOrder(
            snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as HostRedirect) })),
          ),
          ready: true,
          error: false,
        }),
      () => setState({ rows: [], ready: true, error: true }),
    )
  }, [firestore, hostId])
  return state
}
