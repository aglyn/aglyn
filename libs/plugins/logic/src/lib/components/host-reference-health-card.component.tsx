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

import { auditHostReferences } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Chip, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostOrgId,
} from '@aglyn/tenant-feature-instance'

export interface HostReferenceHealthCardProps {
  hostId: string
}

/**
 * Reference health (wave v7): id references are rename-safe (AGL-261)
 * but not delete-safe — this card cross-checks every automation,
 * workflow, and computed-variable reference against what still exists
 * and lists the dangling ones, so broken wiring surfaces here instead
 * of failing silently on a visitor's pageview.
 */
export function HostReferenceHealthCard(props: HostReferenceHealthCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const hostOrgId = useHostOrgId(hostId)
  const dataScope = hostOrgId
    ? (['orgs', hostOrgId] as const)
    : (['hosts', hostId] as const)

  const useHostCollection = (name: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useFirestoreCollection<any>(
      () => query(collection(firestore, 'hosts', hostId, name), limit(100)),
      [firestore, hostId],
      { idField: '$id' },
    ).data
  const actionDocs = useHostCollection('actions')
  const workflowDocs = useHostCollection('workflows')
  const variableDocs = useHostCollection('variables')
  const functionDocs = useHostCollection('functions')
  const campaignDocs = useHostCollection('campaigns')
  const overlayDocs = useHostCollection('overlays')
  const webhookDocs = useHostCollection('webhooks')
  // New reference kinds (AGL-345): screen links, commerce entities.
  const screenDocs = useHostCollection('screens')
  const productDocs = useHostCollection('products')
  const collectionDocs = useHostCollection('collections')
  const categoryDocs = useHostCollection('productCategories')
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, dataScope[0], dataScope[1], 'datasets'),
        limit(100),
      ),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, dataScope[0], dataScope[1], 'lists'),
        limit(100),
      ),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )

  const issues = useMemo(() => {
    const alive = (docs: any[] | undefined) =>
      (docs ?? []).filter((doc: any) => !doc.deletedAt)
    const knownSet = (docs: any[] | undefined, nameKey = 'name') => {
      const set = new Set<string>()
      for (const doc of alive(docs)) {
        set.add(doc.$id)
        const name = doc[nameKey]
        if (typeof name === 'string' && name.trim()) set.add(name.trim())
      }
      return set
    }
    return auditHostReferences({
      actions: alive(actionDocs),
      workflows: alive(workflowDocs),
      variables: alive(variableDocs),
      known: {
        workflows: knownSet(workflowDocs),
        functions: knownSet(functionDocs),
        datasets: knownSet(datasetDocs),
        lists: knownSet(listDocs),
        campaigns: knownSet(campaignDocs),
        overlays: knownSet(overlayDocs),
        webhooks: knownSet(webhookDocs),
        screens: knownSet(screenDocs, 'displayName'),
        products: knownSet(productDocs),
        collections: knownSet(collectionDocs),
        categories: knownSet(categoryDocs),
      },
    })
  }, [
    actionDocs,
    workflowDocs,
    variableDocs,
    functionDocs,
    datasetDocs,
    listDocs,
    campaignDocs,
    overlayDocs,
    webhookDocs,
    screenDocs,
    productDocs,
    collectionDocs,
    categoryDocs,
  ])

  return (
    <CardDisplay
      header={'Reference health'}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {issues.length === 0 ? (
        <Alert severity="success">
          {'Every automation, workflow, and variable reference resolves.'}
        </Alert>
      ) : (
        <Stack spacing={1}>
          <Alert severity="warning">
            {`${issues.length} broken reference${
              issues.length === 1 ? '' : 's'
            } — these steps do nothing until re-pointed or removed.`}
          </Alert>
          {issues.map((issue, index) => (
            <Stack
              key={`${issue.sourceId}:${index}`}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Chip size="small" label={issue.source} />
              <Typography variant="body2" noWrap sx={{ maxWidth: '40%' }}>
                {issue.sourceName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`→ missing ${issue.refType} `}
              </Typography>
              <Typography
                variant="caption"
                color="error"
                sx={{ fontFamily: 'monospace' }}
              >
                {issue.missing || '(empty)'}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </CardDisplay>
  )
}
HostReferenceHealthCard.displayName = 'HostReferenceHealthCard'

export default HostReferenceHealthCard
