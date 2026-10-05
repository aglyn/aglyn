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

/**
 * The plugins' shares of a PERSON erasure (AGL-2981, AGL-3080).
 *
 * The person erasure removes one person from one workspace — a person the
 * workspace kept, not an account. The platform closes every site's door to
 * the address (a suppression row per site), sweeps the delivery log filed
 * under it, and keeps the audit; everything else the workspace keeps about the
 * person is a plugin's, and each plugin that keeps some registers an eraser
 * here: the record system's people and what it files beside them, a shop's
 * orders, a calendar's bookings, an audience's members, a sequence's
 * enrollments.
 *
 * ## The plugin that keeps the people goes first, and last
 *
 * Other plugins key what they keep about a person on the record system's ids
 * — an enrollment names the contact it enrolled — so the erasure has to know
 * those ids before anybody erases, and the records themselves have to outlive
 * every other eraser. The plugin that keeps people registers a RECORDS eraser
 * (`registerPluginPersonRecordsEraser`, one per workspace) with two halves:
 *
 *  1. `locate` names the person's records, read before anything is erased; the
 *     ids are handed to every eraser as `contactIds`;
 *  2. every other eraser runs, in registration order;
 *  3. the records eraser's own `erase` runs LAST, while nothing else is left
 *     that needs the records to find what it keeps.
 *
 * Every eraser runs AFTER the erasure has closed the door — every site's
 * suppression row is already written, so nothing a plugin sends can reach the
 * person while it runs.
 *
 * The two halves of the rule that holds everywhere else in the erasure hold
 * here too. A record ABOUT the person goes. A record that the person asked
 * not to be contacted — keyed by `personKey`, the hash every suppression list
 * is keyed by, and holding no address — is KEPT, because the promise it
 * records has to outlive the person's data; an eraser strips from it anything
 * that could identify the person again.
 *
 * ## Isolated, unless REQUIRED
 *
 * Erasers are ISOLATED: a throw is logged against its plugin, recorded as
 * `null`, and does not stop the next one. The `null` is how the erasure's
 * audit record says that plugin's share may remain, which a report of zero
 * would hide.
 *
 * Isolation is right for a courtesy and wrong for a share the erasure
 * PROMISES the person — their contact record, their leads, their name on an
 * order. A plugin keeping such a share declares `"requiredPersonEraser": true`
 * in `plugins.config.json`, compiled into {@link PLUGIN_REQUIRED_PERSON_ERASERS}
 * so no registration can opt out of it, and:
 *
 * - the erasure REFUSES to start while a required eraser is not registered —
 *   a boot that failed to declare one must not produce an "erased" request
 *   with the person still on file;
 * - a records eraser whose `locate` throws stops the erasure before anything
 *   is erased: nobody can be handed the ids;
 * - a required eraser that throws still lets every other eraser run, and then
 *   fails the erasure, which the job retries.
 *
 * A DRY RUN is handed to every eraser, which must then write nothing: it
 * counts what it would do.
 *
 * Registered from a plugin's declarations — `serverDeclarations`, or
 * `consoleServerDeclarations` for a plugin whose server code runs only in the
 * console — so the eraser is in place in a process that never loaded the
 * plugin's API surface.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { PLUGIN_REQUIRED_PERSON_ERASERS } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

export { PLUGIN_REQUIRED_PERSON_ERASERS }

/** Who is being erased, and from which workspace: what is known before anyone erases. */
export interface PluginPersonErasureTarget {
  /** The workspace the person is erased from. */
  orgId: string
  /** The person's address, normalized. */
  email: string
  /**
   * `personKey(email)`: how every suppression list, and any list a plugin
   * keeps in the same way, names the person without their address.
   */
  key: string
  /** A plan, not an erasure: count, write nothing. */
  dryRun: boolean
  /** When the erasure runs, epoch ms: the one time every stamp it leaves carries. */
  atMs: number
}

/** What every eraser is handed. */
export interface PluginPersonErasureRequest extends PluginPersonErasureTarget {
  /**
   * The person's records, by the record system's ids, as its `locate`
   * answered before anything was erased — empty when no plugin keeps people.
   */
  contactIds: readonly string[]
}

/**
 * What an eraser reports for the erasure's audit record: counts and flags,
 * never the erased content. A `null` field is a figure the eraser could not
 * measure, which is not zero.
 */
export type PluginPersonErasureReport = Readonly<Record<string, number | boolean | null>>

export type PluginPersonEraser = (
  request: PluginPersonErasureRequest,
) => Promise<PluginPersonErasureReport>

/** The plugin that keeps the people: names the person's records first, erases them last. */
export interface PluginPersonRecordsEraser {
  /** The ids of the person's records in this workspace. Writes nothing. */
  locate(target: PluginPersonErasureTarget): Promise<readonly string[]>
  /** Its own share, run after every other eraser. */
  erase: PluginPersonEraser
}

interface Registration {
  pluginId: string
  eraser: PluginPersonEraser
}

interface PersonErasers {
  registrations: Registration[]
  records: { pluginId: string; eraser: PluginPersonRecordsEraser } | null
}

/**
 * One set of erasers per process, on `globalThis` (AGL-3464): the app registers its
 * plugins' erasers from `instrumentation.ts`, which Next compiles apart from
 * the route that runs the erasure, and a module-scoped list is filled in one
 * copy and read empty in the other — the AGL-3412 shape.
 * Here a required share registered in the other copy reads as missing, and
 * every erasure refuses.
 */
const ERASERS_KEY = Symbol.for('@aglyn/aglyn:plugin-person-erasers')

const globalScope = globalThis as typeof globalThis & {
  [ERASERS_KEY]?: PersonErasers
}

const erasers: PersonErasers =
  globalScope[ERASERS_KEY] ?? (globalScope[ERASERS_KEY] = { registrations: [], records: null })
const registrations = erasers.registrations

function ownerOf(options: { pluginId?: string } | undefined, what: string): string {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `a plugin ${what} was registered with no owner: pass { pluginId } ` +
        'when registering outside a plugin register fn',
    )
  }
  return pluginId
}

/**
 * Registers a plugin's person eraser. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`; an eraser with neither throws. One
 * eraser per plugin: registering again replaces the plugin's earlier eraser
 * in place, so a module evaluated twice does not erase twice.
 */
export function registerPluginPersonEraser(
  eraser: PluginPersonEraser,
  options?: { pluginId?: string },
): void {
  const pluginId = ownerOf(options, 'person eraser')
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, eraser }
  else registrations.push({ pluginId, eraser })
}

/**
 * Registers the records eraser of the plugin that keeps people. One per
 * process: the same plugin registering again replaces its own, and a second
 * plugin is refused naming both — a workspace keeps one set of people.
 */
export function registerPluginPersonRecordsEraser(
  eraser: PluginPersonRecordsEraser,
  options?: { pluginId?: string },
): void {
  const pluginId = ownerOf(options, 'person records eraser')
  if (erasers.records && erasers.records.pluginId !== pluginId) {
    throw new Error(
      `the person records eraser is "${erasers.records.pluginId}"'s; refused one from "${pluginId}"`,
    )
  }
  erasers.records = { pluginId, eraser }
}

/**
 * The required erasers not registered in this process, in `required` order —
 * empty when the erasure may run. The erasure asks before it writes anything.
 */
export function missingRequiredPersonErasers(
  required: readonly string[] = PLUGIN_REQUIRED_PERSON_ERASERS,
): string[] {
  const registered = new Set(registrations.map((entry) => entry.pluginId))
  if (erasers.records) registered.add(erasers.records.pluginId)
  return required.filter((pluginId) => !registered.has(pluginId))
}

/**
 * {@link missingRequiredPersonErasers}, after running the app's boot step
 * once when any is missing (AGL-3464): a boot whose declarations failed looks
 * the same from here as one that never declared the eraser, and only the
 * second is a reason to refuse. What the erasure asks before it writes
 * anything.
 */
export async function missingRequiredPersonErasersAfterRepair(
  required: readonly string[] = PLUGIN_REQUIRED_PERSON_ERASERS,
): Promise<string[]> {
  if (!missingRequiredPersonErasers(required).length) return []
  await runPluginDeclarationsRepair().catch((error: unknown) => {
    console.error('[plugins] the declarations repair failed before a person erasure', error)
  })
  return missingRequiredPersonErasers(required)
}

/** What one erasure's plugins did. */
export interface PluginPersonErasureOutcome {
  /** The records `locate` named, handed to every eraser. */
  contactIds: string[]
  /** Each plugin's report by plugin id, or `null` for an eraser that threw. */
  reports: Record<string, PluginPersonErasureReport | null>
}

/**
 * Runs the plugins' shares of one person erasure: the records eraser's
 * `locate`, every other eraser in registration order, then the records
 * eraser's `erase`. See the module note.
 *
 * Throws in three cases, each about a share the erasure promises (`required`,
 * the compiled {@link PLUGIN_REQUIRED_PERSON_ERASERS} unless a spec passes its
 * own): before running anything, when a required eraser is not registered
 * even after the app's boot step has run once more, or the records eraser
 * cannot `locate`; and after running every eraser, when a required one
 * threw. Otherwise never.
 */
export async function runPluginPersonErasure(
  target: PluginPersonErasureTarget,
  required: readonly string[] = PLUGIN_REQUIRED_PERSON_ERASERS,
): Promise<PluginPersonErasureOutcome> {
  const missing = await missingRequiredPersonErasersAfterRepair(required)
  if (missing.length) {
    throw new Error(
      `[plugins] erasing a person in org ${target.orgId} refused: ${missing.join(', ')} ` +
        'declared a required person eraser and none is registered in this process',
    )
  }
  const base: PluginPersonErasureTarget = {
    orgId: target.orgId,
    email: target.email,
    key: target.key,
    dryRun: target.dryRun,
    atMs: target.atMs,
  }
  const records = erasers.records
  const contactIds = records ? [...(await records.eraser.locate({ ...base }))] : []
  const reports: Record<string, PluginPersonErasureReport | null> = {}
  const failedRequired: string[] = []
  const run = async (pluginId: string, eraser: PluginPersonEraser) => {
    try {
      reports[pluginId] = await eraser({ ...base, contactIds: [...contactIds] })
    } catch (error) {
      reports[pluginId] = null
      // The org, never the address: this line outlives the erasure.
      console.error(`[plugins] ${pluginId} failed to erase a person in org ${target.orgId}`, error)
      if (required.includes(pluginId)) failedRequired.push(pluginId)
    }
  }
  const owner = records
  for (const { pluginId, eraser } of [...registrations]) {
    if (pluginId === owner?.pluginId) continue
    await run(pluginId, eraser)
  }
  if (owner) await run(owner.pluginId, owner.eraser.erase)
  if (failedRequired.length) {
    throw new Error(
      `[plugins] erasing a person in org ${target.orgId} incomplete: the required eraser of ` +
        `${failedRequired.join(', ')} failed`,
    )
  }
  return { contactIds, reports }
}

/** The plugins with a person eraser, in the order they run: the records eraser last. */
export function listPluginPersonErasers(): string[] {
  const owner = erasers.records?.pluginId
  return [
    ...registrations.map((entry) => entry.pluginId).filter((pluginId) => pluginId !== owner),
    ...(owner ? [owner] : []),
  ]
}

/** Test seam: forget every eraser. */
export function resetPluginPersonErasersForTests(): void {
  registrations.length = 0
  erasers.records = null
}

/**
 * Test seam: a no-op eraser for every REQUIRED plugin that has none, so a spec
 * about the erasure's own sweeps can run it without loading a plugin (core
 * and the data layer may not import one). A spec about a plugin's share
 * registers the real one through the app's manifest instead.
 */
export function standInRequiredPersonErasersForTests(): void {
  const registered = new Set(registrations.map((entry) => entry.pluginId))
  if (erasers.records) registered.add(erasers.records.pluginId)
  for (const pluginId of PLUGIN_REQUIRED_PERSON_ERASERS) {
    if (!registered.has(pluginId)) {
      registrations.push({ pluginId, eraser: async () => ({ standIn: true }) })
    }
  }
}
