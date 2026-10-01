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

import { scopeCovers } from '@aglyn/aglyn/app-utils/scope-tokens'
import { pluginContainerKind } from '@aglyn/aglyn/plugin-manager/plugin-containers'
import {
  pluginRecordListQuery,
  pluginRecordsFromRows,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the two pure helpers — the cards' specs
 * mock `@aglyn/tenant-feature-instance` wholesale, and a query builder
 * imported through that barrel disappears under the mock.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { collection } from 'firebase/firestore'
import { useMemo } from 'react'
import type { AutomationStepPickers } from './automation-step-fields.component'
import {
  type AutomationStepPickerData,
  EDITOR_OPTION_CEILING,
} from './use-automation-step-pickers'

/**
 * WHAT AN ORG AUTOMATION'S STEPS CAN BE POINTED AT (AGL-3302).
 *
 * The site editor's pickers read one site's records; an org automation runs
 * on every site it is placed on, so its pickers read the ORGANIZATION's —
 * the lists, the datasets and the campaign containers — and offer only what
 * every one of those sites can use. A dataset or a campaign shared with some
 * of the org's sites and not the others would resolve on one site and fail
 * the step on the next, so a record is offered only when its own sharing
 * covers the automation's placement (`scopeCovers`). A list belongs to the
 * whole organization and is always offered.
 *
 * The site-only pickers — workflows, overlays, webhooks — are empty: no step
 * an org automation may hold points at one.
 *
 * Read on the same latch and at the same ceiling as the site editor's, and
 * paid only by an author who opens the editor.
 */
export function useOrgAutomationStepPickers(
  orgId: string,
  editorOpened: boolean,
  placement: readonly string[],
): AutomationStepPickerData {
  const firestore = useFirestore()
  /*
   * The organization's own datasets, listed through the source the data
   * plugin publishes (AGL-3080): the org hub admits only org-wide members,
   * who read every dataset, and placement narrows them below.
   */
  const { data: datasetRead } = useFirestoreCollection<any>(
    () =>
      editorOpened && orgId
        ? pluginRecordListQuery('dataset', firestore, {
            orgId,
            hostId: null,
            limit: EDITOR_OPTION_CEILING + 1,
          })
        : null,
    [firestore, orgId, editorOpened],
    { idField: '$id' },
  )
  const { rows: datasetRows, truncated: datasetsTruncated } =
    ceilingedWindow<any>(datasetRead, EDITOR_OPTION_CEILING)
  const { data: listRead } = useFirestoreCollection<any>(
    () =>
      editorOpened && orgId
        ? collectionCeiling(
            collection(firestore, 'orgs', orgId, 'lists'),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, orgId, editorOpened],
    { idField: '$id' },
  )
  const { rows: listDocs, truncated: listsTruncated } = ceilingedWindow<any>(
    listRead,
    EDITOR_OPTION_CEILING,
  )
  // The `campaign` container kind, where its declaration says it is stored.
  const campaignCollection = pluginContainerKind('campaign')?.orgCollection
  const { data: campaignRead } = useFirestoreCollection<any>(
    () =>
      editorOpened && orgId && campaignCollection
        ? collectionCeiling(
            collection(firestore, 'orgs', orgId, campaignCollection),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, orgId, editorOpened, campaignCollection],
    { idField: '$id' },
  )
  const { rows: campaignDocs, truncated: campaignsTruncated } =
    ceilingedWindow<any>(campaignRead, EDITOR_OPTION_CEILING)

  const pickers = useMemo<AutomationStepPickers>(() => {
    const covers = (row: any) =>
      scopeCovers(row?.visibleTo as string[] | undefined, placement)
    return {
      workflowOptions: [],
      overlayOptions: [],
      webhookOptions: [],
      datasetOptions: pluginRecordsFromRows('dataset', datasetRows)
        .filter((dataset) => scopeCovers(dataset.facts['visibleTo'] as string[] | undefined, placement))
        .map((dataset) => ({ id: dataset.id, name: dataset.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      listOptions: (listDocs ?? [])
        .filter((list: any) => !list.deletedAt && list.name)
        .map((list: any) => ({ id: list.$id as string, name: list.name as string }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      campaignOptions: (campaignDocs ?? [])
        .filter((campaign: any) => !campaign.deletedAt && campaign.name)
        .filter(covers)
        .map((campaign: any) => ({
          id: campaign.$id as string,
          name: campaign.name as string,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [datasetRows, listDocs, campaignDocs, placement])

  const truncated = [
    datasetsTruncated ? 'datasets' : null,
    listsTruncated ? 'audiences' : null,
    campaignsTruncated ? 'campaigns' : null,
  ].filter((name): name is string => name !== null)
  return { pickers, truncated }
}
