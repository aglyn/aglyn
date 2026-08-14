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

import * as Aglyn from '@aglyn/aglyn'
import { mdiCodeBraces } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, Button, IconButton, Paper } from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { clampToViewport, useAnchoredRect } from '../hooks/use-anchored-rect'
import useInsertTokenOptions from '../hooks/use-insert-token-options'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import {
  richTextToPlain,
  sanitizeRichText,
} from '../utils/sanitize-rich-text'
import {
  createTokenPillElement,
  materializeTokenPillsInElement,
  readTokenSegmentsFromDom,
  replacePillsWithTokenText,
  TOKEN_PILL_ATTR,
} from '../utils/token-editable-dom'
import {
  parseTokenSegments,
  resolveTokenLabel,
  serializeTokenSegments,
} from '../utils/token-segments'
import { InsertTokenMenu } from './insert-token-menu.component'
import {
  TokenPillPopover,
  tokenPillContainerSx,
} from './token-pill.component'

const RICH_COMMANDS: Array<{ command: string; label: string; title: string }> =
  [
    { command: 'bold', label: 'B', title: 'Bold' },
    { command: 'italic', label: 'I', title: 'Italic' },
    { command: 'underline', label: 'U', title: 'Underline' },
    { command: 'insertUnorderedList', label: '•', title: 'Bulleted list' },
    { command: 'insertOrderedList', label: '1.', title: 'Numbered list' },
  ]

/** Stands in while no edit is open, so the anchor hook can run every render. */
const EMPTY_RECT = { left: 0, top: 0, width: 0, height: 0 }

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

/**
 * Fixed-position overlay that edits a node's text in place, opened by
 * double-clicking a `textEditable` element in the canvas (see
 * DraggableDroppable). Plain components edit through a pill-capable
 * contentEditable line (Enter or blur commits, Shift+Enter breaks a line,
 * Escape cancels). Components flagged `richTextEditable` (AGL-54) get a
 * contentEditable surface with a basic formatting toolbar; the commit
 * sanitizes the markup through an allowlist and stores it in the `html`
 * prop with `children` kept as the plain-text fallback. Either mode
 * commits ONCE through `Aglyn.canvas.updateNodeProps` (a single undo entry).
 *
 * Binding pills (AGL-586): stored `{{...}}` tokens render as named,
 * colored, atomic pills in BOTH modes when the editor opens; the toolbar's
 * {x} button opens the same grouped insert picker as the attributes panel
 * (assembled from this node's ancestor context) and drops a pill at the
 * caret; clicking a pill offers Replace/Remove. Commits serialize pills
 * back to raw token syntax — names shown, ids stored.
 *
 * Instance prop overrides (AGL-1304): opened with a `propTarget`, the same
 * surface edits a component instance's `propValues[propName]` instead of a
 * node's `children` — the double-clicked leaf is a GRAFTED preview node,
 * not a canvas node, so the commit rides the instance. Always the plain
 * surface (prop values substitute as strings), the same single
 * `updateNodeProps` commit (one undo entry, and the same node-changed
 * signal co-editing's shadow diff already mirrors), and an emptied commit
 * REMOVES the override so the component's own copy returns — exactly what
 * clearing the Attributes field does.
 */
export const InlineTextEditorComponent = observer(
  function InlineTextEditorComponent() {
    const node = inlineTextEdit.node
    const rect = inlineTextEdit.rect
    const propTarget = inlineTextEdit.propTarget
    // Follows the element as the canvas scrolls or resizes (AGL-1644). Called
    // unconditionally, above the `!node || !rect` bail-out further down, so the
    // hook order is stable whether or not an edit is open.
    const live = useAnchoredRect(inlineTextEdit.anchor, rect ?? EMPTY_RECT)
    const plainRef = useRef<HTMLDivElement>(null)
    const richRef = useRef<HTMLDivElement>(null)
    // Distinguish commit-blur (Enter already committed) from cancel paths.
    const committedRef = useRef(false)
    // The insert picker / pill popover take focus (portal + autofocus
    // search) — commit-on-blur must stand down while one is open, or the
    // editor would commit and close under the open menu (AGL-586).
    const menuOpenRef = useRef(false)
    const savedRangeRef = useRef<Range | null>(null)
    const [insertMenu, setInsertMenu] = useState<{
      anchorEl: HTMLElement
      replacePill: HTMLElement | null
    } | null>(null)
    const [pillMenu, setPillMenu] = useState<HTMLElement | null>(null)

    // Same context walk as the attributes panel (AGL-583) — the edited
    // node is known, so dataset-item / entry groups resolve identically.
    const { options: insertOptions, labelContext } =
      useInsertTokenOptions(node)
    const labelContextRef = useRef(labelContext)
    labelContextRef.current = labelContext

    // A prop edit is always the plain surface: prop values substitute into
    // the definition as strings (see buildPropTokens), so there is no
    // per-instance html channel for the rich toolbar to write.
    const rich =
      !propTarget &&
      ((node?.componentSchema?.flags?.richTextEditable ??
        Aglyn.FEATURE_FLAG.DISABLED) &
        Aglyn.FEATURE_FLAG.ENABLED) !==
        0

    const activeEditable = useCallback(
      () => (rich ? richRef.current : plainRef.current),
      [rich],
    )

    useEffect(() => {
      if (!node) return
      committedRef.current = false
      menuOpenRef.current = false
      savedRangeRef.current = null
      const props = { ...node.props, ...node.resolvedProps } as any
      const text = propTarget
        ? propTarget.initialText
        : typeof props?.children === 'string'
          ? (props.children as string)
          : ''
      const resolve = (token: string) =>
        resolveTokenLabel(token, labelContextRef.current)
      if (rich) {
        const initial =
          typeof props?.html === 'string' && props.html
            ? (props.html as string)
            : escapeHtml(text)
        // Set once on open — contentEditable manages its own DOM after.
        const raf = requestAnimationFrame(() => {
          if (richRef.current) {
            richRef.current.innerHTML = initial
            // Raw {{tokens}} in the stored markup become pills (AGL-586).
            materializeTokenPillsInElement(richRef.current, resolve)
            richRef.current.focus()
            // Place the caret at the end of the content.
            const selection = window.getSelection()
            if (selection) {
              const range = document.createRange()
              range.selectNodeContents(richRef.current)
              range.collapse(false)
              selection.removeAllRanges()
              selection.addRange(range)
            }
          }
        })
        return () => cancelAnimationFrame(raf)
      }
      // Plain mode: build text nodes + pills once, then the browser owns
      // the DOM (same contract as rich mode).
      const raf = requestAnimationFrame(() => {
        const editable = plainRef.current
        if (!editable) return
        editable.textContent = ''
        for (const segment of parseTokenSegments(text)) {
          if (segment.type === 'token') {
            editable.appendChild(
              createTokenPillElement(
                document,
                segment.token ?? segment.value,
                resolve(segment.token ?? segment.value),
              ),
            )
          } else {
            editable.appendChild(document.createTextNode(segment.value))
          }
        }
        editable.focus()
        // Select-all on open (the textarea behavior this surface replaced).
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(editable)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      })
      return () => cancelAnimationFrame(raf)
    }, [node, rich, propTarget])

    const commit = useCallback(() => {
      if (committedRef.current) return
      committedRef.current = true
      const current = inlineTextEdit.node
      if (current) {
        // updateNodeProps REPLACES the props object — spread the existing
        // props so variant/component/etc. survive the text edit.
        if (rich && richRef.current) {
          // Pills serialize back to raw tokens BEFORE sanitizing (the
          // sanitizer strips attributes, and pill labels must never
          // reach storage) — on a clone, the live DOM stays intact.
          const clone = richRef.current.cloneNode(true) as HTMLElement
          replacePillsWithTokenText(clone)
          const sanitized = sanitizeRichText(clone.innerHTML)
          const plain = richTextToPlain(sanitized)
          const hasMarkup = /<[a-z]/i.test(sanitized)
          Aglyn.canvas.updateNodeProps(current, {
            ...current.props,
            // Empty html falls back to plain children in the renderer.
            html: hasMarkup ? sanitized : '',
            children: plain,
          })
        } else if (plainRef.current) {
          let value = serializeTokenSegments(
            readTokenSegmentsFromDom(plainRef.current),
          )
          // An emptied contentEditable leaves a stray <br> behind.
          if (value === '\n') value = ''
          const target = inlineTextEdit.propTarget
          if (target) {
            // Instance prop override (AGL-1304): the edit rides the
            // INSTANCE's nested propValues, never the grafted leaf (which
            // is not a canvas node). An emptied value REMOVES the key —
            // the graft treats '' as unset anyway, and a cleared override
            // must read as clean, exactly like the style-override layer.
            const values = {
              ...(current.props?.[
                Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY
              ] as Record<string, unknown> | undefined),
            }
            if (value === '') delete values[target.propName]
            else values[target.propName] = value
            const nextProps = {
              ...current.props,
              [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: values,
            }
            // The LAST override cleared: drop the container too, so the
            // stored instance is byte-identical to one never overridden.
            if (!Object.keys(values).length) {
              delete nextProps[Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]
            }
            Aglyn.canvas.updateNodeProps(current, nextProps)
          } else {
            Aglyn.canvas.updateNodeProps(current, {
              ...current.props,
              children: value,
            })
          }
        }
      }
      inlineTextEdit.close()
    }, [rich])

    const cancel = useCallback(() => {
      committedRef.current = true
      inlineTextEdit.close()
    }, [])

    const handleEditableBlur = useCallback(() => {
      if (menuOpenRef.current) return
      commit()
    }, [commit])

    /** Shift+Enter in plain mode: a literal newline, DOM kept flat. */
    const insertPlainNewline = useCallback(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const newline = document.createTextNode('\n')
      range.insertNode(newline)
      range.setStartAfter(newline)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }, [])

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          commit()
        } else if (event.key === 'Enter') {
          // Browsers fork contentEditable into <div>s on Enter — insert
          // the newline ourselves so reads stay text + pills only.
          event.preventDefault()
          insertPlainNewline()
        }
      },
      [cancel, commit, insertPlainNewline],
    )

    const handleRichKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          commit()
        }
      },
      [cancel, commit],
    )

    // Keep the selection inside the editable surface while clicking tools.
    const keepFocus = useCallback((event: MouseEvent) => {
      event.preventDefault()
    }, [])

    const exec = useCallback(
      (command: string) => () => {
        // execCommand is deprecated but universally supported and keeps this
        // dependency-free; the output is normalized by the sanitizer anyway.
        document.execCommand(command)
        richRef.current?.focus()
      },
      [],
    )

    const handleLink = useCallback(() => {
      const url = window.prompt('Link URL (https://…)')
      if (url) document.execCommand('createLink', false, url)
      richRef.current?.focus()
    }, [])

    /** Pill clicks (delegated): offer Replace/Remove (AGL-586). */
    const handleEditableClick = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        const pill = (event.target as HTMLElement).closest?.(
          `[${TOKEN_PILL_ATTR}]`,
        ) as HTMLElement | null
        if (!pill || !event.currentTarget.contains(pill)) return
        menuOpenRef.current = true
        setPillMenu(pill)
      },
      [],
    )

    // Pills are non-editable islands — a mousedown on one would move
    // focus out of the editable and trigger commit-on-blur.
    const handleEditableMouseDown = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        const pill = (event.target as HTMLElement).closest?.(
          `[${TOKEN_PILL_ATTR}]`,
        )
        if (pill) event.preventDefault()
      },
      [],
    )

    /** The toolbar {x}: captures the live selection, opens the picker. */
    const handleInsertOpen = useCallback(
      (event: MouseEvent<HTMLElement>) => {
        const editable = activeEditable()
        const selection = window.getSelection()
        const range =
          selection && selection.rangeCount > 0
            ? selection.getRangeAt(0)
            : null
        savedRangeRef.current =
          range &&
          editable &&
          editable.contains(range.startContainer) &&
          editable.contains(range.endContainer)
            ? range.cloneRange()
            : null
        menuOpenRef.current = true
        setInsertMenu({ anchorEl: event.currentTarget, replacePill: null })
      },
      [activeEditable],
    )

    const closeMenus = useCallback(() => {
      setInsertMenu(null)
      setPillMenu(null)
      menuOpenRef.current = false
      activeEditable()?.focus()
    }, [activeEditable])

    const handleInsertPick = useCallback(
      (token: string) => {
        const editable = activeEditable()
        const replacePill = insertMenu?.replacePill ?? null
        setInsertMenu(null)
        menuOpenRef.current = false
        if (!editable) return
        const pill = createTokenPillElement(
          document,
          token,
          resolveTokenLabel(token, labelContextRef.current),
        )
        if (replacePill && editable.contains(replacePill)) {
          replacePill.replaceWith(pill)
        } else {
          const range = savedRangeRef.current
          if (
            range &&
            editable.contains(range.startContainer) &&
            editable.contains(range.endContainer)
          ) {
            range.deleteContents()
            range.insertNode(pill)
          } else {
            editable.appendChild(pill)
          }
        }
        savedRangeRef.current = null
        editable.focus()
        // Caret lands just after the pill, ready to keep typing.
        const selection = window.getSelection()
        if (selection) {
          const after = document.createRange()
          after.setStartAfter(pill)
          after.collapse(true)
          selection.removeAllRanges()
          selection.addRange(after)
        }
      },
      [activeEditable, insertMenu],
    )

    const handlePillReplace = useCallback(() => {
      const pill = pillMenu
      setPillMenu(null)
      if (!pill) {
        menuOpenRef.current = false
        return
      }
      // Keep menuOpenRef up — the insert picker opens next.
      setInsertMenu({ anchorEl: pill, replacePill: pill })
    }, [pillMenu])

    const handlePillRemove = useCallback(() => {
      pillMenu?.remove()
      closeMenus()
    }, [pillMenu, closeMenus])

    const insertButton = (
      <IconButton
        size="small"
        title="Insert data"
        aria-label="Insert data token"
        onMouseDown={keepFocus}
        onClick={handleInsertOpen}
        sx={{ width: 28, height: 28, borderRadius: 0.5 }}
      >
        <MdiIcon path={mdiCodeBraces.path} fontSize="small" />
      </IconButton>
    )

    if (!node || !rect) return null

    // Read at render, which `useAnchoredRect` makes safe: it re-renders on
    // every scroll and resize, so these are never a stale snapshot. The toolbar
    // sits 40px ABOVE the surface, so the top margin has to clear it or the
    // controls go off-screen while the editable stays on it.
    const viewportWidth =
      typeof window === 'undefined' ? Infinity : window.innerWidth
    const viewportHeight =
      typeof window === 'undefined' ? Infinity : window.innerHeight
    const minWidth = Math.max(live.width, 120)
    const TOOLBAR_CLEARANCE = 48
    const KEEP_VISIBLE = 80

    return (
      <Box
        data-aglyn="overlay:inline-text-editor"
        sx={{
          position: 'fixed',
          left: clampToViewport(live.left, minWidth, viewportWidth),
          top: clampToViewport(
            live.top,
            KEEP_VISIBLE,
            viewportHeight,
            TOOLBAR_CLEARANCE,
          ),
          minWidth,
          maxWidth: '90vw',
          zIndex: (theme) => theme.zIndex.modal,
        }}
      >
        {rich ? (
          <>
            <Paper
              elevation={4}
              sx={{
                position: 'absolute',
                top: -40,
                left: 0,
                px: 0.5,
                py: 0.25,
                display: 'flex',
                gap: 0.25,
                alignItems: 'center',
              }}
            >
              {RICH_COMMANDS.map(({ command, label, title }) => (
                <IconButton
                  key={command}
                  size="small"
                  title={title}
                  onMouseDown={keepFocus}
                  onClick={exec(command)}
                  sx={{
                    width: 28,
                    height: 28,
                    fontSize: 13,
                    fontWeight: 700,
                    fontStyle: command === 'italic' ? 'italic' : undefined,
                    textDecoration:
                      command === 'underline' ? 'underline' : undefined,
                    borderRadius: 0.5,
                  }}
                >
                  {label}
                </IconButton>
              ))}
              <IconButton
                size="small"
                title="Insert link"
                onMouseDown={keepFocus}
                onClick={handleLink}
                sx={{ width: 28, height: 28, fontSize: 13, borderRadius: 0.5 }}
              >
                {'🔗'}
              </IconButton>
              {insertButton}
              <Button
                size="small"
                color="primary"
                onMouseDown={keepFocus}
                onClick={commit}
              >
                {'Done'}
              </Button>
            </Paper>
            <Box
              ref={richRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Edit rich text"
              onKeyDown={handleRichKeyDown}
              onBlur={handleEditableBlur}
              onClick={handleEditableClick}
              onMouseDown={handleEditableMouseDown}
              sx={{
                width: '100%',
                minHeight: rect.height,
                font: 'inherit',
                p: 0.5,
                bgcolor: 'background.paper',
                color: 'text.primary',
                border: '2px solid',
                borderColor: 'tertiary.main',
                borderRadius: 0.5,
                outline: 'none',
                boxShadow: 4,
                '& a': { pointerEvents: 'none' },
                ...tokenPillContainerSx,
              }}
            />
          </>
        ) : (
          <>
            {/* Plain mode grew a mini toolbar for the insert picker
                (AGL-586); Enter still commits, Escape still cancels. */}
            <Paper
              elevation={4}
              sx={{
                position: 'absolute',
                top: -40,
                left: 0,
                px: 0.5,
                py: 0.25,
                display: 'flex',
                gap: 0.25,
                alignItems: 'center',
              }}
            >
              {insertButton}
              <Button
                size="small"
                color="primary"
                onMouseDown={keepFocus}
                onClick={commit}
              >
                {'Done'}
              </Button>
            </Paper>
            <Box
              ref={plainRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Edit text"
              onKeyDown={handleKeyDown}
              onBlur={handleEditableBlur}
              onClick={handleEditableClick}
              onMouseDown={handleEditableMouseDown}
              sx={{
                width: '100%',
                minHeight: rect.height,
                font: 'inherit',
                p: 0.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                bgcolor: 'background.paper',
                color: 'text.primary',
                border: '2px solid',
                borderRadius: 0.5,
                borderColor: 'tertiary.main',
                outline: 'none',
                boxShadow: 4,
                ...tokenPillContainerSx,
              }}
            />
          </>
        )}
        <InsertTokenMenu
          anchorEl={insertMenu?.anchorEl ?? null}
          open={Boolean(insertMenu)}
          onClose={closeMenus}
          options={insertOptions}
          onInsert={handleInsertPick}
        />
        <TokenPillPopover
          anchorEl={pillMenu}
          token={pillMenu?.getAttribute(TOKEN_PILL_ATTR) ?? ''}
          onClose={closeMenus}
          onReplace={handlePillReplace}
          onRemove={handlePillRemove}
        />
      </Box>
    )
  },
)
InlineTextEditorComponent.displayName = 'InlineTextEditorComponent'

export default InlineTextEditorComponent
