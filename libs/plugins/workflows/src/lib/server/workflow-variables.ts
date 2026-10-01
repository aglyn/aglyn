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

import type { VariableComputation } from '@aglyn/aglyn/plugin-manager/computed-variables'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import { type HostWorkflow, resolveComputedVariables } from '../model/workflows'

/**
 * The site variables a workflow computes (AGL-129), as this plugin answers
 * the page's compose pipeline through the core's variable-computer seam.
 *
 * The site's workflows are read beside the page's other reads (`prepare` is
 * issued with them), cached exactly as the page's own variables and
 * functions are, and run once the variables and functions are in hand. Each
 * computed variable that names a workflow — by id first, then by name —
 * takes its result; one whose workflow is gone or fails keeps its stored
 * value.
 */

/** As long as the page's own data, and dropped by the same publish tag. */
const SITE_WORKFLOWS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/** How many of a site's workflows a page reads to compute its variables. */
export const COMPUTED_VARIABLE_WORKFLOWS_READ = 100

export async function prepareWorkflowVariables(hostId: string): Promise<VariableComputation> {
  const workflows = await siteWorkflows(hostId)
  return ({ variables, functions }) => resolveComputedVariables(variables, functions, workflows)
}

/**
 * The site's live workflows, keyed by document id AND by name (AGL-261): an id
 * reference is rename-safe, and a variable picked before ids existed names
 * its workflow. Fails open — a failed read computes nothing, and every
 * variable keeps its stored value.
 */
async function siteWorkflows(hostId: string): Promise<Record<string, HostWorkflow>> {
  const read = () => readSiteWorkflows(hostId)
  try {
    return await withRenderCache({
      key: ['tenant-workflows', hostId],
      revalidate: SITE_WORKFLOWS_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read,
    })
  } catch (error) {
    console.error(error)
    return read()
  }
}

async function readSiteWorkflows(hostId: string): Promise<Record<string, HostWorkflow>> {
  const workflows: Record<string, HostWorkflow> = {}
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('workflows')
      .limit(COMPUTED_VARIABLE_WORKFLOWS_READ)
      .get()
    for (const doc of snapshot.docs) {
      const data = doc.data() as HostWorkflow & { deletedAt?: unknown }
      if (data.deletedAt) continue
      workflows[doc.id] = data
      if (data.name) workflows[data.name] = data
    }
  } catch (error) {
    console.error(error)
  }
  return workflows
}
