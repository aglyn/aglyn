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

/**
 * The Table element's 1-based "emphasize column" prop. Named here because a
 * shape edit made outside the element (the canvas) has to move it with its
 * column — see {@link emphasisAfterShapeEdit}.
 */
export const DATA_TABLE_EMPHASIS_PROP = 'emphasizeColumn'

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

/**
 * A cell that holds FORMATTED text: inline markup (bold, italic, underline,
 * a link, a line break), written by the canvas's in-place cell editor.
 *
 * A cell is otherwise plain text, and both kinds live in the same pipe grid:
 * nothing about the storage changes, and a table nobody formats is
 * byte-for-byte what it always was. The test is "starts a tag or spells a
 * character reference", which is what the editor writes for ANY cell whose
 * text could be misread as markup (it stores `a &lt; b` rather than `a < b`
 * when the text happens to spell a tag), so the reading is never a guess
 * about what an author meant.
 */
export function isDataTableCellMarkup(cell: unknown): boolean {
  return (
    typeof cell === 'string' &&
    /<[a-z/!]|&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(cell)
  )
}

const CELL_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * The words a cell shows, without its formatting — what a field that can
 * only hold plain text (the Attributes grid) displays for a formatted cell.
 */
export function dataTableCellText(cell: unknown): string {
  const text = typeof cell === 'string' ? cell : ''
  if (!isDataTableCellMarkup(text)) return text
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code =
          name[1] === 'x' || name[1] === 'X'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return CELL_ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** One change to a table's shape, as the canvas and the Attributes grid make it. */
export type DataTableShapeEdit =
  | { kind: 'insertRow'; at: number }
  | { kind: 'removeRow'; at: number }
  | { kind: 'insertColumn'; at: number }
  | { kind: 'removeColumn'; at: number }

/**
 * The stored value after one shape edit, with each column's ALIGNMENT moving
 * with its column.
 *
 * Inserting or removing a column by rows alone leaves the alignments where
 * they were by index, so every column after the edit takes its neighbour's
 * alignment: a centred "Us" column turns left-aligned the moment a column is
 * inserted before it. The alignment is spliced at the same index as the
 * cells, and a new column starts at the default.
 */
export function editDataTableShape(
  value: unknown,
  edit: DataTableShapeEdit,
): string {
  const rows = parseDataTableRows(value)
  const width = rows[0]?.length ?? 0
  const alignments = readDataTableAlignments(value, width)
  switch (edit.kind) {
    case 'insertRow':
      return serializeDataTable(withRowAdded(rows, edit.at), alignments)
    case 'removeRow':
      return serializeDataTable(withRowRemoved(rows, edit.at), alignments)
    case 'insertColumn': {
      const at = Math.max(0, Math.min(edit.at, width))
      const next = [...alignments]
      next.splice(at, 0, DATA_TABLE_ALIGNMENT_DEFAULT)
      return serializeDataTable(withColumnAdded(rows, at), next)
    }
    case 'removeColumn': {
      if (width <= 1) return serializeDataTable(rows, alignments)
      return serializeDataTable(
        withColumnRemoved(rows, edit.at),
        alignments.filter((_, index) => index !== edit.at),
      )
    }
  }
}

/**
 * The emphasised column after a shape edit, so the highlight stays on the
 * column it was put on (1-based, `0` for none — see
 * {@link normalizeEmphasisColumn}).
 *
 * Inserting a column before "Us" moves "Us" one to the right, and the
 * highlight goes with it. Removing the emphasised column removes the
 * highlight rather than handing it to whichever column slid into the gap.
 */
export function emphasisAfterShapeEdit(
  emphasis: unknown,
  columnCount: number,
  edit: DataTableShapeEdit,
): number {
  const current = normalizeEmphasisColumn(emphasis, columnCount)
  if (current === 0) return 0
  const index = current - 1
  if (edit.kind === 'insertColumn') {
    return edit.at <= index ? current + 1 : current
  }
  if (edit.kind === 'removeColumn') {
    if (columnCount <= 1) return current
    if (edit.at === index) return 0
    return edit.at < index ? current - 1 : current
  }
  return current
}

/**
 * What "Start a table" writes into an empty Table, wherever it is offered:
 * a header row and one blank row, with the two comparison columns centred.
 */
export const DATA_TABLE_STARTER = {
  rows: [
    ['Feature', 'Us', 'Them'],
    ['', '', ''],
  ],
  alignments: ['left', 'center', 'center'] as DataTableAlignment[],
}

/** {@link DATA_TABLE_STARTER} in its stored form. */
export function dataTableStarterValue(): string {
  return serializeDataTable(
    DATA_TABLE_STARTER.rows,
    DATA_TABLE_STARTER.alignments,
  )
}
