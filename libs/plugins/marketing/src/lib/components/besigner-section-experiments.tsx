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

import {
  createResourceUid,
  type ConsoleBesignerInteractionsZoneProps,
  type ConsoleBesignerSectionExperiment,
} from '@aglyn/aglyn'
import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo } from 'react'

/** The name this plugin reports under; the section keys reports by it. */
const REPORTER_ID = 'marketing-section-experiments'

/**
 * The site's section experiments, reported to the besigner's Interactions
 * section through the `besignerInteractions` zone. Draws nothing.
 *
 * The section badges an element that has an experiment and refuses a second
 * one on it, so it is handed every live section experiment on the site, not
 * only those on the page in the editor: an element of a layout or a component
 * is the same node on every page that places it.
 *
 * Starting one writes a DRAFT, with two even variants and the form-submission
 * goal, on the page under edit. Nothing serves until it is started from the
 * A/B testing list, where its variants' versions are pinned. It is written
 * through `writeSiteWideChange` all the same, like every other write of the
 * site's experiments: the page enricher reads the collection at render, and
 * whether one document of it changes what a page shows is not this widget's
 * to judge.
 */
export function BesignerSectionExperiments(
  props: ConsoleBesignerInteractionsZoneProps,
) {
  const { hostId, screenId, reportSectionExperiments } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(collection(firestore, 'hosts', hostId, 'experiments'), limit(50))
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )

  const experiments = useMemo<ConsoleBesignerSectionExperiment[]>(
    () =>
      (experimentDocs ?? [])
        .filter(
          (experiment: any) =>
            !experiment.deletedAt &&
            experiment.target === 'section' &&
            experiment.nodeId,
        )
        .map((experiment: any) => ({
          id: experiment.$id as string,
          name: experiment.name as string | undefined,
          nodeId: experiment.nodeId as string,
          status: experiment.status as string | undefined,
        })),
    [experimentDocs],
  )

  const create = useCallback(
    ({ nodeId }: { nodeId: string }) => {
      if (!screenId) return
      const id = createResourceUid()
      void writeSiteWideChange({
        firestore,
        user,
        hostId,
        write: (batch) =>
          batch.set(doc(firestore, 'hosts', hostId, 'experiments', id), {
            // With the search keys the A/B testing list's filter and search
            // read (AGL-3321).
            ...nameSearchFields(`Section test — ${nodeId.slice(0, 8)}`),
            status: 'draft',
            target: 'section',
            screenId,
            nodeId,
            variants: [
              { id: 'a', name: 'A (control)', weight: 1 },
              { id: 'b', name: 'B', weight: 1 },
            ],
            goal: { event: 'formSubmission' },
            createdAt: Timestamp.now(),
          }),
      })
        .then(() =>
          enqueueSnackbar(
            'Draft experiment created — pin variant versions and ' +
              'start it from Marketing → Experiments',
            { variant: 'success', persist: false },
          ),
        )
        .catch((error) => {
          console.error(error)
          enqueueSnackbar('Could not create the experiment', {
            variant: 'error',
          })
        })
    },
    [firestore, user, hostId, screenId, enqueueSnackbar],
  )

  useEffect(() => {
    reportSectionExperiments(REPORTER_ID, {
      experiments,
      ...(screenId ? { create } : {}),
    })
  }, [reportSectionExperiments, experiments, screenId, create])

  // Withdrawn when the zone stops drawing this plugin: switched off for the
  // workspace, or the editor closed.
  useEffect(
    () => () => reportSectionExperiments(REPORTER_ID, null),
    [reportSectionExperiments],
  )

  return null
}

export default BesignerSectionExperiments
