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
 * Hands a person this site just met to whichever plugin keeps people
 * (AGL-3080).
 *
 * Every door that meets somebody — a form submission, a member signing up, an
 * order, a booking — used to import the CRM's writer, which made the record
 * system something a storefront could not take a payment without. The doors
 * now report what they saw through `capturePluginContact` and the plugin that
 * keeps people decides everything a record system decides.
 *
 * This wrapper is the two things a door in THIS app has to get right, in one
 * place so no door has to remember them:
 *
 * ## It makes sure somebody is listening, without slowing down the case where
 * somebody already is
 *
 * `capturePluginContact` answers `null` when no plugin keeps people, and the
 * CRM registers itself from the server declarations. `instrumentation.ts`
 * runs those once per instance and CATCHES the failure — so a boot that went
 * wrong leaves a process where every capture answers `null` and no contact is
 * ever written, with one line in a log nobody is reading.
 *
 * So the writer is looked up FIRST, synchronously, and handed the capture
 * with no await in between. That matters for more than speed: every caller
 * is fire-and-forget, and a door that awaited anything before reaching the
 * writer would hand the capture to a request that may already have returned.
 * Only when no writer answers does this run the registration and try once
 * more — repairing the broken-boot case rather than just reporting it.
 *
 * ## It tells the difference between the two silences
 *
 * `null` is "this workspace has no record system", which is a real and quiet
 * answer for a workspace with the CRM switched off. It is ALSO what a broken
 * registration looks like, and the two are indistinguishable from here. So it
 * is logged rather than ignored: a workspace that should be keeping contacts
 * and has silently stopped is the failure mode this seam can produce, and a
 * line naming the site is what turns an unreproducible support ticket into a
 * one-minute answer. A refusal is different again — the owner considered this
 * person and declined, for a reason it states — and is logged as itself.
 *
 * ⚠️ IT NEVER THROWS, and callers use it fire-and-forget. Every door has
 * already done the thing it is recording; losing the submission over the
 * contact would be the larger failure.
 */

import {
  pluginContactCaptureWriter,
  type PluginContactCaptureRequest,
  type PluginContactCaptured,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'

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
  try {
    const { registerPluginServerDeclarations } = await import(
      './plugins.declarations.server.generated'
    )
    await registerPluginServerDeclarations()
  } catch (error) {
    console.error(`[capture] plugin declarations failed before ${where}`, error)
  }
  const late = pluginContactCaptureWriter()
  if (!late) {
    console.warn(
      `[capture] no plugin keeps people, so the ${where} recorded nobody. ` +
        'Expected when the CRM is off for this workspace; a bug otherwise.',
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
  writer: { capture: (request: PluginContactCaptureRequest) => Promise<PluginContactCaptured> },
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
