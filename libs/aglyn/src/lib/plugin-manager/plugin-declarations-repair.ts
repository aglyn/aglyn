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
 * The app's boot-time declarations step, offered to core so a reader that
 * finds a declaration missing can run it (AGL-3080).
 *
 * Every app registers the plugins' declarations from its instrumentation, and
 * wraps that in a `catch` so one bad declaration cannot cost every route. A
 * boot that went wrong therefore leaves a process where whatever the
 * declarations register is silently absent. Core cannot run the step itself:
 * the generated manifest names every plugin, which is the one import core may
 * not make. So the app hands the step over, and a core reader that finds
 * nobody registered runs it and asks again.
 *
 * A leaf with no imports, so a client-safe module (the custom field registry)
 * and a server one (contact capture) can both read it.
 *
 * Held on `globalThis` rather than in a module `let` (AGL-3412): the app
 * offers it from `instrumentation.ts`, which Next compiles into a different
 * module graph from the routes that read it, so a module-scoped slot is set
 * in one copy and read as empty in the other.
 */
const REPAIR_KEY = Symbol.for('@aglyn/aglyn:plugin-declarations-repair')

const globalScope = globalThis as typeof globalThis & {
  [REPAIR_KEY]?: (() => Promise<void>) | null
}

/**
 * The app offers its boot step, so a reader that finds nobody can run it.
 *
 * Called at boot from the app's own instrumentation, beside the declarations
 * themselves and BEFORE them — this is a plain assignment that cannot fail,
 * and the failure it exists to repair is the one immediately after it.
 *
 * Idempotent and last-one-wins; an app registers exactly once per process.
 */
export function registerPluginDeclarationsRepair(run: () => Promise<void>): void {
  globalScope[REPAIR_KEY] = run
}

/** Only for specs: forgets the registered boot step. */
export function resetPluginDeclarationsRepairForTests(): void {
  globalScope[REPAIR_KEY] = null
}

/**
 * Runs the app's boot step, when it offered one. Answers whether one ran.
 *
 * Throws what the step throws; each caller decides what a failed repair
 * costs it. The app's step memoizes its own promise, so this is one attempt
 * per process rather than one per call.
 */
export async function runPluginDeclarationsRepair(): Promise<boolean> {
  const repair = globalScope[REPAIR_KEY]
  if (!repair) return false
  await repair()
  return true
}
