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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { TransferWizardStepProps } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { PRODUCT_IMPORT_ZONE } from '../components/console/product-zones'
import { rememberProductImport } from './product-import-results'

/**
 * The product import wizard's After import step (AGL-3531): the
 * `productImport` zone, where another plugin offers what happens to the
 * products once they land — the AI plugin's "write descriptions as they
 * land". The options are filed with the job for the products hub, which
 * hands them to `productsHub` with the ids the import created. Nothing here
 * blocks the import: with no widget the step says so and lets it go on.
 */
export function ProductImportOptionsStep(props: TransferWizardStepProps) {
  const { orgId, hostId, jobId, value, setValue, setComplete } = props
  const firestore = useFirestore()
  const WidgetSlot = useConsoleWidgetSlot()
  const options = (value && typeof value === 'object' ? value : {}) as Record<string, boolean>
  const [count, setCount] = useState(0)

  useEffect(() => setComplete(true), [setComplete])

  // How many products the dry run creates, from the job the wizard listens to.
  useEffect(() => {
    if (!jobId || !orgId) return
    let live = true
    getDoc(doc(firestore, 'orgs', orgId, 'transferJobs', jobId))
      .then((snapshot) => {
        const creates = Number(snapshot.get('summary.create') ?? 0)
        if (live) setCount(Number.isFinite(creates) ? creates : 0)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [firestore, orgId, jobId])

  useEffect(() => {
    if (hostId && jobId && orgId) rememberProductImport(hostId, { orgId, jobId, options })
  }, [hostId, jobId, orgId, options])

  const setOption = useCallback(
    (key: string, on: boolean) => setValue({ ...options, [key]: on }),
    [options, setValue],
  )

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {'What happens to the new products once they land.'}
      </Typography>
      {WidgetSlot && hostId ? (
        <WidgetSlot
          slot={PRODUCT_IMPORT_ZONE.id}
          hostId={hostId}
          orgId={orgId}
          count={count}
          options={options}
          setOption={setOption}
        />
      ) : null}
    </Stack>
  )
}
ProductImportOptionsStep.displayName = 'ProductImportOptionsStep'

export default ProductImportOptionsStep
