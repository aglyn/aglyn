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
import { useCrmApi } from '../components/use-crm-api'
import type { CrmOrgActivityKind } from '../constants/api-routes'
import {
  bulkReport,
  type CrmBulkOutcome,
  type CrmBulkSkip,
} from '../model/crm-bulk-writes'
import { useCrmOrgMount } from './use-crm-org-mount'

export interface CrmBulkApplyOptions {
  /**
   * What the bar's rows are — the record kind the ORGANIZATION's feed files
   * the bar's one line under (AGL-2634). A bar that names none writes no
   * org line.
   */
  recordKind?: CrmOrgActivityKind
}

export interface CrmBulkApplyRun {
  attempted: number
  skipped: readonly CrmBulkSkip[]
  job: () => Promise<CrmBulkOutcome>
  done: (count: number) => string
  /**
   * The job goes through a route that writes its own line per record —
   * a stage move, a loss — so the bar's summary would say it twice.
   */
  loggedByRoute?: boolean
}

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
 *
 * ## The organization's line (AGL-2634)
 *
 * Under a site a bar logs what it must into the site's feed itself, one
 * line per record, client-direct. At the ORGANIZATION level there is no
 * site's feed and the org's is closed to clients, so the one thing every
 * bar has in common — the sentence it just put in the snackbar — is posted
 * once, through `crm/org-activity`, as the org feed's line for the action:
 * "Owner set on 3 deals", filed under the bar's record kind. Nothing is
 * posted for an action that changed nothing, and nothing for a job whose
 * route already wrote a line per record.
 */
export function useCrmBulkApply(options: CrmBulkApplyOptions = {}) {
  const { recordKind } = options
  const { enqueueSnackbar } = useSnackbar()
  const mount = useCrmOrgMount()
  const callCrm = useCrmApi(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CrmBulkSkip[] | null>(null)

  const apply = useCallback(
    async (run: CrmBulkApplyRun): Promise<CrmBulkOutcome> => {
      const { attempted, skipped, job, done, loggedByRoute } = run
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
      const sentence = outcome.done
        ? done(outcome.done)
        : attempted
          ? 'Nothing was changed'
          : 'Nothing to change'
      enqueueSnackbar(sentence, {
        variant: outcome.done && !left ? 'success' : 'warning',
        persist: false,
      })
      if (mount && recordKind && outcome.done && !loggedByRoute) {
        // Fire-and-forget, as the site logger is: an audit miss must not
        // turn a finished action into a failed one.
        void callCrm('org-activity', {
          action: sentence,
          target: { type: recordKind },
        }).catch((error) => console.error(error))
      }
      setBusy(false)
      return outcome
    },
    [enqueueSnackbar, mount, recordKind, callCrm],
  )

  const dismissReport = useCallback(() => setReport(null), [])

  return { busy, report, apply, dismissReport }
}

export default useCrmBulkApply
