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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn/app-utils/lockdown'
import type { SiteStarterFacets, SiteStarterMode } from '@aglyn/aglyn/app-utils/site-starter'
import type { SiteStarterSummary } from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseStarterSearchAnswer,
  STARTER_SEARCH_PATH,
  starterQueryParams,
  type StarterSearchLabels,
} from '../model/starter-query'

/** How long the search waits for typing to stop before it asks, as the review queue's does. */
export const STARTER_SEARCH_SETTLE_MS = 300

/** Why a search could not be answered: the words to show, and the status that said so (0 for none). */
export interface StarterSearchError {
  message: string
  status: number
}

export interface StarterSearchInput {
  /** The workspace the site will belong to; nothing is asked while it resolves. */
  orgId: string | undefined
  mode: SiteStarterMode
  /** The person's words, as typed: asked once typing settles. */
  word: string
  filter?: Partial<SiteStarterFacets>
  limit?: number
  /** A listing the answer carries whatever the search finds: a pick being restored (AGL-4049). */
  include?: string | null
}

export interface StarterSearchState {
  /** The starters the last answer listed, best first. */
  rows: SiteStarterSummary[]
  labels: StarterSearchLabels
  /** A request is out. */
  loading: boolean
  /** An answer has arrived for this workspace, listing starters or refusing. */
  settled: boolean
  /** Why the last search was not answered, or `null`. */
  error: StarterSearchError | null
  /** Asks the same search again. */
  refresh: () => void
}

const NO_LABELS: StarterSearchLabels = { base: {}, fonts: {} }

/** The words a refused or failed search shows. */
function refusalMessage(status: number, payload: unknown): string {
  // A lockdown is not a broken search (AGL-1532): it says what is paused.
  const locked = parseLockdownRefusal(status, payload)
  if (locked) return lockdownRefusalText(locked)
  const error = (payload as { error?: unknown } | null)?.error
  return typeof error === 'string' && error
    ? error
    : `Starters could not be loaded (${status})`
}

/**
 * The starters a search finds, for "Choose your starter" (AGL-4049): asks
 * `GET /api/marketplace/starters` with the person's own token, once typing
 * has settled, and again whenever the workspace, the mode or a filter
 * changes. Only the newest answer is kept: a slow answer to an older search
 * never replaces a newer one.
 */
export function useStarterSearch({
  orgId,
  mode,
  word,
  filter,
  limit,
  include,
}: StarterSearchInput): StarterSearchState {
  const { data: user } = useUser()
  // The token is read from the user at the moment of asking; the request is
  // keyed on WHO is asking, so a re-render handing over the same account does
  // not ask again.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null

  const [asked, setAsked] = useState(() => word.trim())
  useEffect(() => {
    const settledWord = word.trim()
    if (settledWord === asked) return undefined
    const timer = setTimeout(() => setAsked(settledWord), STARTER_SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [word, asked])

  // The query string is the request's identity: one search, one URL.
  const query = orgId ? starterQueryParams({ orgId, mode, word: asked, filter, limit, include }).toString() : null

  const [rows, setRows] = useState<SiteStarterSummary[]>([])
  const [labels, setLabels] = useState<StarterSearchLabels>(NO_LABELS)
  const [loading, setLoading] = useState(false)
  const [settled, setSettled] = useState(false)
  const [error, setError] = useState<StarterSearchError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)

  // A different workspace starts over: its answer is not the last one's.
  useEffect(() => {
    setSettled(false)
    setRows([])
    setError(null)
  }, [orgId])

  useEffect(() => {
    if (!query || !uid) return undefined
    const ticket = ++latest.current
    let current = true
    setLoading(true)
    void (async () => {
      let status = 0
      try {
        const response = await authorizedFetch(userRef.current, `${STARTER_SEARCH_PATH}?${query}`)
        status = response.status
        const payload: unknown = await response.json().catch((): null => null)
        if (!current || ticket !== latest.current) return
        if (response.ok) {
          const parsed = parseStarterSearchAnswer(payload)
          setRows(parsed.rows)
          setLabels(parsed.labels)
          setError(null)
        } else {
          setRows([])
          setError({ message: refusalMessage(status, payload), status })
        }
      } catch {
        if (!current || ticket !== latest.current) return
        setRows([])
        setError({
          message: 'Starters could not be loaded. Check your connection and try again.',
          status,
        })
      }
      setSettled(true)
      setLoading(false)
    })()
    return () => {
      current = false
    }
  }, [query, uid, attempt])

  const refresh = useCallback(() => setAttempt((count) => count + 1), [])
  return { rows, labels, loading, settled, error, refresh }
}
