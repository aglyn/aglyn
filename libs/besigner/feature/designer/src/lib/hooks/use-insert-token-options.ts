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
import {
  AUTHOR_TOKEN_CATALOG,
  canvas,
  COLLECTION_ENTRIES_COMPONENT_ID,
  COLLECTION_TOKEN_CATALOG,
  COMPONENT_PROP_NAME_PATTERN,
  COMPONENT_PROP_TOKEN_PREFIX,
  EntityPickerContext,
  entityValueNeedsResolution,
  ENTRY_TOKEN_CATALOG,
  readYesNoValue,
  repeatItemToken,
  reusablePropDefaultValue,
  reusablePropHasAnswers,
  reusablePropValueClass,
} from '@aglyn/aglyn'
import {
  getRepeatSourcesVersion,
  repeatSourceOf,
  subscribeRepeatSources,
} from '@aglyn/aglyn/app-utils/repeat-sources'
import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react'

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
   * the item group only appears inside a repeat whose entity resolves.
   */
  options: BindingOption[]
  /** Display-name resolution inputs for pill rendering (AGL-586). */
  labelContext: TokenLabelContext
}

/**
 * A component's or layout's own declared props as picker options (AGL-1335).
 * A free-text field offers every one; a field with no text box is handed only
 * the properties it can be bound to (see `withPropertyBinding`).
 *
 * Names are filtered by the SAME pattern the graft requires, so a picker can
 * never offer a token that would not substitute.
 */
export function componentPropBindingOptions(
  componentProps: readonly Aglyn.ReusableComponentProp[] | undefined | null,
  owner: 'component' | 'layout' = 'component',
): BindingOption[] {
  const options: BindingOption[] = []
  for (const prop of componentProps ?? []) {
    if (!COMPONENT_PROP_NAME_PATTERN.test(prop?.name ?? '')) continue
    options.push({
      group: 'Properties',
      groupHint:
        owner === 'layout'
          ? 'Set per page in the Page Properties of each page using this layout'
          : // Pages and emails alike: an email block is a component too
            // (AGL-3287), and its values are set in each email it is in.
            'Set in the Attributes panel wherever this component is used',
      label: prop.label || prop.name,
      token: `{{${COMPONENT_PROP_TOKEN_PREFIX}${prop.name}}}`,
      preview: componentPropDefaultPreview(prop),
    })
  }
  return options
}

/** The picker's second line for a property: what a page that sets nothing gets. */
export function componentPropDefaultPreview(
  prop: Aglyn.ReusableComponentProp,
): string {
  const valueClass = reusablePropValueClass(prop)
  if (valueClass === 'boolean') {
    // A yes/no has no "nothing": unset with no default substitutes `''`,
    // which every Yes / no reader takes for a no.
    return readYesNoValue(prop.defaultValue) === true
      ? 'Defaults to Yes'
      : 'Defaults to No'
  }
  if (valueClass === 'icon') {
    // An icon id is not something to read out; the picker shows the icon.
    return prop.defaultValue
      ? 'Defaults to the icon picked in Properties'
      : 'No default — shows no icon until a page picks one'
  }
  const fallback = reusablePropDefaultValue(prop)
  if (reusablePropHasAnswers(prop)) {
    // Named by the label a page author picks, not the value a field gets.
    const chosen = (Array.isArray(fallback) ? fallback : [fallback])
      .map((value) => {
        const answer = (prop.options ?? []).find(
          (option) => option?.value && option.value === value,
        )
        return answer ? answer.label || answer.value : undefined
      })
      .filter(Boolean)
    return chosen.length
      ? `Defaults to ${chosen.join(', ')}`
      : 'No default — the field keeps its own until a page chooses'
  }
  if (fallback === undefined) {
    return valueClass === 'text'
      ? 'No default — renders as nothing until a page sets it'
      : 'No default — the field keeps its own until a page sets it'
  }
  return `Defaults to "${Array.isArray(fallback) ? fallback.join(', ') : String(fallback)}"`
}

/**
 * Assembles the insert-picker options for a canvas node from ITS context
 * (AGL-583, extracted for AGL-586 so the attributes panel and the inline
 * text editor share one walk): the ancestor chain is scanned for the
 * nearest repeat (its item tokens need the fields of the entity it repeats
 * over) and for a Collection entries block (entry tokens resolve right
 * there, not only on entry pages).
 *
 * A repeat is found through the registered repeat sources, never by a prop
 * name: the source says which prop holds its key and which entity picker
 * kind the key names (`RepeatSource.entityKind`). A key may be an entity id
 * OR a legacy display name — either resolves against the picker's options.
 */
export function useInsertTokenOptions(
  node?: Aglyn.NodeSchema<any> | null,
): InsertTokenOptionsResult {
  const {
    options: bindingOptions,
    variables: bindingVariables,
    functions: bindingFunctions,
    componentProps,
    componentPropsOwner,
  } = useContext(BindingPickerContext)
  const entityOptions = useContext(EntityPickerContext)
  // A plugin registers its repeat source when its console bundle loads,
  // which can be after this node was selected; the walk is redone then.
  const repeatSourcesVersion = useSyncExternalStore(
    subscribeRepeatSources,
    getRepeatSourcesVersion,
    getRepeatSourcesVersion,
  )

  const insertContext = useMemo(() => {
    const nodes = (canvas.toJSON().nodes ?? {}) as Record<string, any>
    let repeat: ReturnType<typeof repeatSourceOf> = undefined
    let inCollectionEntries = false
    let current = node?.$id ? nodes[node.$id] : undefined
    for (let hops = 0; current && hops < 100; hops += 1) {
      repeat ??= repeatSourceOf(current)
      if (current.componentId === COLLECTION_ENTRIES_COMPONENT_ID) {
        inCollectionEntries = true
      }
      current = current.parentId ? nodes[current.parentId] : undefined
    }
    const kind = repeat?.source.entityKind
    const key = kind ? repeat?.key : undefined
    const listed = kind ? entityOptions[kind] ?? [] : []
    /*
     * The browse window is a PAGE of the site's entities, so a repeat bound to
     * one outside it matches nothing here — and this is where the token menu
     * would silently stop offering that entity's fields on exactly the sites
     * with enough of them to need them. A resolution counts as a match, which
     * is the same keyed read the attributes panel already spends on a
     * picker's stored value.
     */
    const entity =
      kind && key
        ? listed.find((candidate) => candidate.id === key) ??
          listed.find((candidate) => candidate.label === key) ??
          entityOptions.resolved?.[kind]?.[key] ??
          undefined
        : undefined
    return {
      inCollectionEntries,
      // What the repeat's items are called in the menu — the source's own
      // name for what it repeats over.
      itemNoun: repeat?.source.label,
      entityLabel: entity?.label,
      itemFields:
        kind && entity ? entityOptions.entityFields?.[kind]?.[entity.id] ?? [] : [],
      // Carried out of the walk so the effect below can ask for the entity
      // list without repeating it.
      entityKind: kind,
      entityKey: key,
    }
    // `repeatSourcesVersion` is read by `repeatSourceOf` through the registry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, entityOptions, repeatSourcesVersion])

  /**
   * Ask for the repeated entity's list, and only when this node is inside a
   * repeat whose source names one (AGL-703).
   *
   * This hook runs on every selection — the props form and the inline text
   * editor both call it — so requesting unconditionally would put the
   * provider back to reading a list on every click. The repeat's key is the
   * precise condition: without it there is no entity to name and the token
   * menu offers no item tokens.
   */
  const requestEntities = entityOptions.request
  const resolveEntity = entityOptions.resolve
  useEffect(() => {
    const { entityKind: kind, entityKey: key } = insertContext
    if (!kind || !key) return
    requestEntities?.(kind)
    // Nothing to look up once the entity is named. A key may be a legacy
    // DISPLAY NAME, which the label match above answers from the window —
    // reading a document at that name as though it were an id would be a
    // read that could only ever miss.
    if (insertContext.entityLabel) return
    const id = entityValueNeedsResolution(entityOptions, kind, key)
    if (id) resolveEntity?.(kind, id)
  }, [requestEntities, resolveEntity, entityOptions, insertContext])

  const options = useMemo(() => {
    const assembled: BindingOption[] = [...(bindingOptions ?? [])]
    /**
     * The component's own declared props (AGL-1335), first because they are
     * the nearest scope — inside a component definition, `{{prop.x}}` is
     * what the author reaches for most.
     *
     * They were absent from this picker entirely, so binding one meant
     * typing `{{prop.name}}` by hand while a `{}` button sat next to the
     * field implying otherwise.
     */
    assembled.push(
      ...componentPropBindingOptions(componentProps, componentPropsOwner),
    )
    const entryHint = insertContext.inCollectionEntries
      ? undefined
      : 'Resolves in Collection entries blocks and on entry pages'
    for (const entry of ENTRY_TOKEN_CATALOG) {
      assembled.push({
        group: 'Entry',
        label: entry.label,
        token: entry.token,
        preview: entry.description,
        ...(entryHint ? { groupHint: entryHint } : {}),
      })
    }
    for (const entry of COLLECTION_TOKEN_CATALOG) {
      assembled.push({
        group: 'Collection',
        label: entry.label,
        token: entry.token,
        preview: entry.description,
        groupHint: 'Resolves on collection pages',
      })
    }
    for (const entry of AUTHOR_TOKEN_CATALOG) {
      assembled.push({
        group: 'Author',
        label: entry.label,
        token: entry.token,
        preview: entry.description,
        groupHint: 'Resolves on author pages',
      })
    }
    for (const field of insertContext.itemFields) {
      assembled.push({
        group: `${insertContext.itemNoun ?? 'Repeat'} item`,
        label: field.label,
        token: repeatItemToken(field.id),
        ...(insertContext.entityLabel
          ? {
              groupHint: `From ${(insertContext.itemNoun ?? 'repeat').toLowerCase()} "${insertContext.entityLabel}"`,
            }
          : {}),
      })
    }
    return assembled
  }, [bindingOptions, componentProps, componentPropsOwner, insertContext])

  const labelContext = useMemo<TokenLabelContext>(
    () => ({
      options,
      variables: bindingVariables as TokenLabelContext['variables'],
      functions: bindingFunctions as TokenLabelContext['functions'],
      itemFields: insertContext.itemFields,
    }),
    [options, bindingVariables, bindingFunctions, insertContext.itemFields],
  )

  return useMemo(
    () => ({ options, labelContext }),
    [options, labelContext],
  )
}

export default useInsertTokenOptions
