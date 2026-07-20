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
'use client'

/**
 * WYSIWYG editor for markdown-lite blog bodies (AGL-582).
 *
 * Model-first, dependency-free: the parsed markdown-lite blocks are the
 * source of truth (`rowsRef`), rendered as ONE contentEditable element per
 * text row (paragraph / heading / list item) plus non-editable image rows.
 * Plain typing stays native — each `input` event reads the row's DOM back
 * into the model WITHOUT re-rendering, so the caret and IME composition are
 * never disturbed. Structural edits (Enter, Backspace-at-start, toolbar
 * marks, links, images, paste, undo) mutate the model, bump `version` to
 * re-render every row from the model, and restore the selection from model
 * offsets. Every change serializes through `serializeMarkdownLite`, so the
 * document round-trips losslessly to the exact markdown-lite string stored
 * in Firestore — no HTML is ever persisted.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type MarkdownEditorCommand =
  | 'bold'
  | 'italic'
  | 'heading'
  | 'link'
  | 'image'

export interface MarkdownVisualEditorHandle {
  /** Applies a toolbar command at the current (or last known) selection. */
  exec: (command: MarkdownEditorCommand) => void
  /** Inserts an image block after the caret row (console media picker). */
  insertImage: (alt: string, url: string) => void
}

export interface MarkdownVisualEditorProps {
  /** Markdown-lite source. Re-parsed whenever it changes externally. */
  value: string
  /** Fires with the serialized markdown-lite string on every edit. */
  onChange: (markdown: string) => void
  minHeight?: number | string
  maxHeight?: number | string
}

type TextRowKind = 'paragraph' | 'heading2' | 'heading3' | 'listItem'

type TextRow = {
  key: string
  kind: TextRowKind
  inlines: Aglyn.MarkdownInline[]
}
type ImageRow = { key: string; kind: 'image'; src: string; alt: string }
export type EditorRow = TextRow | ImageRow

let rowKeySeq = 0
const nextRowKey = () => `md-row-${++rowKeySeq}`

const emptyParagraph = (): TextRow => ({
  key: nextRowKey(),
  kind: 'paragraph',
  inlines: [],
})

/** Flattens parsed blocks to editable rows (lists become item rows). */
export function markdownToRows(markdown: string): EditorRow[] {
  const rows: EditorRow[] = []
  for (const block of Aglyn.parseMarkdownLite(markdown)) {
    if (block.type === 'heading') {
      rows.push({
        key: nextRowKey(),
        kind: block.level === 2 ? 'heading2' : 'heading3',
        inlines: block.inlines,
      })
    } else if (block.type === 'paragraph') {
      rows.push({ key: nextRowKey(), kind: 'paragraph', inlines: block.inlines })
    } else if (block.type === 'image') {
      rows.push({ key: nextRowKey(), kind: 'image', src: block.src, alt: block.alt })
    } else {
      for (const item of block.items) {
        rows.push({ key: nextRowKey(), kind: 'listItem', inlines: item })
      }
    }
  }
  if (rows.length === 0) rows.push(emptyParagraph())
  return rows
}

/** Regroups rows to blocks (adjacent list items rejoin) and serializes. */
export function rowsToMarkdown(rows: EditorRow[]): string {
  const blocks: Aglyn.MarkdownBlock[] = []
  for (const row of rows) {
    if (row.kind === 'image') {
      blocks.push({ type: 'image', src: row.src, alt: row.alt })
    } else if (row.kind === 'listItem') {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'list') last.items.push(row.inlines)
      else blocks.push({ type: 'list', items: [row.inlines] })
    } else if (row.kind === 'paragraph') {
      blocks.push({ type: 'paragraph', inlines: row.inlines })
    } else {
      blocks.push({
        type: 'heading',
        level: row.kind === 'heading2' ? 2 : 3,
        inlines: row.inlines,
      })
    }
  }
  return Aglyn.serializeMarkdownLite(blocks)
}

const rowPlainText = (inlines: Aglyn.MarkdownInline[]): string =>
  inlines.map((inline) => inline.text).join('')

/** Merges adjacent same-type runs (same href for links), drops empties. */
function normalizeInlines(
  inlines: Aglyn.MarkdownInline[],
): Aglyn.MarkdownInline[] {
  const out: Aglyn.MarkdownInline[] = []
  for (const inline of inlines) {
    if (!inline.text) continue
    const last = out[out.length - 1]
    if (
      last &&
      last.type === inline.type &&
      (last.type !== 'link' ||
        last.href === (inline as { href?: string }).href)
    ) {
      last.text += inline.text
    } else {
      out.push({ ...inline })
    }
  }
  return out
}

/** Extracts [from, to) in plain-text offsets, keeping marks on the cuts. */
function sliceInlines(
  inlines: Aglyn.MarkdownInline[],
  from: number,
  to: number,
): Aglyn.MarkdownInline[] {
  const out: Aglyn.MarkdownInline[] = []
  let position = 0
  for (const inline of inlines) {
    const end = position + inline.text.length
    const start = Math.max(from, position)
    const stop = Math.min(to, end)
    if (stop > start) {
      out.push({ ...inline, text: inline.text.slice(start - position, stop - position) })
    }
    position = end
  }
  return normalizeInlines(out)
}

function replaceInlineRange(
  inlines: Aglyn.MarkdownInline[],
  from: number,
  to: number,
  replacement: Aglyn.MarkdownInline[],
): Aglyn.MarkdownInline[] {
  return normalizeInlines([
    ...sliceInlines(inlines, 0, from),
    ...replacement,
    ...sliceInlines(inlines, to, Infinity),
  ])
}

/**
 * Toggles bold/italic over [from, to). The dialect cannot nest marks, so
 * applying one flattens the covered range to plain text carrying the mark;
 * a range that is already entirely the mark unwraps back to text.
 */
function toggleInlineMark(
  inlines: Aglyn.MarkdownInline[],
  from: number,
  to: number,
  mark: 'bold' | 'italic',
): { inlines: Aglyn.MarkdownInline[]; length: number } {
  const middle = sliceInlines(inlines, from, to)
  const text = rowPlainText(middle)
  if (!text) return { inlines, length: 0 }
  const unwrap = middle.every((inline) => inline.type === mark)
  return {
    inlines: replaceInlineRange(inlines, from, to, [
      { type: unwrap ? 'text' : mark, text },
    ]),
    length: text.length,
  }
}

/**
 * Reads a row's live DOM back into canonical inlines. Only elements this
 * editor renders exist in a row (plus text nodes the browser adds while
 * typing); unknown wrappers are recursed through as plain text.
 */
export function readInlinesFromElement(
  rowEl: HTMLElement,
): Aglyn.MarkdownInline[] {
  const inlines: Aglyn.MarkdownInline[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) inlines.push({ type: 'text', text })
      return
    }
    if (!(node instanceof HTMLElement) || node.tagName === 'BR') return
    const text = node.textContent ?? ''
    if (!text) return
    if (node.tagName === 'STRONG' || node.tagName === 'B') {
      inlines.push({ type: 'bold', text })
    } else if (node.tagName === 'EM' || node.tagName === 'I') {
      inlines.push({ type: 'italic', text })
    } else if (node.dataset['mdLink'] != null) {
      inlines.push({ type: 'link', text, href: node.dataset['mdHref'] ?? '' })
    } else {
      node.childNodes.forEach(visit)
    }
  }
  rowEl.childNodes.forEach(visit)
  return normalizeInlines(inlines)
}

/** Plain-text offset of a DOM position inside a row element. */
function textOffsetOf(rowEl: HTMLElement, node: Node, offset: number): number {
  const range = rowEl.ownerDocument.createRange()
  range.selectNodeContents(rowEl)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

function selectionOffsetsWithin(
  rowEl: HTMLElement,
): { start: number; end: number } | null {
  const selection = rowEl.ownerDocument.defaultView?.getSelection?.()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (
    !rowEl.contains(range.startContainer) ||
    !rowEl.contains(range.endContainer)
  ) {
    return null
  }
  const start = textOffsetOf(rowEl, range.startContainer, range.startOffset)
  const end = textOffsetOf(rowEl, range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}

function resolveTextPosition(
  rowEl: HTMLElement,
  target: number,
): { node: Node; offset: number } {
  const walker = rowEl.ownerDocument.createTreeWalker(
    rowEl,
    NodeFilter.SHOW_TEXT,
  )
  let remaining = target
  let node = walker.nextNode()
  let lastText: Text | null = null
  while (node) {
    const text = node as Text
    if (remaining <= text.length) return { node: text, offset: remaining }
    remaining -= text.length
    lastText = text
    node = walker.nextNode()
  }
  if (lastText) return { node: lastText, offset: lastText.length }
  return { node: rowEl, offset: 0 }
}

function setSelectionIn(rowEl: HTMLElement, start: number, end: number): void {
  const selection = rowEl.ownerDocument.defaultView?.getSelection?.()
  if (!selection) return
  const from = resolveTextPosition(rowEl, start)
  const to = end === start ? from : resolveTextPosition(rowEl, end)
  const range = rowEl.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

function renderRowInlines(inlines: Aglyn.MarkdownInline[]): ReactNode {
  // An empty row keeps a <br> so the caret has a line box to land in.
  if (inlines.length === 0) return <br />
  return inlines.map((inline, index) =>
    inline.type === 'bold' ? (
      <strong key={index}>{inline.text}</strong>
    ) : inline.type === 'italic' ? (
      <em key={index}>{inline.text}</em>
    ) : inline.type === 'link' ? (
      <span key={index} data-md-link="" data-md-href={inline.href}>
        {inline.text}
      </span>
    ) : (
      <span key={index}>{inline.text}</span>
    ),
  )
}

interface TextRowViewProps {
  row: TextRow
  version: number
  onInput: (event: React.FormEvent<HTMLDivElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onSelectionPing: () => void
}

/**
 * One editable row. The rendered children are FROZEN per `version`: while
 * the user types, React re-renders (parent state changes on every emitted
 * keystroke) but receives the identical element references, so it bails
 * out and never touches the browser-managed DOM. A version bump swaps the
 * `key`, remounting the row cleanly from the model.
 */
const TextRowView = memo(function TextRowView(props: TextRowViewProps) {
  const { row, version, onInput, onKeyDown, onPaste, onClick, onSelectionPing } =
    props
  // The DOM is the source of truth between versions — deliberately NOT
  // keyed on row.inlines, which trail the DOM during silent typing syncs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const children = useMemo(() => renderRowInlines(row.inlines), [version])
  return (
    <Box
      key={`${row.key}:${version}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-row-key={row.key}
      data-row-kind={row.kind}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onClick={onClick}
      onKeyUp={onSelectionPing}
      onMouseUp={onSelectionPing}
      onFocus={onSelectionPing}
    >
      {children}
    </Box>
  )
})

interface ImageRowViewProps {
  row: ImageRow
  onRemove: () => void
}

const ImageRowView = memo(function ImageRowView({
  row,
  onRemove,
}: ImageRowViewProps) {
  return (
    <Box
      contentEditable={false}
      data-row-key={row.key}
      data-row-kind="image"
      sx={{ my: 1, position: 'relative', '&:hover [data-md-image-remove]': { opacity: 1 } }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={row.src} alt={row.alt} />
      <Button
        size="small"
        color="error"
        variant="contained"
        data-md-image-remove=""
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
        sx={{ position: 'absolute', top: 8, left: 8, opacity: 0, transition: 'opacity 120ms' }}
      >
        {'Remove'}
      </Button>
    </Box>
  )
})

type SelectionSnapshot = { key: string; start: number; end: number }
type HistoryEntry = { rows: EditorRow[]; selection: SelectionSnapshot | null }

const cloneRows = (rows: EditorRow[]): EditorRow[] =>
  rows.map((row) =>
    row.kind === 'image'
      ? { ...row }
      : { ...row, inlines: row.inlines.map((inline) => ({ ...inline })) },
  )

const HISTORY_LIMIT = 100

/** True when only https?:// or a site-relative (not protocol-relative) path. */
const isValidLinkUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)
const isValidImageUrl = (url: string): boolean => /^https?:\/\//i.test(url)

interface UrlDialogState {
  kind: 'link' | 'image'
  url: string
  text: string
  /** Set when editing an existing link's URL from the popover. */
  editRowKey?: string
  editLinkIndex?: number
}

interface LinkPopoverState {
  anchor: HTMLElement
  rowKey: string
  linkIndex: number
  href: string
}

const MarkdownVisualEditor = forwardRef<
  MarkdownVisualEditorHandle,
  MarkdownVisualEditorProps
>(function MarkdownVisualEditor(
  { value, onChange, minHeight = 280, maxHeight = 480 },
  ref,
) {
  const [version, setVersion] = useState(0)
  const rowsRef = useRef<EditorRow[] | null>(null)
  if (rowsRef.current == null) rowsRef.current = markdownToRows(value)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lastEmittedRef = useRef<string>(value)
  const pendingSelectionRef = useRef<SelectionSnapshot | null>(null)
  const lastSelectionRef = useRef<SelectionSnapshot | null>(null)
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({
    past: [],
    future: [],
  })
  const typingBatchRef = useRef(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialogTargetRef = useRef<{
    index: number
    start: number
    end: number
  } | null>(null)
  const [urlDialog, setUrlDialog] = useState<UrlDialogState | null>(null)
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)
  const [placeholderVisible, setPlaceholderVisible] = useState(
    () => rowsToMarkdown(rowsRef.current ?? []).length === 0,
  )

  const rows = rowsRef.current ?? []

  const emitChange = useCallback(() => {
    const markdown = rowsToMarkdown(rowsRef.current ?? [])
    lastEmittedRef.current = markdown
    setPlaceholderVisible(markdown.length === 0)
    onChange(markdown)
  }, [onChange])

  // External updates (tab remount, AI assist rewriting the body): re-parse
  // unless the incoming value is the one this editor just emitted.
  useEffect(() => {
    if (value === lastEmittedRef.current) return
    rowsRef.current = markdownToRows(value)
    lastEmittedRef.current = value
    historyRef.current = { past: [], future: [] }
    pendingSelectionRef.current = null
    lastSelectionRef.current = null
    typingBatchRef.current = false
    setPlaceholderVisible(rowsToMarkdown(rowsRef.current).length === 0)
    setVersion((current) => current + 1)
  }, [value])

  const pushHistory = useCallback(() => {
    const { past } = historyRef.current
    past.push({
      rows: cloneRows(rowsRef.current ?? []),
      selection: lastSelectionRef.current,
    })
    if (past.length > HISTORY_LIMIT) past.shift()
    historyRef.current.future = []
  }, [])

  /** Re-renders every row from the model and restores the selection. */
  const commit = useCallback(
    (selection: SelectionSnapshot | null) => {
      pendingSelectionRef.current = selection
      if (selection) lastSelectionRef.current = selection
      typingBatchRef.current = false
      setVersion((current) => current + 1)
      emitChange()
    },
    [emitChange],
  )

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current
    if (!pending) return
    pendingSelectionRef.current = null
    const rowEl = rootRef.current?.querySelector<HTMLElement>(
      `[data-row-key="${pending.key}"]`,
    )
    if (!rowEl || rowEl.dataset['rowKind'] === 'image') return
    rowEl.focus()
    setSelectionIn(rowEl, pending.start, pending.end)
  }, [version])

  const findRowIndex = useCallback(
    (key: string): number =>
      (rowsRef.current ?? []).findIndex((row) => row.key === key),
    [],
  )

  /** Records the current DOM selection in model coordinates. */
  const captureSelection = useCallback((): SelectionSnapshot | null => {
    const root = rootRef.current
    const selection =
      root?.ownerDocument.defaultView?.getSelection?.() ?? null
    if (!root || !selection || selection.rangeCount === 0) {
      return lastSelectionRef.current
    }
    const range = selection.getRangeAt(0)
    const rowOf = (node: Node): HTMLElement | null => {
      const el =
        node instanceof HTMLElement ? node : node.parentElement ?? null
      const rowEl = el?.closest<HTMLElement>('[data-row-key]') ?? null
      return rowEl && root.contains(rowEl) ? rowEl : null
    }
    const startRow = rowOf(range.startContainer)
    const endRow = rowOf(range.endContainer)
    // Cross-row selections are out of scope for phase 1 — keep last known.
    if (!startRow || startRow !== endRow) return lastSelectionRef.current
    const key = startRow.dataset['rowKey']
    if (!key) return lastSelectionRef.current
    const offsets = selectionOffsetsWithin(startRow)
    if (!offsets) return lastSelectionRef.current
    const snapshot = { key, ...offsets }
    lastSelectionRef.current = snapshot
    return snapshot
  }, [])

  const handleSelectionPing = useCallback(() => {
    captureSelection()
  }, [captureSelection])

  const undo = useCallback(() => {
    const { past, future } = historyRef.current
    const entry = past.pop()
    if (!entry) return
    future.push({
      rows: cloneRows(rowsRef.current ?? []),
      selection: lastSelectionRef.current,
    })
    rowsRef.current = cloneRows(entry.rows)
    typingBatchRef.current = false
    pendingSelectionRef.current = entry.selection
    setVersion((current) => current + 1)
    emitChange()
  }, [emitChange])

  const redo = useCallback(() => {
    const { past, future } = historyRef.current
    const entry = future.pop()
    if (!entry) return
    past.push({
      rows: cloneRows(rowsRef.current ?? []),
      selection: lastSelectionRef.current,
    })
    rowsRef.current = cloneRows(entry.rows)
    typingBatchRef.current = false
    pendingSelectionRef.current = entry.selection
    setVersion((current) => current + 1)
    emitChange()
  }, [emitChange])

  /** Resolves where a toolbar command applies: selection or document end. */
  const resolveTarget = useCallback((): {
    index: number
    start: number
    end: number
  } | null => {
    const current = rowsRef.current ?? []
    const selection = captureSelection()
    if (selection) {
      const index = current.findIndex((row) => row.key === selection.key)
      const row = current[index]
      if (index >= 0 && row && row.kind !== 'image') {
        return { index, start: selection.start, end: selection.end }
      }
    }
    for (let index = current.length - 1; index >= 0; index--) {
      const row = current[index]
      if (row && row.kind !== 'image') {
        const length = rowPlainText(row.inlines).length
        return { index, start: length, end: length }
      }
    }
    return null
  }, [captureSelection])

  const insertImageRow = useCallback(
    (alt: string, url: string, afterIndex: number | null) => {
      if (!isValidImageUrl(url)) return
      const current = rowsRef.current ?? []
      pushHistory()
      const index = afterIndex == null ? current.length : afterIndex + 1
      current.splice(index, 0, {
        key: nextRowKey(),
        kind: 'image',
        src: url,
        alt,
      })
      // Keep a caret landing spot after a trailing image.
      if (index === current.length - 1) current.push(emptyParagraph())
      const next = current[index + 1]
      commit(next && next.kind !== 'image' ? { key: next.key, start: 0, end: 0 } : null)
    },
    [commit, pushHistory],
  )

  const execCommand = useCallback(
    (command: MarkdownEditorCommand) => {
      const current = rowsRef.current ?? []
      const target = resolveTarget()
      if (command === 'image') {
        // TODO(AGL-582): media-picker integration for the toolbar image
        // button is a later phase — for now a URL prompt dialog.
        dialogTargetRef.current = target
        setUrlDialog({ kind: 'image', url: '', text: '' })
        return
      }
      if (!target) return
      const row = current[target.index] as TextRow
      if (command === 'heading') {
        pushHistory()
        current[target.index] = {
          ...row,
          kind: row.kind === 'heading2' ? 'paragraph' : 'heading2',
        }
        commit({ key: row.key, start: target.start, end: target.end })
        return
      }
      if (command === 'link') {
        dialogTargetRef.current = target
        setUrlDialog({
          kind: 'link',
          url: '',
          text: rowPlainText(
            sliceInlines(row.inlines, target.start, target.end),
          ),
        })
        return
      }
      pushHistory()
      if (target.start === target.end) {
        const placeholder = command === 'bold' ? 'bold text' : 'italic text'
        current[target.index] = {
          ...row,
          inlines: replaceInlineRange(row.inlines, target.start, target.end, [
            { type: command, text: placeholder },
          ]),
        }
        commit({
          key: row.key,
          start: target.start,
          end: target.start + placeholder.length,
        })
        return
      }
      const toggled = toggleInlineMark(
        row.inlines,
        target.start,
        target.end,
        command,
      )
      current[target.index] = { ...row, inlines: toggled.inlines }
      commit({
        key: row.key,
        start: target.start,
        end: target.start + toggled.length,
      })
    },
    [commit, pushHistory, resolveTarget],
  )

  useImperativeHandle(
    ref,
    () => ({
      exec: execCommand,
      insertImage: (alt: string, url: string) => {
        const selection = lastSelectionRef.current
        const index = selection ? findRowIndex(selection.key) : -1
        insertImageRow(alt, url, index >= 0 ? index : null)
      },
    }),
    [execCommand, findRowIndex, insertImageRow],
  )

  const handleRowInput = useCallback(
    (key: string) => (event: React.FormEvent<HTMLDivElement>) => {
      const current = rowsRef.current ?? []
      const index = findRowIndex(key)
      const row = current[index]
      if (!row || row.kind === 'image') return
      const rowEl = event.currentTarget
      // Snapshot the pre-typing model once per typing burst so undo jumps
      // back over the whole burst, not one character at a time.
      if (!typingBatchRef.current) {
        pushHistory()
        typingBatchRef.current = true
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        typingBatchRef.current = false
      }, 800)
      const inlines = readInlinesFromElement(rowEl)
      const text = rowPlainText(inlines)
      // Markdown shortcuts (AGL-582): "## " / "### " / "- " at the start
      // of a paragraph convert it to a heading or list item.
      if (row.kind === 'paragraph') {
        const shortcut = text.startsWith('### ')
          ? { kind: 'heading3' as const, trim: 4 }
          : text.startsWith('## ')
            ? { kind: 'heading2' as const, trim: 3 }
            : text.startsWith('- ')
              ? { kind: 'listItem' as const, trim: 2 }
              : null
        if (shortcut) {
          const caret =
            selectionOffsetsWithin(rowEl)?.start ?? text.length
          const offset = Math.max(0, caret - shortcut.trim)
          current[index] = {
            key: row.key,
            kind: shortcut.kind,
            inlines: sliceInlines(inlines, shortcut.trim, Infinity),
          }
          commit({ key: row.key, start: offset, end: offset })
          return
        }
      }
      // Plain typing: sync the model silently — no re-render, the DOM is
      // already correct and the caret must not move.
      current[index] = { ...row, inlines }
      emitChange()
    },
    [commit, emitChange, findRowIndex, pushHistory],
  )

  const focusAdjacentRow = useCallback(
    (fromIndex: number, direction: 1 | -1, preferredOffset: number) => {
      const current = rowsRef.current ?? []
      for (
        let index = fromIndex + direction;
        index >= 0 && index < current.length;
        index += direction
      ) {
        const row = current[index]
        if (!row || row.kind === 'image') continue
        const rowEl = rootRef.current?.querySelector<HTMLElement>(
          `[data-row-key="${row.key}"]`,
        )
        if (!rowEl) return
        const length = rowPlainText(row.inlines).length
        const offset = Math.min(Math.max(preferredOffset, 0), length)
        rowEl.focus()
        setSelectionIn(rowEl, offset, offset)
        captureSelection()
        return
      }
    },
    [captureSelection],
  )

  const handleRowKeyDown = useCallback(
    (key: string) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing) return
      const current = rowsRef.current ?? []
      const index = findRowIndex(key)
      const row = current[index]
      if (!row || row.kind === 'image') return
      const rowEl = event.currentTarget

      if (event.key === 'Enter') {
        event.preventDefault()
        const inlines = readInlinesFromElement(rowEl)
        const length = rowPlainText(inlines).length
        const offsets = selectionOffsetsWithin(rowEl) ?? {
          start: length,
          end: length,
        }
        current[index] = { ...row, inlines } as EditorRow
        pushHistory()
        // Enter on an empty list item exits the list into a paragraph.
        if (row.kind === 'listItem' && length === 0) {
          current[index] = { key: row.key, kind: 'paragraph', inlines: [] }
          commit({ key: row.key, start: 0, end: 0 })
          return
        }
        const before = sliceInlines(inlines, 0, offsets.start)
        const after = sliceInlines(inlines, offsets.end, Infinity)
        // Splitting a heading leaves prose behind; lists continue as items.
        const nextKind: TextRowKind =
          row.kind === 'listItem' ? 'listItem' : 'paragraph'
        const newRow: TextRow = {
          key: nextRowKey(),
          kind: nextKind,
          inlines: after,
        }
        current[index] = { ...row, inlines: before } as EditorRow
        current.splice(index + 1, 0, newRow)
        commit({ key: newRow.key, start: 0, end: 0 })
        return
      }

      if (event.key === 'Backspace') {
        const offsets = selectionOffsetsWithin(rowEl)
        if (!offsets || offsets.start !== 0 || offsets.end !== 0) return
        event.preventDefault()
        const inlines = readInlinesFromElement(rowEl)
        current[index] = { ...row, inlines } as EditorRow
        // Backspace at the start of a heading/list item demotes it first.
        if (row.kind !== 'paragraph') {
          pushHistory()
          current[index] = { key: row.key, kind: 'paragraph', inlines }
          commit({ key: row.key, start: 0, end: 0 })
          return
        }
        if (index === 0) return
        const previous = current[index - 1]
        if (!previous) return
        pushHistory()
        if (previous.kind === 'image') {
          current.splice(index - 1, 1)
          commit({ key: row.key, start: 0, end: 0 })
          return
        }
        const junction = rowPlainText(previous.inlines).length
        current[index - 1] = {
          ...previous,
          inlines: normalizeInlines([...previous.inlines, ...inlines]),
        } as EditorRow
        current.splice(index, 1)
        commit({ key: previous.key, start: junction, end: junction })
        return
      }

      // Caret hops across row boundaries (separate contentEditables).
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const offsets = selectionOffsetsWithin(rowEl)
        if (!offsets || offsets.start !== offsets.end) return
        const length = rowPlainText(readInlinesFromElement(rowEl)).length
        if (event.key === 'ArrowLeft' && offsets.start === 0) {
          event.preventDefault()
          focusAdjacentRow(index, -1, Infinity)
        } else if (event.key === 'ArrowRight' && offsets.start >= length) {
          event.preventDefault()
          focusAdjacentRow(index, 1, 0)
        }
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const before = selectionOffsetsWithin(rowEl)
        if (!before) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        // If the browser can't move within the row (first/last line), the
        // selection stays put — hop to the adjacent row instead.
        setTimeout(() => {
          const after = selectionOffsetsWithin(rowEl)
          if (!after) return
          if (after.start !== before.start || after.end !== before.end) return
          focusAdjacentRow(index, direction as 1 | -1, before.start)
        }, 0)
      }
    },
    [commit, findRowIndex, focusAdjacentRow, pushHistory],
  )

  const handleRowPaste = useCallback(
    (key: string) => (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault()
      // Plain-text paste only in this phase (AGL-582): HTML clipboard
      // conversion and multi-block markdown paste are follow-ups.
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return
      const flattened = text.replace(/\s*\n+\s*/g, ' ')
      const current = rowsRef.current ?? []
      const index = findRowIndex(key)
      const row = current[index]
      if (!row || row.kind === 'image') return
      const rowEl = event.currentTarget
      const inlines = readInlinesFromElement(rowEl)
      const length = rowPlainText(inlines).length
      const offsets = selectionOffsetsWithin(rowEl) ?? {
        start: length,
        end: length,
      }
      current[index] = { ...row, inlines } as EditorRow
      pushHistory()
      current[index] = {
        ...row,
        inlines: replaceInlineRange(inlines, offsets.start, offsets.end, [
          { type: 'text', text: flattened },
        ]),
      } as EditorRow
      const caret = offsets.start + flattened.length
      commit({ key: row.key, start: caret, end: caret })
    },
    [commit, findRowIndex, pushHistory],
  )

  const handleRowClick = useCallback(
    (key: string) => (event: React.MouseEvent<HTMLDivElement>) => {
      const target = (event.target as HTMLElement).closest?.(
        '[data-md-link]',
      ) as HTMLElement | null
      if (target && event.currentTarget.contains(target)) {
        const links = Array.from(
          event.currentTarget.querySelectorAll('[data-md-link]'),
        )
        setLinkPopover({
          anchor: target,
          rowKey: key,
          linkIndex: links.indexOf(target),
          href: target.getAttribute('data-md-href') ?? '',
        })
      }
      captureSelection()
    },
    [captureSelection],
  )

  /** Nth link inline of a row (document order matches inline order). */
  const findLinkInline = useCallback(
    (rowKey: string, linkIndex: number) => {
      const index = findRowIndex(rowKey)
      const row = (rowsRef.current ?? [])[index]
      if (!row || row.kind === 'image') return null
      let seen = -1
      for (let i = 0; i < row.inlines.length; i++) {
        const inline = row.inlines[i]
        if (inline?.type === 'link' && ++seen === linkIndex) {
          return { rowIndex: index, row, inlineIndex: i, inline }
        }
      }
      return null
    },
    [findRowIndex],
  )

  const handleLinkRemove = useCallback(() => {
    if (!linkPopover) return
    const found = findLinkInline(linkPopover.rowKey, linkPopover.linkIndex)
    setLinkPopover(null)
    if (!found) return
    pushHistory()
    const inlines = [...found.row.inlines]
    inlines[found.inlineIndex] = { type: 'text', text: found.inline.text }
    const current = rowsRef.current ?? []
    current[found.rowIndex] = {
      ...found.row,
      inlines: normalizeInlines(inlines),
    } as EditorRow
    commit(null)
  }, [commit, findLinkInline, linkPopover, pushHistory])

  const handleLinkEdit = useCallback(() => {
    if (!linkPopover) return
    setUrlDialog({
      kind: 'link',
      url: linkPopover.href,
      text: '',
      editRowKey: linkPopover.rowKey,
      editLinkIndex: linkPopover.linkIndex,
    })
    setLinkPopover(null)
  }, [linkPopover])

  const handleUrlDialogConfirm = useCallback(() => {
    if (!urlDialog) return
    const url = urlDialog.url.trim()
    const current = rowsRef.current ?? []
    if (urlDialog.kind === 'image') {
      if (!isValidImageUrl(url)) return
      const target = dialogTargetRef.current
      setUrlDialog(null)
      insertImageRow(urlDialog.text.trim(), url, target ? target.index : null)
      return
    }
    if (!isValidLinkUrl(url)) return
    if (urlDialog.editRowKey != null && urlDialog.editLinkIndex != null) {
      const found = findLinkInline(urlDialog.editRowKey, urlDialog.editLinkIndex)
      setUrlDialog(null)
      if (!found) return
      pushHistory()
      const inlines = [...found.row.inlines]
      inlines[found.inlineIndex] = {
        type: 'link',
        text: found.inline.text,
        href: url,
      }
      current[found.rowIndex] = { ...found.row, inlines } as EditorRow
      commit(null)
      return
    }
    const target = dialogTargetRef.current
    setUrlDialog(null)
    if (!target) return
    const row = current[target.index]
    if (!row || row.kind === 'image') return
    pushHistory()
    const text = urlDialog.text.trim() || url
    current[target.index] = {
      ...row,
      inlines: replaceInlineRange(row.inlines, target.start, target.end, [
        { type: 'link', text, href: url },
      ]),
    } as EditorRow
    commit({
      key: row.key,
      start: target.start,
      end: target.start + text.length,
    })
  }, [commit, findLinkInline, insertImageRow, pushHistory, urlDialog])

  const handleImageRemove = useCallback(
    (key: string) => () => {
      const current = rowsRef.current ?? []
      const index = findRowIndex(key)
      if (index < 0) return
      pushHistory()
      current.splice(index, 1)
      if (current.length === 0) current.push(emptyParagraph())
      commit(null)
    },
    [commit, findRowIndex, pushHistory],
  )

  const handleRootKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (key === 'z') {
          // Model-driven rendering breaks native contentEditable undo, so
          // the editor keeps its own snapshot stack (AGL-582).
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
          return
        }
        if (key === 'y' && event.ctrlKey && !event.shiftKey) {
          event.preventDefault()
          redo()
          return
        }
        if (event.shiftKey) return
        if (key === 'b') {
          event.preventDefault()
          execCommand('bold')
          return
        }
        if (key === 'i') {
          event.preventDefault()
          execCommand('italic')
        }
      }
    },
    [execCommand, redo, undo],
  )

  /** Clicking the padding below the last row puts the caret at the end. */
  const handleRootMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target !== rootRef.current) return
      event.preventDefault()
      const current = rowsRef.current ?? []
      for (let index = current.length - 1; index >= 0; index--) {
        const row = current[index]
        if (!row || row.kind === 'image') continue
        const rowEl = rootRef.current?.querySelector<HTMLElement>(
          `[data-row-key="${row.key}"]`,
        )
        if (!rowEl) return
        const length = rowPlainText(row.inlines).length
        rowEl.focus()
        setSelectionIn(rowEl, length, length)
        captureSelection()
        return
      }
    },
    [captureSelection],
  )

  const urlDialogValid =
    urlDialog == null
      ? false
      : urlDialog.kind === 'image'
        ? isValidImageUrl(urlDialog.url.trim())
        : isValidLinkUrl(urlDialog.url.trim())

  return (
    <>
      <Box
        ref={rootRef}
        data-testid="markdown-visual-editor"
        onKeyDown={handleRootKeyDown}
        onMouseDown={handleRootMouseDown}
        sx={{
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          px: 2,
          py: 1.5,
          minHeight,
          maxHeight,
          overflow: 'auto',
          cursor: 'text',
          '&:focus-within': { borderColor: 'primary.main' },
          // Typography mirrors the tenant's Entry Body rendering (AGL-551)
          // so the editing surface reads like the published article.
          '& [data-row-kind]': {
            outline: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
          '& [data-row-kind="paragraph"]': {
            typography: 'body1',
            lineHeight: 1.7,
            my: 0.75,
          },
          '& [data-row-kind="heading2"]': { typography: 'h5', mt: 2, mb: 1 },
          '& [data-row-kind="heading3"]': {
            typography: 'h6',
            mt: 1.5,
            mb: 0.75,
          },
          '& [data-row-kind="listItem"]': {
            typography: 'body1',
            lineHeight: 1.7,
            display: 'list-item',
            listStyleType: 'disc',
            ml: 3,
            my: 0.25,
          },
          '& [data-md-link]': {
            color: 'primary.main',
            textDecoration: 'underline',
            cursor: 'pointer',
          },
          '& img': { maxWidth: '100%', borderRadius: 1 },
        }}
      >
        {placeholderVisible ? (
          <Typography
            variant="body1"
            color="text.disabled"
            sx={{
              position: 'absolute',
              top: 12,
              left: 16,
              pointerEvents: 'none',
            }}
          >
            {'Start writing…'}
          </Typography>
        ) : null}
        {rows.map((row) =>
          row.kind === 'image' ? (
            <ImageRowView
              key={row.key}
              row={row}
              onRemove={handleImageRemove(row.key)}
            />
          ) : (
            <TextRowView
              key={row.key}
              row={row}
              version={version}
              onInput={handleRowInput(row.key)}
              onKeyDown={handleRowKeyDown(row.key)}
              onPaste={handleRowPaste(row.key)}
              onClick={handleRowClick(row.key)}
              onSelectionPing={handleSelectionPing}
            />
          ),
        )}
      </Box>

      <Popover
        open={Boolean(linkPopover)}
        anchorEl={linkPopover?.anchor ?? null}
        onClose={() => setLinkPopover(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ px: 1.5, py: 1, alignItems: 'center', maxWidth: 420 }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ maxWidth: 240 }}
          >
            {linkPopover?.href}
          </Typography>
          <Button size="small" onClick={handleLinkEdit}>
            {'Edit'}
          </Button>
          <Button size="small" color="error" onClick={handleLinkRemove}>
            {'Remove'}
          </Button>
        </Stack>
      </Popover>

      <Dialog
        open={Boolean(urlDialog)}
        onClose={() => setUrlDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {urlDialog?.kind === 'image'
            ? 'Insert image'
            : urlDialog?.editRowKey != null
              ? 'Edit link'
              : 'Insert link'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="URL"
            value={urlDialog?.url ?? ''}
            onChange={(event) =>
              setUrlDialog((prev) =>
                prev ? { ...prev, url: event.target.value } : prev,
              )
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && urlDialogValid) {
                event.preventDefault()
                handleUrlDialogConfirm()
              }
            }}
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText={
              urlDialog?.kind === 'image'
                ? 'https:// image URL'
                : 'https:// or a site path like /pricing'
            }
          />
          {urlDialog?.kind === 'image' ? (
            <TextField
              label="Alt text"
              value={urlDialog.text}
              onChange={(event) =>
                setUrlDialog((prev) =>
                  prev ? { ...prev, text: event.target.value } : prev,
                )
              }
              size="small"
            />
          ) : urlDialog?.editRowKey == null ? (
            <TextField
              label="Text"
              value={urlDialog?.text ?? ''}
              onChange={(event) =>
                setUrlDialog((prev) =>
                  prev ? { ...prev, text: event.target.value } : prev,
                )
              }
              size="small"
              helperText="Falls back to the URL when blank"
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUrlDialog(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!urlDialogValid}
            onClick={handleUrlDialogConfirm}
          >
            {urlDialog?.kind === 'image'
              ? 'Insert'
              : urlDialog?.editRowKey != null
                ? 'Save'
                : 'Insert'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
})
MarkdownVisualEditor.displayName = 'MarkdownVisualEditor'

export default MarkdownVisualEditor
