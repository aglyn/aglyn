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

import * as Aglyn from '@aglyn/aglyn'
import { useContext, useEffect, useMemo } from 'react'

import {
  BindingPickerContext,
  type BindingOption,
} from '../contexts/binding-picker-context'
import type { TokenLabelContext } from '../utils/token-segments'

export interface InsertTokenOptionsResult {
  /**
   * The full grouped picker list (AGL-583): host bindings first (AGL-100),
   * then the data-placeholder catalogs. Entry/Collection stay browsable
   * even out of context — with a hint saying where they resolve — while
   * the Dataset item group only appears inside a resolvable repeatable.
   */
  options: BindingOption[]
  /** Display-name resolution inputs for pill rendering (AGL-586). */
  labelContext: TokenLabelContext
}

/**
 * Assembles the insert-picker options for a canvas node from ITS context
 * (AGL-583, extracted for AGL-586 so the attributes panel and the inline
 * text editor share one walk): the ancestor chain is scanned for a
 * repeatable container (dataset-item tokens need its model fields) and for
 * a Collection entries block (entry tokens resolve right there, not only
 * on entry pages). `repeatDataset` persists a dataset id OR a legacy
 * display name — either resolves against the entity picker options.
 */
export function useInsertTokenOptions(
  node?: Aglyn.NodeSchema<any> | null,
): InsertTokenOptionsResult {
  const {
    options: bindingOptions,
    variables: bindingVariables,
    functions: bindingFunctions,
    componentProps,
  } = useContext(BindingPickerContext)
  const entityOptions = useContext(Aglyn.EntityPickerContext)

  const insertContext = useMemo(() => {
    const nodes = (Aglyn.canvas.toJSON().nodes ?? {}) as Record<string, any>
    let repeatDatasetKey: string | undefined
    let inCollectionEntries = false
    let current = node?.$id ? nodes[node.$id] : undefined
    for (let hops = 0; current && hops < 100; hops += 1) {
      const props = current.props ?? {}
      if (
        !repeatDatasetKey &&
        typeof props.repeatDataset === 'string' &&
        props.repeatDataset.trim()
      ) {
        repeatDatasetKey = props.repeatDataset.trim()
      }
      if (current.componentId === Aglyn.COLLECTION_ENTRIES_COMPONENT_ID) {
        inCollectionEntries = true
      }
      current = current.parentId ? nodes[current.parentId] : undefined
    }
    const datasets = entityOptions.datasets ?? []
    /*
     * The browse window is a PAGE of the org's datasets, so a repeat bound to
     * one outside it matches nothing here — and this is where the token menu
     * would silently stop offering that dataset's fields on exactly the
     * orgs with enough datasets to need them. A resolution counts as a match,
     * which is the same keyed read the attributes panel already spends on a
     * picker's stored value.
     */
    const dataset = repeatDatasetKey
      ? datasets.find((candidate) => candidate.id === repeatDatasetKey) ??
        datasets.find((candidate) => candidate.label === repeatDatasetKey) ??
        entityOptions.resolved?.datasets?.[repeatDatasetKey] ??
        undefined
      : undefined
    return {
      inCollectionEntries,
      datasetLabel: dataset?.label,
      datasetFields: dataset
        ? entityOptions.datasetFields?.[dataset.id] ?? []
        : [],
      // Carried out of the walk so the effect below can ask for the dataset
      // list without repeating it.
      repeatDatasetKey,
    }
  }, [
    node,
    entityOptions.datasets,
    entityOptions.datasetFields,
    entityOptions.resolved,
  ])

  /**
   * Ask for the dataset list, and only when this node is inside a repeat
   * bound to one (AGL-703).
   *
   * This hook runs on every selection — the props form and the inline text
   * editor both call it — so requesting unconditionally would put the
   * provider back to reading datasets on every click. `repeatDatasetKey` is
   * the precise condition: without it there is no dataset to name and the
   * token menu offers none.
   */
  const requestEntities = entityOptions.request
  const resolveEntity = entityOptions.resolve
  useEffect(() => {
    const key = insertContext.repeatDatasetKey
    if (!key) return
    requestEntities?.('datasets')
    // Nothing to look up once the dataset is named. `repeatDataset` may hold
    // a legacy DISPLAY NAME, which the label match above answers from the
    // window — reading a document at that name as though it were an id would
    // be a read that could only ever miss.
    if (insertContext.datasetLabel) return
    const id = Aglyn.entityValueNeedsResolution(entityOptions, 'datasets', key)
    if (id) resolveEntity?.('datasets', id)
  }, [
    requestEntities,
    resolveEntity,
    entityOptions,
    insertContext.repeatDatasetKey,
    insertContext.datasetLabel,
  ])

  const options = useMemo(() => {
    const assembled: BindingOption[] = [...(bindingOptions ?? [])]
    /**
     * The component's own declared props (AGL-1335), first because they are
     * the nearest scope — inside a component definition, `{{prop.x}}` is
     * what the author reaches for most.
     *
     * They were absent from this picker entirely, so binding one meant
     * typing `{{prop.name}}` by hand while a `{}` button sat next to the
     * field implying otherwise. Names are filtered by the SAME pattern the
     * graft requires, so the picker cannot offer a token that would never
     * substitute.
     */
    for (const prop of componentProps ?? []) {
      if (!Aglyn.COMPONENT_PROP_NAME_PATTERN.test(prop?.name ?? '')) continue
      assembled.push({
        group: 'Properties',
        groupHint: 'Set per page in the Attributes panel of each instance',
        label: prop.label || prop.name,
        token: `{{${Aglyn.COMPONENT_PROP_TOKEN_PREFIX}${prop.name}}}`,
        preview: prop.defaultValue
          ? `Defaults to "${prop.defaultValue}"`
          : 'No default — renders as nothing until a page sets it',
      })
    }
    const entryHint = insertContext.inCollectionEntries
      ? undefined
      : 'Resolves in Collection entries blocks and on entry pages'
    for (const entry of Aglyn.ENTRY_TOKEN_CATALOG) {
      assembled.push({
        group: 'Entry',
        label: entry.label,
        token: entry.token,
        preview: entry.description,
        ...(entryHint ? { groupHint: entryHint } : {}),
      })
    }
    for (const entry of Aglyn.COLLECTION_TOKEN_CATALOG) {
      assembled.push({
        group: 'Collection',
        label: entry.label,
        token: entry.token,
        preview: entry.description,
        groupHint: 'Resolves on collection pages',
      })
    }
    for (const field of insertContext.datasetFields) {
      assembled.push({
        group: 'Dataset item',
        label: field.label,
        token: Aglyn.datasetItemToken(field.id),
        ...(insertContext.datasetLabel
          ? { groupHint: `From dataset "${insertContext.datasetLabel}"` }
          : {}),
      })
    }
    return assembled
  }, [bindingOptions, componentProps, insertContext])

  const labelContext = useMemo<TokenLabelContext>(
    () => ({
      options,
      variables: bindingVariables as TokenLabelContext['variables'],
      functions: bindingFunctions as TokenLabelContext['functions'],
      datasetFields: insertContext.datasetFields,
    }),
    [options, bindingVariables, bindingFunctions, insertContext.datasetFields],
  )

  return useMemo(
    () => ({ options, labelContext }),
    [options, labelContext],
  )
}

export default useInsertTokenOptions
