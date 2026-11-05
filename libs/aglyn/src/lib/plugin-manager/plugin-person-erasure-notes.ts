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
 * WHAT A PLUGIN KEEPS THROUGH A PERSON ERASURE, said before it is filed
 * (AGL-4042).
 *
 * Its sibling `plugin-person-erasure` does the erasing, and each plugin decides
 * there what it deletes and what it keeps. The console's Erase a person card
 * lists the platform's own removed and kept records; a plugin that keeps a
 * record with the person still on it registers a NOTE SOURCE here, and the card
 * prints what it answers, so the person filing hears it first.
 *
 * The platform owns the question and the card. What a plugin keeps, and the
 * sentence the person reads, are the plugin's. A note is information, never a
 * gate: nothing it answers holds an erasure back.
 *
 * A source answers for the workspace, not for one person, because the card is
 * opened before an address is typed. It answers nothing when the workspace
 * holds nothing of the kind, and otherwise words the sentence so it is true of
 * someone with no such record.
 *
 * ## Not answered is said, not hidden
 *
 * A source that throws, or answers something that cannot be printed, is listed
 * in `unavailable` by plugin id, and the card says some details could not be
 * checked, so a missing note never reads as "nothing is kept". A process where
 * no source is registered at all runs the app's boot step once more first
 * (`plugin-declarations-repair`), as the erasures do.
 *
 * Logic only: the contract, the registry and the reader. The card is the
 * console's.
 */

import { runPluginDeclarationsRepair } from './plugin-declarations-repair'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/** What a source is asked about. */
export interface PersonErasureNotesRequest {
  /** The workspace the card is open on. */
  orgId: string
}

/** One thing a plugin says it keeps. */
export interface PersonErasureNote {
  /** Stable, and unique for the plugin. */
  id: string
  /** One plain sentence: what is kept, how, and for how long. */
  text: string
}

/** A note as the reader answers it, with the plugin that said it. */
export type PersonErasureNoteAnswer = PersonErasureNote & { pluginId: string }

export interface PersonErasureNoteSource {
  /** The notes for one workspace; none when it holds nothing the plugin keeps. May throw. */
  notes(request: PersonErasureNotesRequest): Promise<readonly PersonErasureNote[]>
}

/** Every plugin may answer; one source per plugin. */
export const PERSON_ERASURE_NOTE_SOURCES = definePluginServiceContract<PersonErasureNoteSource>(
  'core.person-erasure-notes',
  { multiple: true },
)

/**
 * Installs a plugin's note source. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`. Registering again replaces the
 * plugin's earlier source.
 */
export function registerPersonErasureNoteSource(
  source: PersonErasureNoteSource,
  options?: { pluginId?: string },
): void {
  if (typeof source?.notes !== 'function') {
    throw new Error('a person erasure note source needs a notes function')
  }
  registerPluginService(PERSON_ERASURE_NOTE_SOURCES, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Whether a note can be printed: an id and words. */
export function isPrintablePersonErasureNote(note: unknown): note is PersonErasureNote {
  const candidate = note as PersonErasureNote | null | undefined
  return Boolean(candidate) && typeof candidate === 'object' && isText(candidate?.id) && isText(candidate?.text)
}

/** What every source answered for one workspace. */
export interface PersonErasureNotesRead {
  notes: PersonErasureNoteAnswer[]
  /** Plugins whose answer could not be read: the card says details are missing. */
  unavailable: string[]
}

/**
 * Asks every source about one workspace. NEVER THROWS: a source that threw or
 * answered something unprintable is listed in `unavailable`, and the rest are
 * answered. With no source registered, runs the app's boot step once and asks
 * again.
 */
export async function readPersonErasureNotes(
  request: PersonErasureNotesRequest,
): Promise<PersonErasureNotesRead> {
  let registered = resolvePluginServices(PERSON_ERASURE_NOTE_SOURCES)
  if (!registered.length) {
    const repaired = await runPluginDeclarationsRepair().catch(() => false)
    if (repaired) registered = resolvePluginServices(PERSON_ERASURE_NOTE_SOURCES)
  }
  const answers = await Promise.all(
    registered.map(async ({ pluginId, impl }) => {
      try {
        const notes = await impl.notes(request)
        if (!Array.isArray(notes) || !notes.every(isPrintablePersonErasureNote)) {
          console.error(`[person-erasure-notes] "${pluginId}" answered a note that cannot be printed`)
          return { pluginId, notes: null }
        }
        return { pluginId, notes: notes.map((note) => ({ id: note.id, text: note.text, pluginId })) }
      } catch (error) {
        console.error(`[person-erasure-notes] "${pluginId}" could not answer`, error)
        return { pluginId, notes: null }
      }
    }),
  )
  return {
    notes: answers.flatMap((answer) => answer.notes ?? []),
    unavailable: answers.filter((answer) => answer.notes === null).map((answer) => answer.pluginId),
  }
}
