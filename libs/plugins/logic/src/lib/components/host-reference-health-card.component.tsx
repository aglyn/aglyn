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

import { pluginDocsHelp, scopeTokensForHost } from '@aglyn/aglyn'
import { auditHostReferences } from '../model'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Chip, Stack, Typography } from '@mui/material'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the two PURE helpers — the specs that render
 * this card mock `@aglyn/tenant-feature-instance` wholesale to stage their
 * Firestore hooks, and a query builder imported through that barrel disappears
 * under the mock. Neither of these is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'

export interface HostReferenceHealthCardProps {
  hostId: string
}

/**
 * How much of each collection the audit judges against.
 *
 * Thirteen collections at this ceiling is what an open of this page costs, so
 * the number is a bill as much as a bound. It is stated once because every one
 * of those windows has to agree: the audit compares references drawn from
 * three of them against names drawn from the other ten, and a wider window on
 * one side than the other would report the difference as broken wiring.
 */
const REFERENCE_CEILING = 100

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
  // The org lookup is async (AGL-1061). `dataScope` is null until it
  // settles — and stays null for a host with no owning org — so the two
  // org-data queries below simply are not issued rather than falling back
  // to a host path (AGL-1050).
  const { scope: dataScope } = useOrgDataScope({ hostId })

  /*
   * ORDERED AND CEILINGED (AGL-2501), the same decision the actions and
   * workflows cards reached.
   *
   * `limit(100)` alone is answered in DOCUMENT-ID order, so an unnamed window
   * is a pseudo-random hundred — and on THIS card that is worse than a
   * mis-drawn list. The audit asks whether a reference resolves and answers
   * from the windows, so a workflow that exists but falls outside the
   * `workflows` hundred is indistinguishable from one that was deleted, and
   * the card reports live wiring as broken. `collectionCeiling` does not
   * change WHICH hundred — document-id order is what a bare cap returns
   * anyway. What it changes is that the order is NAMED, which is what makes
   * the probe row meaningful and catches the obvious next edit: ordering on
   * `name` would HIDE every row written without one rather than mis-sort
   * anything.
   */
  const useHostCollection = (name: string) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = useFirestoreCollection<any>(
      () =>
        collectionCeiling(
          collection(firestore, 'hosts', hostId, name),
          REFERENCE_CEILING,
        ),
      [firestore, hostId],
      { idField: '$id' },
    )
    // Memoised so the window keeps one identity while the rows do. The audit
    // below is eleven set builds and a sweep of three collections; a fresh
    // `slice` every render would re-run all of it every render.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMemo(() => ceilingedWindow<any>(data, REFERENCE_CEILING), [data])
  }
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
  // Scoped (AGL-1044) — see the note in host-actions-card: an unfiltered
  // list is rejected, not filtered.
  // Scoped to the HOST, not the viewer (AGL-1044): the audit speaks for this host, so it must judge against what THIS host can reach — an org-wide
  // admin would otherwise be offered datasets that resolve to nothing at
  // render time. Filtering by the host's tokens also satisfies the
  // AGL-1041 rules, since they are a subset of any viewer's who can reach
  // this host at all.
  // Memoised: this is a listener DEPENDENCY, and a fresh array each
  // render tears the subscription down and clears its data every time.
  const scopeTokens = useMemo(() => scopeTokensForHost(hostId), [hostId])
  // The `visibleTo` filter is now unconditional: the only scope this hook
  // hands out is an org one, and org datasets are all scoped (AGL-1041).
  // It used to be conditional on having an org, for the host fallback's
  // sake — those rows carried no `visibleTo` and the filter would have
  // matched nothing.
  /*
   * `documentId()` rather than a field, for the reason the audience sweep in
   * `campaign-send.ts` gives: Firestore's automatic single-field index for an
   * array member is keyed on the value and the document name, so
   * `array-contains-any` plus `orderBy(__name__)` is served by it. Ordering on
   * anything else here would need a composite index that does not exist.
   */
  const { data: datasetRead } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'datasets'),
            where('visibleTo', 'array-contains-any', scopeTokens),
            orderBy(documentId()),
            limit(REFERENCE_CEILING + 1),
          )
        : null,
    [firestore, dataScope, scopeTokens],
    { idField: '$id' },
  )
  const datasetDocs = useMemo(
    () => ceilingedWindow<any>(datasetRead, REFERENCE_CEILING),
    [datasetRead],
  )
  const { data: listRead } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? collectionCeiling(
            collection(firestore, dataScope[0], dataScope[1], 'lists'),
            REFERENCE_CEILING,
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const listDocs = useMemo(
    () => ceilingedWindow<any>(listRead, REFERENCE_CEILING),
    [listRead],
  )

  /**
   * At least one collection holds more than the audit read.
   *
   * The verdict this card renders is computed entirely from the windows, so a
   * ceiling that bit anywhere makes both halves of it unsafe: a reference into
   * the unread part of a `known` collection is reported broken, and a
   * reference held by an unread action, workflow or variable is not checked at
   * all. Neither shows up as a gap in the list, which is why it has to be said
   * outright.
   */
  const truncated = [
    actionDocs,
    workflowDocs,
    variableDocs,
    functionDocs,
    campaignDocs,
    overlayDocs,
    webhookDocs,
    screenDocs,
    productDocs,
    collectionDocs,
    categoryDocs,
    datasetDocs,
    listDocs,
  ].some((window) => window.truncated)

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
      actions: alive(actionDocs.rows),
      workflows: alive(workflowDocs.rows),
      variables: alive(variableDocs.rows),
      known: {
        workflows: knownSet(workflowDocs.rows),
        functions: knownSet(functionDocs.rows),
        datasets: knownSet(datasetDocs.rows),
        lists: knownSet(listDocs.rows),
        campaigns: knownSet(campaignDocs.rows),
        overlays: knownSet(overlayDocs.rows),
        webhooks: knownSet(webhookDocs.rows),
        screens: knownSet(screenDocs.rows, 'displayName'),
        products: knownSet(productDocs.rows),
        collections: knownSet(collectionDocs.rows),
        categories: knownSet(categoryDocs.rows),
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
      help={pluginDocsHelp('bindings', { anchor: '#where-used--safety' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1}>
        {truncated ? (
          <Alert severity="info">
            {`Audited against the first ${REFERENCE_CEILING} rows of each ` +
              'collection, ordered by id. At least one of them holds more, ' +
              'so a step pointing past that window is listed here as broken ' +
              'when it is not, and a step held past it is not checked at all.'}
          </Alert>
        ) : null}
        {issues.length === 0 ? (
          <Alert severity="success">
            {truncated
              ? 'Every reference the audit read resolves.'
              : 'Every automation, workflow, and variable reference resolves.'}
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
      </Stack>
    </CardDisplay>
  )
}
HostReferenceHealthCard.displayName = 'HostReferenceHealthCard'

export default HostReferenceHealthCard
