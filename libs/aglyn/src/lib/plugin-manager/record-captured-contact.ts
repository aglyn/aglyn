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
 * How a door hands somebody it just met to whichever plugin keeps people
 * (AGL-3080).
 *
 * `capturePluginContact` is the contract; this is the three things every
 * door calling it has to get right, in one place so no door has to remember
 * them. It lives in core rather than in an app because the doors are not all
 * in one place: a form submission is a core route in the tenant app, a
 * newsletter signup and a membership registration are commerce's, a booking
 * request is bookings'. A plugin may not import an app, so a wrapper that
 * lived in one would be a wrapper the plugin doors had to copy — and a copy
 * is where the two halves of this behaviour would drift.
 *
 * ## It makes sure somebody is listening, without slowing down the case where
 * somebody already is
 *
 * `capturePluginContact` answers `null` when no plugin keeps people, and the
 * plugin that does registers itself from the server declarations each app
 * runs at boot. That boot step is wrapped in a `catch` — a declaration that
 * fails to load must not cost every route — so a boot that went wrong leaves
 * a process where every capture answers `null` and no contact is ever
 * written, with one line in a log nobody is reading.
 *
 * So the writer is looked up FIRST, synchronously, and handed the capture
 * with no await in between. That matters for more than speed: every caller
 * is fire-and-forget, and a door that awaited anything before reaching the
 * writer would hand the capture to a request that may already have returned.
 * Only when no writer answers does this run the app's boot step and try once
 * more — repairing the broken-boot case rather than just reporting it.
 *
 * The boot step itself is the app's, because the list of plugins to declare
 * is generated per app and core may not import a plugin. The app hands it
 * over at boot with {@link registerPluginDeclarationsRepair}. An app that has
 * not — or a process that never ran its instrumentation at all — loses the
 * repair and keeps every other behaviour here, which is the honest outcome:
 * a process that ran no boot step has bigger silences than this one.
 *
 * ## It tells the difference between the two silences
 *
 * `null` is "this workspace has no record system", which is a real and quiet
 * answer for a workspace with the record plugin switched off. It is ALSO what
 * a broken registration looks like, and the two are indistinguishable from
 * here. So it is logged rather than ignored: a workspace that should be
 * keeping contacts and has silently stopped is the failure mode this seam can
 * produce, and a line naming the site is what turns an unreproducible support
 * ticket into a one-minute answer. A refusal is different again — the owner
 * considered this person and declined, for a reason it states — and is logged
 * as itself.
 *
 * ⚠️ IT NEVER THROWS, and callers use it fire-and-forget. Every door has
 * already done the thing it is recording; losing the submission, the signup
 * or the booking over the contact would be the larger failure.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

import {
  pluginContactCaptureWriter,
  type PluginContactCaptureRequest,
  type PluginContactCaptureWriter,
  type PluginContactCaptured,
} from './plugin-contact-capture'

/** The app's boot-time declarations step, when it has offered one. */
let repair: (() => Promise<void>) | null = null

/**
 * The app offers its boot step, so a capture that finds nobody can run it.
 *
 * Called at boot from the app's own instrumentation, beside the declarations
 * themselves and BEFORE them — this is a plain assignment that cannot fail,
 * and the failure it exists to repair is the one immediately after it. The
 * app passes a function rather than core importing the generated manifest,
 * which core may not do: the manifest names every plugin.
 *
 * Idempotent and last-one-wins; an app registers exactly once per process.
 */
export function registerPluginDeclarationsRepair(run: () => Promise<void>): void {
  repair = run
}

/** Only for specs: forgets the registered boot step. */
export function resetPluginDeclarationsRepairForTests(): void {
  repair = null
}

export async function recordCapturedContact(
  request: PluginContactCaptureRequest,
): Promise<PluginContactCaptured | null> {
  const where = `${request.interaction.source} on ${request.hostId}`
  const found = pluginContactCaptureWriter()
  if (found) return await handedTo(found.writer, request, where)

  // Nobody answers. Either this workspace keeps no records, or the boot step
  // that registers the writer failed and every capture in this process has
  // been going nowhere. Run it and ask again — the registration memoizes its
  // own promise, so this is one attempt per process and not one per capture.
  if (repair) {
    try {
      await repair()
    } catch (error) {
      console.error(`[capture] plugin declarations failed before ${where}`, error)
    }
  }
  const late = pluginContactCaptureWriter()
  if (!late) {
    console.warn(
      `[capture] no plugin keeps people, so the ${where} recorded nobody. ` +
        'Expected when the record plugin is off for this workspace; a bug otherwise.',
    )
    return null
  }
  console.warn(
    `[capture] the ${where} found no writer until it registered one itself — ` +
      'the boot-time declarations did not run in this process.',
  )
  return await handedTo(late.writer, request, where)
}

/** One capture, with the two failures a door must not be made to handle. */
async function handedTo(
  writer: PluginContactCaptureWriter,
  request: PluginContactCaptureRequest,
  where: string,
): Promise<PluginContactCaptured | null> {
  try {
    const verdict = await writer.capture(request)
    if (verdict.ok === false) {
      console.warn(`[capture] ${where} was refused (${verdict.reason})`)
    }
    return verdict
  } catch (error) {
    // The contract says a writer RETURNS its refusals, so reaching here means
    // one broke its own contract. It still costs the door nothing.
    console.error(`[capture] ${where} threw`, error)
    return null
  }
}

export default recordCapturedContact
