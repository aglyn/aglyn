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
    setState((previous) => ({
      ...previous,
      status: previous.settings ? previous.status : 'loading',
    }))
    api
      .readSettings()
      .then(
        (answer) =>
          current &&
          setState({
            status: 'ready',
            settings: answer.settings,
            message: null,
          }),
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
