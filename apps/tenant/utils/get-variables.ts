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

import type * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Fetches the host's variables keyed by binding name (AGL-91). Fail-open:
 * on error an empty map is returned and `{{name}}` tokens render literally.
 */
export async function getVariables(options: {
  hostId: string
}): Promise<Record<string, Aglyn.HostVariable>> {
  const variables: Record<string, Aglyn.HostVariable> = {}
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('variables')
      .limit(100)
      .get()
    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data() as Aglyn.HostVariable
      if (data?.name && !((data as any).deletedAt)) {
        variables[data.name] = data
      }
    }
  } catch (error) {
    console.error(error)
  }
  return variables
}

/**
 * Fetches the host's function definitions keyed by name for
 * `{{fn:name(...)}}` bindings (AGL-93). Fail-open like variables.
 */
export async function getFunctions(options: {
  hostId: string
}): Promise<Record<string, Aglyn.HostFunction>> {
  const functions: Record<string, Aglyn.HostFunction> = {}
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('functions')
      .limit(100)
      .get()
    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data() as Aglyn.HostFunction
      if (data?.name && !(data as any).deletedAt) {
        // Plain evaluator fields only: doc timestamps aren't
        // JSON-serializable and definitions embed into page props.
        functions[data.name] = {
          name: data.name,
          parameters: data.parameters ?? [],
          variables: data.variables ?? [],
          operations: data.operations ?? [],
          ...(data.returnValue && { returnValue: data.returnValue }),
        }
      }
    }
  } catch (error) {
    console.error(error)
  }
  return functions
}

export default getVariables

/**
 * Fetches the host's workflows keyed by name for computed variables and
 * function→workflow calls (AGL-129). Fail-open like variables.
 */
export async function getWorkflows(options: {
  hostId: string
}): Promise<Record<string, Aglyn.HostWorkflow>> {
  const workflows: Record<string, Aglyn.HostWorkflow> = {}
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(options.hostId)
      .collection('workflows')
      .limit(100)
      .get()
    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data() as Aglyn.HostWorkflow
      if (data?.name && !(data as any).deletedAt) {
        workflows[data.name] = data
      }
    }
  } catch (error) {
    console.error(error)
  }
  return workflows
}
