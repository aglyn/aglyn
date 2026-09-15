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

import { createContext, useContext, type ComponentType } from 'react'

/**
 * The console shell's widget zone renderer, for a zone a PLUGIN hosts.
 *
 * A zone the shell draws is a `PluginWidgetSlot` on a console page, and the
 * slot is where the gates live: the plugins enabled for the workspace, the
 * entitlement a widget needs and the permission its reader must hold. A
 * plugin's own surface — a dialog, a hub card — cannot import that
 * component, because an app is not a dependency a plugin may take, and a
 * plugin that listed widgets itself would render them past every gate. So
 * the shell hands its renderer down through this context, and a plugin that
 * hosts a zone draws whatever the context gives it: the same component, the
 * same gates, the zone name and the props the zone documents.
 *
 * Outside the console shell — a spec, a tenant page, a surface mounted by
 * something else — the context holds `null`, and a hosted zone renders
 * nothing. That is the right reading: with no shell there is no workspace to
 * gate on.
 *
 * A client-only context like the others in `contexts.ts`: it calls
 * `createContext` at module scope, so it is reachable from the full
 * `@aglyn/aglyn` barrel and never from `@aglyn/aglyn/server` (AGL-405).
 */

/** Renders every permitted widget registered for `slot`, passing the rest as props. */
export type ConsoleWidgetSlotRenderer = ComponentType<{ slot: string } & Record<string, unknown>>

export const ConsoleWidgetSlotContext = createContext<ConsoleWidgetSlotRenderer | null>(null)
ConsoleWidgetSlotContext.displayName = 'ConsoleWidgetSlotContext'

/** The shell's zone renderer, or `null` outside the console shell. */
export function useConsoleWidgetSlot(): ConsoleWidgetSlotRenderer | null {
  return useContext(ConsoleWidgetSlotContext)
}
