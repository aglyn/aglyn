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

import { usePluginApiPost } from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'

/** This plugin's recount route — see `formStatsHandler` in `../server.ts`. */
export const FORM_STATS_API_PATH = '/api/forms/stats'

/** The forms whose counters to recount, on one site. */
export interface FormStatsRecountTarget {
  hostId: string
  formIds: readonly string[]
}

/**
 * Asks `/api/forms/stats` to recount forms' counters from their rows
 * (AGL-3330) — what a console act that changes what they should say calls
 * afterwards: switching lead routing, deleting a submission.
 *
 * A client cannot write a form's `stats` (the rules refuse it), so the
 * server counts and writes. BEST EFFORT, and it never throws: the act that
 * prompted it has already happened, and a recount that did not land leaves
 * the counters exactly as the increment left them, for the next recount —
 * `tools/scripts/recount-form-stats.mjs` over every form — to put right.
 *
 * @returns whether the recount was answered.
 */
export function useFormStatsRecountApi(): (target: FormStatsRecountTarget) => Promise<boolean> {
  const post = usePluginApiPost()
  return useCallback(
    async ({ hostId, formIds }) => {
      const ids = [...new Set(formIds.filter(Boolean))]
      if (!hostId || !ids.length) return false
      return post(FORM_STATS_API_PATH, { hostId, formIds: ids })
    },
    [post],
  )
}

export default useFormStatsRecountApi
