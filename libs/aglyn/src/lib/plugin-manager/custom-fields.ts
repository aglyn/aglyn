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
 * Register at module scope in a file imported by the plugin's client
 * barrel and /server entry (the AGL-428 config-schema pattern).
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

const customFieldTypes = new Map<string, CustomFieldType>()

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
