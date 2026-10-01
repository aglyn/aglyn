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

import type { BindingRefVia } from '@aglyn/aglyn/app-utils/binding-tokens'
import type {
  PluginDependent,
  PluginDependentsAnswer,
  PluginDependentsRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-dependents'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * Which of a site's variables are computed from a workflow, for the "Used by"
 * scan — what the workflows plugin asks before a workflow is renamed or
 * deleted, since each of these falls back to its stored value once the
 * workflow is gone.
 *
 * A computed variable names its workflow by document id and, as a display
 * hint, by the name it had when it was picked (AGL-261); one computed before
 * ids existed carries the name alone. The id survives a rename, the name does
 * not. A deleted variable is left out.
 */

/** How many of a site's variables one scan reads. */
export const WORKFLOW_DEPENDENTS_VARIABLES_READ = 100

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export async function findWorkflowDependents(
  request: PluginDependentsRequest,
): Promise<PluginDependentsAnswer> {
  const id = request.id.trim()
  const name = text(request.name)
  if (!request.hostId || (!id && !name)) return { dependents: [], truncated: false }
  // One more than is read, so `truncated` is a fact rather than a guess.
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(request.hostId)
    .collection('variables')
    .limit(WORKFLOW_DEPENDENTS_VARIABLES_READ + 1)
    .get()
  const dependents: PluginDependent[] = []
  for (const doc of snapshot.docs.slice(0, WORKFLOW_DEPENDENTS_VARIABLES_READ)) {
    const data = doc.data() ?? {}
    if (data['deletedAt'] != null) continue
    const via: BindingRefVia[] = []
    if (id && text(data['workflowId']) === id) via.push('id')
    if (name && text(data['workflowName']) === name) via.push('name')
    if (!via.length) continue
    dependents.push({
      type: 'variable',
      id: doc.id,
      name: text(data['name']) || doc.id,
      via,
    })
  }
  return { dependents, truncated: snapshot.size > WORKFLOW_DEPENDENTS_VARIABLES_READ }
}
