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

import type { ComponentType } from 'react'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * Custom field types (AGL-434, Strapi custom-fields parity): a plugin
 * declares a NAMED field type that rides an EXISTING dataset storage type
 * — no new storage primitives, so records stay portable and every query/
 * binding path keeps working. The dataset schema editor offers registered
 * types; a field using one stores `customType` next to its base `type`,
 * the record editor mounts the plugin's Input, and the custom `validate`
 * runs on BOTH sides (editor pre-save and the server import/write paths)
 * after the base-type validation.
 *
 * Register the pure-data half (no `Input`) from the plugin's
 * `serverDeclarations`, which every app runs at boot, so each server path
 * that writes a record — the console's and the tenant's, including a public
 * form and an automation step — validates it without loading the plugin's
 * surfaces (AGL-2773). The client barrel registers it again with the Input.
 */

/** Storage subset custom types may ride (mirrors Strapi's limitation). */
export type CustomFieldBaseType = 'text' | 'bool' | 'int32' | 'float' | 'map'

export interface CustomFieldInputProps {
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  label?: string
}

export interface CustomFieldType {
  /** Stable name persisted on field definitions ('rating'); never rename. */
  name: string
  pluginId: string
  label: string
  baseType: CustomFieldBaseType
  description?: string
  /** Record-editor input; base-type input is the fallback when absent. */
  Input?: ComponentType<CustomFieldInputProps>
  /** Runs after base-type validation; returns an error message or null. */
  validate?: (value: unknown) => string | null
}

/**
 * The registry, held on `globalThis` rather than in a module `const`
 * (AGL-3412, AGL-2773). A plugin's server declarations register its field
 * types from the app's `instrumentation.ts`, which Next compiles into a
 * different module graph from the routes that validate records, so a
 * module-scoped map is filled in one copy and read as empty in the other —
 * and an empty registry answers "no error" for every custom value.
 */
const REGISTRY_KEY = Symbol.for('@aglyn/aglyn:custom-field-types')

const globalScope = globalThis as typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, CustomFieldType>
}

const customFieldTypes: Map<string, CustomFieldType> =
  (globalScope[REGISTRY_KEY] ??= new Map<string, CustomFieldType>())

/** Idempotent by name — re-registration replaces the type. */
export function registerCustomFieldType(fieldType: CustomFieldType): void {
  customFieldTypes.set(fieldType.name, fieldType)
}

export function getCustomFieldType(
  name: string | undefined,
): CustomFieldType | undefined {
  return name ? customFieldTypes.get(name) : undefined
}

export function listCustomFieldTypes(): CustomFieldType[] {
  return [...customFieldTypes.values()]
}

/**
 * The custom-type validation hook (both sides): no-op for plain fields,
 * unknown custom types (plugin disabled/uninstalled — the base type still
 * guards storage), or empty optional values.
 */
export function validateCustomFieldValue(
  customType: string | undefined,
  value: unknown,
): string | null {
  const fieldType = getCustomFieldType(customType)
  if (!fieldType?.validate) return null
  if (value === undefined || value === null || value === '') return null
  return fieldType.validate(value)
}

/** The custom type names a model's fields ride, in field order. */
function customTypesOf(
  model:
    | {
        fields?: Record<string, { customType?: string } | undefined>
        order?: readonly string[]
      }
    | null
    | undefined,
): string[] {
  const names = new Set<string>()
  for (const fieldId of model?.order ?? []) {
    const customType = model?.fields?.[fieldId]?.customType
    if (customType) names.add(customType)
  }
  return [...names]
}

/**
 * Makes sure every custom type a model names is registered before a record
 * is validated against it (AGL-2773).
 *
 * `validateCustomFieldValue` answers "no error" for a type nobody registered.
 * That is right for a plugin that is genuinely absent and wrong for one whose
 * declarations did not run in this process, so a type the registry does not
 * know runs the app's boot step once more (see `plugin-declarations-repair`)
 * before the write validates. A model with no custom field, or whose types
 * are all registered, costs nothing.
 *
 * Never throws: a failed repair leaves the base type guarding storage, which
 * is what an absent plugin gets too, and the write it guards must not fail
 * over it.
 */
export async function ensureDeclaredCustomFieldTypes(
  model: Parameters<typeof customTypesOf>[0],
): Promise<void> {
  const missing = customTypesOf(model).filter(
    (name) => !customFieldTypes.has(name),
  )
  if (!missing.length) return
  try {
    await runPluginDeclarationsRepair()
  } catch (error) {
    console.error(
      `[custom-fields] plugin declarations failed before validating ${missing.join(', ')}`,
      error,
    )
  }
}
