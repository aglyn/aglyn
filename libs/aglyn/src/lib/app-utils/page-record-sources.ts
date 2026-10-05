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

import type { PageRecordScope } from './expand-repeatables'

/**
 * WHICH RECORD A PAGE IS DRAWN FOR, ON THE BESIGNER'S CANVAS (AGL-3475).
 *
 * A record template renders once per record on the published site: the
 * composition hands it the routed record (`PageRecordScope`) and its
 * `{{item.*}}` tokens fill in. The canvas has no routed record — it edits the
 * template — so without one it shows the raw tokens, and the author designs a
 * page of `{{item.name}}` placeholders.
 *
 * So a plugin that serves pages per record answers here, for the page in the
 * editor: whether it is a template of theirs, and if so a record to draw it
 * for, with the others an author may switch to. The canvas lays that record
 * over every element's render copy exactly as a repeat lays its first record
 * over its template (AGL-3111) — the nodes keep their tokens, and a save
 * writes the template.
 *
 * The editor's side only: a hook, mounted by the console beside the canvas,
 * because the designer reads no database. `repeat-sources.ts` is the same
 * shape for a repeat's rows.
 */

/** One record an author can preview the page with. */
export interface PageRecordChoice {
  /** The record's id. */
  id: string
  /** What the picker shows for it. */
  label: string
}

/** What a source answers for one page. */
export type PageRecordAnswer =
  /** Not a page this source serves records on. */
  | { status: 'none' }
  | { status: 'loading' }
  | (PageRecordScope & {
      status: 'ready'
      /** What the page is a template of: "Services". */
      label: string
      /** The record being drawn. */
      selectedId: string
      /** Every record the picker offers, the drawn one included. */
      choices: readonly PageRecordChoice[]
      /** Draws the page for another of the choices. */
      select: (id: string) => void
    })

/** What a source is asked. */
export interface PageRecordRequest {
  hostId: string
  screenId: string
}

export interface PageRecordSource {
  /** Stable id; one source per id. */
  id: string
  /**
   * A React hook, called once per source for the page in the editor, every
   * render. Answers `none` for a page it does not serve.
   */
  usePageRecord: (request: PageRecordRequest) => PageRecordAnswer
}

const sources = new Map<string, PageRecordSource>()
const listeners = new Set<() => void>()
/** Replaced only when the set changes: the snapshot a store compares. */
let snapshot: readonly PageRecordSource[] = []

const notify = () => {
  snapshot = [...sources.values()]
  for (const listener of [...listeners]) listener()
}

/**
 * Registers a source, replacing any under its id. Returns the unregister,
 * which removes it only while it is still the one registered. Call it from a
 * registration function the plugin loader calls by name, never from a
 * module's top level (AGL-3025).
 */
export function registerPageRecordSource(source: PageRecordSource): () => void {
  if (sources.get(source.id) !== source) {
    sources.set(source.id, source)
    notify()
  }
  return () => {
    if (sources.get(source.id) !== source) return
    sources.delete(source.id)
    notify()
  }
}

/** Every registered source, the SAME array until the set changes. */
export function listPageRecordSources(): readonly PageRecordSource[] {
  return snapshot
}

/** Called after the registered set changes. Returns the unsubscribe. */
export function subscribePageRecordSources(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
