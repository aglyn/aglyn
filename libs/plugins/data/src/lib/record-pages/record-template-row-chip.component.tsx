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

import type { ConsoleHostScreenRowZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useFirestore, useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { Chip, Tooltip } from '@mui/material'
import { collection, doc, getCountFromServer, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { datasetDisplayName, type HostDataset } from '../model/datasets'
import { useSiteRecordPageBindings } from './record-page-source'

/**
 * A Pages list row's record template chip (AGL-3475): how many record pages the
 * page serves, with the base they live under in its tooltip — what an author
 * scanning the list needs to know about a page that has no address of its own.
 *
 * The site's bindings come from one query however many rows ask, which the
 * Firestore SDK shares between identical listeners; only a row that IS a
 * record template reads anything more, and that is one count.
 */
export function RecordTemplateRowChip(props: ConsoleHostScreenRowZoneProps) {
  const { hostId, orgId, screenId } = props
  const { bindings } = useSiteRecordPageBindings(hostId)
  const binding = bindings.find((one) => one.screenId === screenId)
  const firestore = useFirestore()
  const { scope } = useOrgDataScope({ hostId, orgId })
  const [summary, setSummary] = useState<{ name: string; count: number } | null>(null)
  const datasetId = binding?.datasetId

  useEffect(() => {
    if (!datasetId || !scope) {
      setSummary(null)
      return undefined
    }
    let active = true
    const datasetRef = doc(firestore, scope[0], scope[1], 'datasets', datasetId)
    Promise.all([getDoc(datasetRef), getCountFromServer(collection(datasetRef, 'records'))])
      .then(([dataset, count]) => {
        if (!active) return
        setSummary({
          name: datasetDisplayName(dataset.data() as HostDataset | undefined),
          count: count.data().count,
        })
      })
      .catch((error) => {
        // A dataset this viewer may not read still gets its chip, unnumbered.
        console.error(error)
        if (active) setSummary(null)
      })
    return () => {
      active = false
    }
  }, [firestore, scope, datasetId])

  if (!binding) return null
  // Short, because it shares the name's cell: the count is the news, and the
  // tooltip says where the pages live.
  const label = summary
    ? `${summary.count} record ${summary.count === 1 ? 'page' : 'pages'}`
    : 'Record template'
  return (
    <Tooltip
      title={`Record template${summary?.name ? ` of ${summary.name}` : ''}: served once per record at /${binding.base}/ and each record's page address`}
    >
      <Chip size="small" variant="outlined" label={label} />
    </Tooltip>
  )
}

export default RecordTemplateRowChip
