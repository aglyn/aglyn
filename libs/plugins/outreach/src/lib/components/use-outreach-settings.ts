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

import { useCallback, useEffect, useState } from 'react'
import type { OutreachComplianceSettingsDocument } from '../model/outreach.types'
import { OutreachRouteError, type OutreachApi } from './use-outreach-api'
import type { OutreachLoadStatus } from './use-outreach-data'

export interface OutreachSettingsLoad {
  status: OutreachLoadStatus
  settings: OutreachComplianceSettingsDocument | null
  /** The route's sentence for an error or a refusal. */
  message: string | null
  /** Reads the settings again — after a save elsewhere, or to retry. */
  reload(): void
}

/**
 * Whether two answers from the settings route say the same thing.
 *
 * Compared by their serialization rather than field by field: the document
 * carries whatever the route returns, and a comparison that named today's
 * fields would silently stop noticing a new one. Guarded, because a value
 * that cannot be serialized must read as "different" — the safe direction,
 * which merely costs a render.
 */
function sameSettings(
  left: OutreachComplianceSettingsDocument | null,
  right: OutreachComplianceSettingsDocument | null,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/**
 * The organization's compliance settings, read through `outreach/settings`
 * (AGL-2980): the Compliance page edits them, and the sequence editor's
 * preview prints the footer from them.
 */
export function useOutreachComplianceSettings(
  api: OutreachApi,
  orgId: string | null,
): OutreachSettingsLoad {
  const [state, setState] = useState<Omit<OutreachSettingsLoad, 'reload'>>({
    status: 'loading',
    settings: null,
    message: null,
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!orgId) return undefined
    let current = true
    /*
     * THE SAME OBJECT WHEN NOTHING CHANGED (AGL-3279).
     *
     * This used to spread unconditionally, which stores a NEW state object
     * on every run and re-renders even when the status is what it already
     * was. That is harmless while the effect's dependencies are stable and
     * a render loop the moment one of them is not — a re-render remakes
     * the dependency, the effect runs, the state changes identity, and
     * React stops it at "Maximum update depth exceeded" (the minified
     * error #185 this page reported on 2026-09-21).
     *
     * Returning `previous` unchanged makes the hook immune to that: the
     * effect may run as often as it likes without ever being the reason it
     * runs again.
     */
    setState((previous) => {
      const status = previous.settings ? previous.status : 'loading'
      return status === previous.status ? previous : { ...previous, status }
    })
    api
      .readSettings()
      .then(
        (answer) =>
          current &&
          setState((previous) =>
            // IDEMPOTENT (AGL-3279): a read that answers what the hook
            // already holds leaves the state object alone. Identity is what
            // a caller's effects and memos key on, so a fresh object for an
            // unchanged answer is a re-render at best and, with an unstable
            // dependency above, the render loop that ends in "Maximum
            // update depth exceeded".
            previous.status === 'ready' &&
            previous.message === null &&
            sameSettings(previous.settings, answer.settings)
              ? previous
              : {
                  status: 'ready',
                  settings: answer.settings,
                  message: null,
                },
          ),
      )
      .catch((error: unknown) => {
        if (!current) return
        const refused = error instanceof OutreachRouteError && error.refused
        setState({
          status: refused ? 'refused' : 'error',
          settings: null,
          message: (error as Error).message,
        })
      })
    return () => {
      current = false
    }
  }, [api, orgId, attempt])
  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { ...state, reload }
}
