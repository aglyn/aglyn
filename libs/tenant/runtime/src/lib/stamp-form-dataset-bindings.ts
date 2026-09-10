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

import { formDatasetBindingsOf } from '@aglyn/aglyn/app-utils/form-dataset-binding'
import { signFormDatasetBinding } from '@aglyn/tenant-data-admin/server/form-dataset-binding-token'

/** The prop a rendered `form` node carries its signed dataset binding in. */
export const FORM_DATASET_BINDING_PROP = 'datasetBindingToken'

/** Whether an unsigned render has been reported in this process yet. */
let reportedUnsigned = false

/**
 * Signs every `form` node's dataset binding into its props, for the submit
 * route to verify (AGL-2773).
 *
 * The route writes a record only where a valid signature says, so a form
 * without one still submits — the Inbox copy is always written — but adds no
 * record. That is what happens when `TOKEN_SIGNING_SECRET` is missing: the
 * tree is returned unsigned rather than failing the page render, and the
 * missing secret is reported once per process instead of once per render.
 *
 * Never mutates `nodes`; a tree with no bound form comes back as the same
 * object.
 */
export function stampFormDatasetBindings<N extends Record<string, any>>(
  nodes: N,
  hostId: string,
): N {
  const bindings = formDatasetBindingsOf(nodes as never)
  if (!bindings.length) return nodes
  const signed: Record<string, any> = { ...nodes }
  for (const { nodeId, binding } of bindings) {
    let token: string
    try {
      token = signFormDatasetBinding(hostId, binding)
    } catch (error) {
      if (!reportedUnsigned) {
        reportedUnsigned = true
        console.error(
          'Form dataset bindings are not being signed, so forms bound to a ' +
            'dataset will not write records',
          error,
        )
      }
      return nodes
    }
    const node = signed[nodeId]
    signed[nodeId] = {
      ...node,
      props: { ...(node?.props ?? {}), [FORM_DATASET_BINDING_PROP]: token },
    }
  }
  return signed as N
}
