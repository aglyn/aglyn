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

import type { AglynNodeSchema, NodeId } from '../foundation'
import { collectFormFieldNodeIds, FORM_COMPONENT_ID } from './forms'

/**
 * Where a form's submissions are also written as dataset records, read off
 * the form as a page renders it.
 */
export interface FormDatasetBinding {
  /** The dataset, by id, so renaming it never breaks the binding (AGL-556). */
  datasetId?: string
  /** The legacy by-name binding, honored when no id is set (AGL-141). */
  datasetName?: string
  /** Submitted field name → the dataset field id the value is stored under. */
  fieldMap: Record<string, string>
}

/** The most fields a submission may carry, and so the most a map can name. */
export const FORM_DATASET_BINDING_MAX_FIELDS = 20

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * The dataset binding a `form` node declares, or null when it declares none.
 *
 * The map is built the way the browser builds the submission: every
 * `formField` under the form, in reading order, keyed by the name the field
 * submits under (`fieldName`, or `field` when it has none), and a later field
 * under the same name replaces an earlier one. A field with no
 * `datasetFieldId` maps nothing and its value falls back to matching dataset
 * fields by name.
 *
 * Read from the COMPOSED tree, so a form grafted from a layout, a reusable
 * component or a form entity is read exactly as the page renders it.
 */
export function formDatasetBindingOf(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
  formNodeId: NodeId,
): FormDatasetBinding | null {
  const node = nodes?.[formNodeId]
  if (node?.componentId !== FORM_COMPONENT_ID) return null
  const props = (node.props ?? {}) as Record<string, unknown>
  const datasetId = text(props['datasetId'], 128)
  const datasetName = text(props['datasetName'], 60)
  if (!datasetId && !datasetName) return null
  const fieldMap: Record<string, string> = {}
  for (const fieldNodeId of collectFormFieldNodeIds(nodes, formNodeId)) {
    const fieldProps = (nodes?.[fieldNodeId]?.props ?? {}) as Record<
      string,
      unknown
    >
    const datasetFieldId = text(fieldProps['datasetFieldId'], 64)
    if (!datasetFieldId) continue
    const submittedKey = text(fieldProps['fieldName'], 64) || 'field'
    if (
      !(submittedKey in fieldMap) &&
      Object.keys(fieldMap).length >= FORM_DATASET_BINDING_MAX_FIELDS
    ) {
      continue
    }
    fieldMap[submittedKey] = datasetFieldId
  }
  return {
    ...(datasetId ? { datasetId } : {}),
    ...(datasetName ? { datasetName } : {}),
    fieldMap,
  }
}

/** Every `form` node in a composed tree that declares a dataset binding. */
export function formDatasetBindingsOf(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
): Array<{ nodeId: NodeId; binding: FormDatasetBinding }> {
  const found: Array<{ nodeId: NodeId; binding: FormDatasetBinding }> = []
  for (const [nodeId, node] of Object.entries(nodes ?? {})) {
    if (node?.componentId !== FORM_COMPONENT_ID) continue
    const binding = formDatasetBindingOf(nodes, nodeId as NodeId)
    if (binding) found.push({ nodeId: nodeId as NodeId, binding })
  }
  return found
}
