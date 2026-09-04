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
 * The grid behind the Table element (AGL-2543).
 *
 * ONE parser, shared by the renderer and the attributes-panel editor. Two
 * implementations of "what does this string mean" is how a table comes to
 * look right in the canvas and wrong on the page, and the two are written by
 * different people months apart.
 *
 * The persisted prop is a single string, following the house pattern used by
 * `CSS_DIMENSION` and `CSS_GRADIENT`: the rich editor is an input affordance,
 * not a shape change, so nothing downstream has to learn a new type and a
 * value the editor cannot model is never clobbered.
 *
 * Pipe-delimited, one row per line — deliberately the markdown table body's
 * own syntax, so the comparison tables already authored in Markdown elements
 * paste straight in. A leading and trailing pipe are optional, which is what
 * a copied markdown table has.
 */

/** Column alignments the editor offers and the renderer honours. */
export const DATA_TABLE_ALIGNMENTS = ['left', 'center', 'right'] as const

export type DataTableAlignment = (typeof DATA_TABLE_ALIGNMENTS)[number]

export const DATA_TABLE_ALIGNMENT_DEFAULT: DataTableAlignment = 'left'

/**
 * A markdown alignment divider — `|---|:--:|---:|`.
 *
 * Dropped rather than rendered as a row of dashes. It carries no content, and
 * an author pasting a markdown table has no reason to expect it to survive as
 * data; its alignment intent is read out separately by
 * {@link alignmentsFromDivider}.
 */
const DIVIDER_CELL = /^:?-{2,}:?$/

function splitRow(line: string): string[] {
  // `\|` is a literal pipe, so a cell may contain one. Split on unescaped
  // pipes only, then unescape — doing it in the other order would turn an
  // escaped pipe into a column break.
  const cells = line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
  return cells
}

function isDividerRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell))
}

/**
 * The alignments a pasted markdown divider row encodes, or `null` when the
 * line is not one. `:--` is left, `:-:` centre, `--:` right.
 */
export function alignmentsFromDivider(
  line: string,
): DataTableAlignment[] | null {
  const cells = splitRow(String(line ?? ''))
  if (!isDividerRow(cells)) return null
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

/**
 * The grid a stored value describes.
 *
 * Rows are padded to the widest one so the renderer and the editor always see
 * a rectangle: a short row is an authoring accident, and a table that renders
 * with a missing cell is harder to fix than one with an empty one.
 */
export function parseDataTableRows(value: unknown): string[][] {
  const text = typeof value === 'string' ? value : ''
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(splitRow)
    .filter((cells) => !isDividerRow(cells))
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  return rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ''),
  ])
}

/**
 * The alignments a stored value carries, padded to the table's width.
 *
 * Alignment lives in the SAME string as the grid, as a markdown divider row,
 * rather than in a prop of its own. A field editor is handed one prop, so a
 * second prop could not be reached from the grid's own per-column controls —
 * and encoding it the way markdown already does means a pasted table keeps
 * the alignment it was authored with instead of silently flattening to left.
 */
export function readDataTableAlignments(
  value: unknown,
  columnCount: number,
): DataTableAlignment[] {
  const found = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => alignmentsFromDivider(line))
    .find((alignments) => alignments !== null)
  return Array.from({ length: Math.max(0, columnCount) }, (_, index) => {
    const candidate = found?.[index]
    return candidate ?? DATA_TABLE_ALIGNMENT_DEFAULT
  })
}

/** A row of a table the author pasted, and the alignments it carried. */
export interface PastedDataTable {
  rows: string[][]
  alignments: DataTableAlignment[]
}

/** A pipe that breaks a column, as opposed to a `\|` inside a cell. */
function hasUnescapedPipe(line: string): boolean {
  return /(?<!\\)\|/.test(line)
}

/**
 * The table a pasted string describes, or `null` when it is not one
 * (AGL-2568).
 *
 * Reading it is the migration path off the Markdown workaround: the tables
 * this element replaces are already authored as pipe syntax, and the
 * alternative to importing them is retyping thirty cells of dated competitor
 * pricing by hand, which is the content least safe to retype.
 *
 * `null` rather than a best effort is the important half. This runs on every
 * paste into every cell, and an author pasting `Pro | Business` as a cell
 * VALUE must get those characters, not a two-column table. So a paste is only
 * read as a table when it could not sensibly be anything else: more than one
 * line, every one of them carrying an unescaped pipe, and at least two
 * columns once parsed. A single line never qualifies, however many pipes it
 * has.
 */
export function readPastedDataTable(value: unknown): PastedDataTable | null {
  const text = typeof value === 'string' ? value : ''
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 2 || !lines.every(hasUnescapedPipe)) return null
  const rows = parseDataTableRows(text)
  const width = rows[0]?.length ?? 0
  if (rows.length === 0 || width < 2) return null
  return { rows, alignments: readDataTableAlignments(text, width) }
}

/** The markdown divider encoding one column's alignment. */
function dividerCell(alignment: DataTableAlignment): string {
  if (alignment === 'center') return ':---:'
  if (alignment === 'right') return '---:'
  return '---'
}

/**
 * The stored form of a grid plus its alignments.
 *
 * The divider is written after the first row, where markdown puts it, and
 * only when some column is not the default — an all-left table stays a plain
 * pipe grid rather than growing a row of dashes nobody asked for.
 */
export function serializeDataTable(
  rows: string[][],
  alignments?: readonly DataTableAlignment[],
): string {
  const body = (rows ?? []).map((row) =>
    (row ?? [])
      .map((cell) => String(cell ?? '').replace(/\|/g, '\\|'))
      .join(' | '),
  )
  const meaningful =
    alignments?.some(
      (alignment) => alignment && alignment !== DATA_TABLE_ALIGNMENT_DEFAULT,
    ) ?? false
  if (!meaningful || body.length === 0) return body.join('\n')
  const width = rows[0]?.length ?? 0
  const divider = Array.from({ length: width }, (_, index) =>
    dividerCell(alignments?.[index] ?? DATA_TABLE_ALIGNMENT_DEFAULT),
  ).join(' | ')
  return [body[0], divider, ...body.slice(1)].join('\n')
}

/**
 * The 1-based column to emphasise, or `0` for none.
 *
 * 1-based because the control says "column 3" to an author who is looking at
 * the third column; `0` rather than `null` so "none" survives a form field
 * that only speaks numbers. Out-of-range values mean none, so deleting a
 * column cannot leave a table pointing at one that is gone.
 */
export function normalizeEmphasisColumn(
  value: unknown,
  columnCount: number,
): number {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > columnCount) return 0
  return parsed
}

/** A grid with `count` empty columns appended to every row. */
export function withColumnAdded(rows: string[][], at?: number): string[][] {
  const width = rows[0]?.length ?? 0
  const index = at == null ? width : Math.max(0, Math.min(at, width))
  return (rows.length ? rows : [[]]).map((row) => {
    const next = [...row]
    next.splice(index, 0, '')
    return next
  })
}

export function withColumnRemoved(rows: string[][], at: number): string[][] {
  const width = rows[0]?.length ?? 0
  // Never leave a table with no columns: a zero-column grid cannot be typed
  // back into through the editor, so the last column is not removable.
  if (width <= 1) return rows
  return rows.map((row) => row.filter((_, index) => index !== at))
}

export function withRowAdded(rows: string[][], at?: number): string[][] {
  const width = rows[0]?.length ?? 1
  const blank = Array.from({ length: width }, () => '')
  const next = [...rows]
  next.splice(at == null ? rows.length : Math.max(0, Math.min(at, rows.length)), 0, blank)
  return next
}

export function withRowRemoved(rows: string[][], at: number): string[][] {
  if (rows.length <= 1) return rows
  return rows.filter((_, index) => index !== at)
}

export function withCellSet(
  rows: string[][],
  rowIndex: number,
  columnIndex: number,
  value: string,
): string[][] {
  return rows.map((row, r) =>
    r === rowIndex
      ? row.map((cell, c) => (c === columnIndex ? value : cell))
      : row,
  )
}
