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
 * What the record zones hand a widget (AGL-2917): `recordInsights` on a
 * business record's page, `recordEmail` in a one-to-one composer, and
 * `importMapping` in a spreadsheet import. Types only: the catalog re-exports
 * each zone's props from here, and a type-only re-export adds nothing to a
 * published page, so the types a zone's props are built from are imported
 * from this module rather than from the catalog.
 *
 * The plugin that owns the records hosts each zone through the renderer
 * `useConsoleWidgetSlot` hands down, as the product editor hosts
 * `seoFields`, so every gate a console page's slot applies applies there. A
 * widget in any of them proposes, and the host writes: the record's own task
 * form and stage route, the composer's Send, the import's Import.
 */

/** The record a record zone is about (AGL-2917). */
export interface ConsoleRecordRef {
  /** The kind of record, in the owning plugin's words: `contact`, `company`, `deal`, `lead`. */
  kind: string
  id: string
  /** The record's name as the page shows it, for a widget's own words. */
  name: string
}

/** A follow-up a widget proposes, which the page opens in its own task form (AGL-2917). */
export interface ConsoleProposedTask {
  title: string
  notes: string
  kind: 'call' | 'email' | 'meeting' | 'todo'
  priority: 'low' | 'normal' | 'high'
  /** Days from today the task is due; the form sets the time of day. */
  dueInDays: number
}

/** One stage a record can move to (AGL-2917). */
export interface ConsoleRecordStage {
  id: string
  name: string
}

/** What the `recordInsights` zone hands each widget (AGL-2917). */
export interface ConsoleRecordInsightsZoneProps {
  /** The site the page is under, or `null` at the organization level. */
  hostId: string | null
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  record: ConsoleRecordRef
  /**
   * Opens the page's own task form with the proposal filled in, linked to the
   * record; the form's Save is the write. Absent where the record takes no
   * task.
   */
  proposeTask?: (task: ConsoleProposedTask, key: string) => void
  /** The open stages the record can move to, in order; absent for a record without stages. */
  stages?: readonly ConsoleRecordStage[]
  /** The stage the record is in, beside `stages`. */
  stageId?: string
  /**
   * Asks the member to confirm the move, then moves the record through the
   * page's own stage route. Absent for a record without stages.
   */
  proposeStage?: (stageId: string, key: string) => void
}

/** A subject and a message a widget proposes for a composer (AGL-2917). */
export interface ConsoleRecordEmailDraft {
  subject: string
  /** Plain text; a blank line starts a paragraph, and merge fields are filled at send. */
  body: string
}

/** What the `recordEmail` zone hands each widget (AGL-2917). */
export interface ConsoleRecordEmailZoneProps {
  /** The site the composer is under, or `null` at the organization level. */
  hostId: string | null
  /** The org the composer names; `undefined` while it resolves. */
  orgId: string | undefined
  /** The record the message is written from: a contact, a deal (its contact) or a lead. */
  record: ConsoleRecordRef
  /** What the composer holds now. */
  subject: string
  body: string
  /**
   * Puts the draft in the composer, asking first when a message is already
   * written. The composer's Send is the only write.
   */
  proposeDraft: (draft: ConsoleRecordEmailDraft, key: string) => void
}

/**
 * What a column of a file holds, read in the browser from its cells
 * (AGL-2917): the one thing a widget is told about a column's values.
 */
export type ConsoleImportColumnShape =
  | 'empty'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'yes-no'
  | 'url'
  | 'text'

/** One column of a file being imported (AGL-2917). */
export interface ConsoleImportColumn {
  header: string
  shape: ConsoleImportColumnShape
}

/** What the `importMapping` zone hands each widget (AGL-2917). */
export interface ConsoleImportMappingZoneProps {
  /** The site the file is imported into, or `null` at the organization level. */
  hostId: string | null
  /** The org the drawer names; `undefined` while it resolves. */
  orgId: string | undefined
  /** What the file is imported as, in the owning plugin's words: `contacts`, `companies`, `deals`, `leads`. */
  collection: string
  /** The file's columns in order: each header and its shape, never a cell. */
  columns: readonly ConsoleImportColumn[]
  /** The matching the drawer holds now: column index to field key. */
  mapping: Readonly<Record<number, string>>
  /**
   * Replaces the drawer's matching. A field the drawer does not offer is
   * dropped, and one field takes one column.
   */
  proposeMapping: (mapping: Readonly<Record<number, string>>, key: string) => void
}
