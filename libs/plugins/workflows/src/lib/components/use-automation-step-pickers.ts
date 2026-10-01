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

/**
 * WHAT A STEP CAN BE POINTED AT, read once per editor (AGL-3105).
 *
 * The step fields are shared by the Actions builder and the Workflows builder,
 * so what fills their pickers is read in one place too — the same six
 * collections, at the same ceiling, on the same latch. Two copies would be two
 * read costs to keep in agreement, and the console's read-cost spec measures
 * both surfaces against this one set.
 */

import { scopeTokensForHost } from '@aglyn/aglyn'
import { pluginContainerKind } from '@aglyn/aglyn/plugin-manager/plugin-containers'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the two PURE helpers — the cards' specs
 * mock `@aglyn/tenant-feature-instance` wholesale to stage their Firestore
 * hooks, and a query builder imported through that barrel disappears under
 * the mock. Neither of these is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { collection, query, where } from 'firebase/firestore'
import {
  pluginRecordListQuery,
  pluginRecordsFromRows,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { useMemo } from 'react'
import type { AutomationStepPickers } from './automation-step-fields.component'

/**
 * How many rows each of the step editor's six pickers offers.
 *
 * One number for all six because they are read together, by the same click,
 * and a reader comparing two of them should not have to know which one was cut
 * at fifty. Paid for only while the editor is open, which is what makes a
 * ceiling this size affordable: one author mid-edit rather than every visitor
 * to the page.
 */
export const EDITOR_OPTION_CEILING = 100

/** The pickers a step editor offers, and which of them the ceiling bit. */
export interface AutomationStepPickerData {
  pickers: AutomationStepPickers
  /** The lists that ran short, named as the editor's notice names them. */
  truncated: string[]
}

/**
 * The records a step can be pointed at on this site, read when the editor
 * that offers them is first opened.
 *
 * `editorOpened` is a LATCH the card holds, never the open dialog: keyed on
 * the dialog these subscriptions would be torn down on Cancel and bought
 * again on the next Edit, so an author working through ten automations would
 * pay for the same six windows ten times.
 */
export function useAutomationStepPickers(
  hostId: string,
  editorOpened: boolean,
): AutomationStepPickerData {
  const firestore = useFirestore()
  const { scope: dataScope } = useOrgDataScope({ hostId })
  /*
   * THE STEP EDITOR'S OPTION LISTS, read when the editor opens.
   *
   * Six collections, and nothing outside the dialog below reads any of them:
   * the table renders a step's stored name, never one looked up here. Mounting
   * them unconditionally charges every visitor to this page six windows to
   * populate selects most of them never open — the largest read on the
   * automation surface, paid whether or not anybody edits anything.
   *
   * Each is ceilinged and ordered for the reason the actions query above
   * gives: a bare `limit` is answered in document-id order, so the
   * `localeCompare` on every option list would arrange a pseudo-random sample
   * into a convincing alphabet, and a workflow or dataset past the window
   * could not be picked with nothing saying why.
   */
  const { data: workflowRead } = useFirestoreCollection<any>(
    () =>
      editorOpened
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'workflows'),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, hostId, editorOpened],
    { idField: '$id' },
  )
  const { rows: workflowDocs, truncated: workflowsTruncated } =
    ceilingedWindow<any>(workflowRead, EDITOR_OPTION_CEILING)
  // Scoped to the HOST, not the viewer (AGL-1044): an action runs ON this
  // host, so it may only reach org records THIS host can use — an org-wide
  // admin would otherwise be offered ones that resolve to nothing at render
  // time. Filtering by the host's tokens also satisfies the AGL-1041 rules,
  // which reject a scoped member's UNFILTERED list outright, since they are a
  // subset of any viewer's who can reach this host at all.
  // Memoised: this is a listener DEPENDENCY, and a fresh array each
  // render tears the subscription down and clears its data every time.
  const scopeTokens = useMemo(() => scopeTokensForHost(hostId), [hostId])
  // The datasets are the data plugin's, listed through the source it
  // publishes (AGL-3080), which applies the same host scoping.
  const datasetOrgId = dataScope?.[1] ?? null
  const { data: datasetRead } = useFirestoreCollection<any>(
    () =>
      editorOpened && datasetOrgId
        ? pluginRecordListQuery('dataset', firestore, {
            orgId: datasetOrgId,
            hostId,
            limit: EDITOR_OPTION_CEILING + 1,
          })
        : null,
    [firestore, datasetOrgId, hostId, editorOpened],
    { idField: '$id' },
  )
  const { rows: datasetRows, truncated: datasetsTruncated } =
    ceilingedWindow<any>(datasetRead, EDITOR_OPTION_CEILING)
  const { data: overlayRead } = useFirestoreCollection<any>(
    () =>
      editorOpened
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'overlays'),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, hostId, editorOpened],
    { idField: '$id' },
  )
  const { rows: overlayDocs, truncated: overlaysTruncated } =
    ceilingedWindow<any>(overlayRead, EDITOR_OPTION_CEILING)
  // Lists live on the org (AGL-254), and so do campaigns.
  const { data: listRead } = useFirestoreCollection<any>(
    () =>
      editorOpened && dataScope
        ? collectionCeiling(
            collection(firestore, dataScope[0], dataScope[1], 'lists'),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, dataScope, editorOpened],
    { idField: '$id' },
  )
  const { rows: listDocs, truncated: listsTruncated } = ceilingedWindow<any>(
    listRead,
    EDITOR_OPTION_CEILING,
  )
  /*
   * The campaign CONTAINERS — the `campaign` container kind, read where its
   * declaration says they are stored — which the executor resolves an
   * "Assign to a campaign" step's `campaignId` against when it runs
   * (AGL-3052). A send's id names no container, so a step pointed at one
   * fails every run with "unknown campaign". Nothing is read where no plugin
   * keeps the kind.
   *
   * The org's, narrowed to the ones placed on THIS site by the same host
   * tokens the datasets use — an automation runs on this site, so it may
   * only file under a campaign the site offers, and the clause is what
   * makes the list provable for a collaborator scoped to the site.
   */
  const campaignCollection = pluginContainerKind('campaign')?.orgCollection
  const { data: campaignRead } = useFirestoreCollection<any>(
    () =>
      editorOpened && dataScope && campaignCollection
        ? collectionCeiling(
            query(
              collection(firestore, dataScope[0], dataScope[1], campaignCollection),
              where('visibleTo', 'array-contains-any', scopeTokens),
            ),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, dataScope, scopeTokens, editorOpened, campaignCollection],
    { idField: '$id' },
  )
  const { rows: campaignDocs, truncated: campaignsTruncated } =
    ceilingedWindow<any>(campaignRead, EDITOR_OPTION_CEILING)
  const { data: webhookRead } = useFirestoreCollection<any>(
    () =>
      editorOpened
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'webhooks'),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, hostId, editorOpened],
    { idField: '$id' },
  )
  const { rows: webhookDocs, truncated: webhooksTruncated } =
    ceilingedWindow<any>(webhookRead, EDITOR_OPTION_CEILING)
  /**
   * Which of the six pickers the ceiling actually bit, named.
   *
   * One notice rather than six, because they are one read and an author who
   * has just been told the workflow list is short does not learn anything from
   * being told again about datasets.
   */
  const truncatedPickers = [
    workflowsTruncated ? 'workflows' : null,
    webhooksTruncated ? 'webhooks' : null,
    datasetsTruncated ? 'datasets' : null,
    overlaysTruncated ? 'overlays' : null,
    listsTruncated ? 'audiences' : null,
    campaignsTruncated ? 'campaigns' : null,
  ].filter((name): name is string => name !== null)
  // Options carry ids (AGL-261): selects store the doc id, keep the name
  // as the display hint, and legacy name-only steps map back to their id.
  const workflowOptions = (workflowDocs ?? [])
    .filter((workflow: any) => !workflow.deletedAt && workflow.name)
    .map((workflow: any) => ({
      id: workflow.$id as string,
      name: workflow.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  // Named as the Data page names them, by their owner.
  const datasetOptions = pluginRecordsFromRows('dataset', datasetRows)
    .map((dataset) => ({ id: dataset.id, name: dataset.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const overlayOptions = (overlayDocs ?? [])
    .filter((overlay: any) => !overlay.deletedAt)
    .map((overlay: any) => ({
      id: overlay.$id as string,
      name: (overlay.name ||
        overlay.bar?.text ||
        overlay.popup?.headline ||
        overlay.$id) as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const listOptions = (listDocs ?? [])
    .filter((list: any) => !list.deletedAt && list.name)
    .map((list: any) => ({
      id: list.$id as string,
      name: list.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const campaignOptions = (campaignDocs ?? [])
    .filter((campaign: any) => !campaign.deletedAt && campaign.name)
    .map((campaign: any) => ({
      id: campaign.$id as string,
      name: campaign.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const webhookOptions = (webhookDocs ?? [])
    .filter(
      (hook: any) =>
        !hook.deletedAt && hook.name && hook.direction === 'outbound',
    )
    .map((hook: any) => ({
      id: hook.$id as string,
      name: hook.name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  /** The records this site offers every step picker in the editor. */
  const stepPickers: AutomationStepPickers = {
    workflowOptions,
    datasetOptions,
    overlayOptions,
    listOptions,
    campaignOptions,
    webhookOptions,
  }
  return { pickers: stepPickers, truncated: truncatedPickers }
}
