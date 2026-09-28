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

import {
  CORE_OPERATOR_ALERTS,
  type OperatorAlertDefinition,
} from '../app-utils/operator-alerts'

/**
 * Operator alerts a PLUGIN contributes (AGL-3377), beside core's own
 * `CORE_OPERATOR_ALERTS`.
 *
 * A plugin declares its alert types here, from its server declarations, in
 * the same shape core uses, and raises them through `raiseOperatorAlert`.
 * Core lists no plugin's types, so a plugin that is not installed adds
 * nothing to Staff → Operator alerts and a new plugin needs no core change.
 *
 * A plugin's types must start with its own id and a dot, which is what keeps
 * two plugins, or a plugin and core, from claiming one settings row.
 * Registering the same type again replaces it in place, so a declarations
 * module evaluated twice registers once.
 */

const registrations = new Map<string, OperatorAlertDefinition>()

const CORE_TYPES = new Set(CORE_OPERATOR_ALERTS.map((entry) => entry.type))

/**
 * Registers a plugin's alert types. Throws on a type outside the plugin's
 * namespace or one core already owns: both are a programming error the
 * plugin's own tests should meet, not something to discover in production.
 */
export function registerOperatorAlerts(
  definitions: readonly OperatorAlertDefinition[],
  options: { pluginId: string },
): void {
  const pluginId = String(options?.pluginId ?? '').trim()
  if (!pluginId) throw new Error('operator alerts need a pluginId')
  for (const definition of definitions) {
    const type = String(definition?.type ?? '').trim()
    if (!type.startsWith(`${pluginId}.`) || type.length <= pluginId.length + 1) {
      throw new Error(
        `operator alert "${type}" must be named "${pluginId}.<name>" by the plugin that registers it`,
      )
    }
    if (CORE_TYPES.has(type)) {
      throw new Error(`operator alert "${type}" is core's`)
    }
    registrations.set(type, { ...definition, type, pluginId })
  }
}

/** Every alert type: core's, then each plugin's in type order. */
export function listOperatorAlerts(): OperatorAlertDefinition[] {
  const contributed = [...registrations.values()].sort((a, b) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
  )
  return [...CORE_OPERATOR_ALERTS, ...contributed]
}

/** One alert type, core's or a registered plugin's. */
export function getOperatorAlert(
  type: string,
): OperatorAlertDefinition | undefined {
  return (
    CORE_OPERATOR_ALERTS.find((entry) => entry.type === type) ??
    registrations.get(type)
  )
}

/**
 * The alert a staff notification of this type is, if any: the registry
 * entry that names it as its `notificationType`. How `notifyStaff` routes a
 * notification it was handed into the alert pipeline.
 */
export function operatorAlertForNotificationType(
  notificationType: string,
): OperatorAlertDefinition | undefined {
  return listOperatorAlerts().find(
    (entry) => entry.notificationType === notificationType && entry.type === notificationType,
  )
}

/** Test seam: forget every plugin's registration. */
export function resetOperatorAlertsForTests(): void {
  registrations.clear()
}
