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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback, useState } from 'react'
import {
  bulkReport,
  type CrmBulkOutcome,
  type CrmBulkSkip,
} from '../model/crm-bulk-writes'

/**
 * What a bulk bar does AROUND an action (AGL-2621): mark itself busy, run
 * the job, put the sentence in the snackbar, and hold the refused rows by
 * name until the reader dismisses them. Every bar says the same things in
 * the same places — "Owner set on 3 deals", "Nothing was changed", the
 * warning alert — so the saying lives here once.
 *
 * `job` is whatever applies the plan: the batched runner for a document
 * write, the sequential caller for a route. `attempted` is how many rows
 * the plan wanted to reach, which is what tells "nothing was changed"
 * (it tried and the store refused) from "nothing to change" (every row
 * already said what was asked).
 */
export function useCrmBulkApply() {
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CrmBulkSkip[] | null>(null)

  const apply = useCallback(
    async (options: {
      attempted: number
      skipped: readonly CrmBulkSkip[]
      job: () => Promise<CrmBulkOutcome>
      done: (count: number) => string
    }): Promise<CrmBulkOutcome> => {
      const { attempted, skipped, job, done } = options
      setBusy(true)
      let outcome: CrmBulkOutcome = { done: 0, refused: [] }
      try {
        outcome = await job()
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
        setBusy(false)
        return outcome
      }
      const left = bulkReport({ skipped: [...skipped] }, outcome)
      setReport(left)
      enqueueSnackbar(
        outcome.done
          ? done(outcome.done)
          : attempted
            ? 'Nothing was changed'
            : 'Nothing to change',
        {
          variant: outcome.done && !left ? 'success' : 'warning',
          persist: false,
        },
      )
      setBusy(false)
      return outcome
    },
    [enqueueSnackbar],
  )

  const dismissReport = useCallback(() => setReport(null), [])

  return { busy, report, apply, dismissReport }
}

export default useCrmBulkApply
