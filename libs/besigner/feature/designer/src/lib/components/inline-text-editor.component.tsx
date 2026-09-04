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
import type { Theme } from '@mui/material/styles'
import type { SystemStyleObject } from '@mui/system'
import isEqual from 'lodash-es/isEqual'
import { toJS } from 'mobx'
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
import {
  beginInPlaceEdit,
  type InPlaceEditSurface,
  selectionOf,
} from '../utils/in-place-edit-surface'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import { richTextCommandGroups } from '../utils/rich-text-commands'
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

/**
 * The formatting tools, each tagged with the group that has to be allowed
 * for it to appear (AGL-2557).
 *
 * The toolbar used to render this list whole, which is why rich text could
 * only ever be offered by a component that could hold all of it — a
 * `<button>` cannot hold a list, so Accordion Summary and Button were left
 * with no formatting at all rather than with the half that is safe in them.
 */
const RICH_COMMANDS: Array<{
  command: string
  label: string
  title: string
  group: Aglyn.RICH_TEXT_COMMANDS
}> = [
  {
    command: 'bold',
    label: 'B',
    title: 'Bold',
    group: Aglyn.RICH_TEXT_COMMANDS.EMPHASIS,
  },
  {
    command: 'italic',
    label: 'I',
    title: 'Italic',
    group: Aglyn.RICH_TEXT_COMMANDS.EMPHASIS,
  },
  {
    command: 'underline',
    label: 'U',
    title: 'Underline',
    group: Aglyn.RICH_TEXT_COMMANDS.EMPHASIS,
  },
  {
    command: 'insertUnorderedList',
    label: '•',
    title: 'Bulleted list',
    group: Aglyn.RICH_TEXT_COMMANDS.LIST,
  },
  {
    command: 'insertOrderedList',
    label: '1.',
    title: 'Numbered list',
    group: Aglyn.RICH_TEXT_COMMANDS.LIST,
  },
]

/** Stands in while no edit is open, so the anchor hook can run every render. */
const EMPTY_RECT = { left: 0, top: 0, width: 0, height: 0 }

/**
 * The fallback editor, for an edit with no element to type into — opened
 * with no anchor, or on an anchor already detached from the document.
 *
 * Deliberately OPAQUE. It floats over content that cannot re-flow with it,
 * and a see-through surface in that position is what drew two texts over
 * each other; covering what it stands on is honest, blending with it is not.
 * Everything else edits the canvas leaf itself and needs no surface here.
 */
const BOXED_SURFACE_SX = {
  p: 0.5,
  bgcolor: 'background.paper',
  color: 'text.primary',
  border: '2px solid',
  borderColor: 'tertiary.main',
  borderRadius: 0.5,
  outline: 'none',
  boxShadow: 4,
}

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
    const anchor = inlineTextEdit.anchor
    const live = useAnchoredRect(anchor, rect ?? EMPTY_RECT)
    /**
     * Whether the canvas leaf ITSELF is the editing surface (AGL-2486).
     *
     * When it is, this component renders only the toolbar: there is no
     * second rectangle to keep in sync with the text, so the text cannot
     * move or restyle when editing begins and the layout re-flows because
     * the element really did grow. That is the
     * transparent-if-and-only-if-reserved invariant satisfied by
     * construction rather than by a check.
     *
     * When it is not — no element to type into — the opaque fallback
     * overlay is used instead.
     */
    const [inPlaceActive, setInPlaceActive] = useState(false)
    const overlayRef = useRef<HTMLElement>(null)
    const plainRef = useRef<HTMLDivElement>(null)
    const richRef = useRef<HTMLDivElement>(null)
    // Distinguish commit-blur (Enter already committed) from cancel paths.
    const committedRef = useRef(false)
    /**
     * Whether the surface has been BUILT from the node yet (AGL-2486).
     *
     * The editable is populated and focused on a `requestAnimationFrame`, so
     * between opening and that frame it is an empty box holding no caret.
     * Committing then reads emptiness as an author's deletion and writes
     * `children: ''` — the element's text is gone from the canvas, the
     * co-editing mirror publishes it, and every joiner gets the blank.
     * Measured exactly that way against screen `yFjgqiG2wm`: node
     * `XlqFJTz4ej` ("Be first through the door") went to `children: ''` from
     * a double-click and a click-away, with nothing typed. A background tab
     * makes it certain rather than rare — `requestAnimationFrame` does not
     * run in one at all, so the surface NEVER seeds and every click-away is
     * a wipe.
     *
     * Nothing can be lost by refusing: a surface that was never built holds
     * no caret and no typing.
     */
    const seededRef = useRef(false)
    /** The canvas leaf while it IS the editing surface — see beginInPlaceEdit. */
    const inPlaceRef = useRef<InPlaceEditSurface | undefined>(undefined)
    /**
     * Latest handlers for the listeners bound onto the leaf. They are bound
     * once per edit, so they must not close over a stale render.
     */
    const handlersRef = useRef({
      keyDown: (_e: KeyboardEvent<HTMLDivElement>) => undefined as void,
      richKeyDown: (_e: KeyboardEvent<HTMLDivElement>) => undefined as void,
      blur: () => undefined as void,
      click: (_e: MouseEvent<HTMLDivElement>) => undefined as void,
      mouseDown: (_e: MouseEvent<HTMLDivElement>) => undefined as void,
    })
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

    // What THIS component's schema allows (AGL-2557); a schema that names
    // nothing allows everything, which is what leaves Typography alone.
    const commandGroups = richTextCommandGroups(node?.componentSchema)
    /**
     * The surface may hold phrasing content only.
     *
     * Derived from the allowance rather than declared beside it: a component
     * that can take neither a list nor a link is one whose element admits no
     * block and no nested control, and that single fact is what the commit
     * sanitizer, the Enter key and the toolbar all need. Two ways to say it
     * would eventually say two different things.
     */
    const phrasingOnly =
      rich &&
      !commandGroups.has(Aglyn.RICH_TEXT_COMMANDS.LIST) &&
      !commandGroups.has(Aglyn.RICH_TEXT_COMMANDS.LINK)

    const activeEditable = useCallback(
      () =>
        inPlaceRef.current?.element ??
        (rich ? richRef.current : plainRef.current),
      [rich],
    )

    /**
     * Opens the edit: builds the content once, and puts it in the canvas
     * leaf itself wherever that is possible (AGL-2486).
     *
     * The builder is shared deliberately. In-place and the fallback overlay
     * must show the SAME thing — the same pills, the same markup, the same
     * plain-text seed — or the two paths would drift into two editors.
     */
    useEffect(() => {
      if (!node) return
      committedRef.current = false
      menuOpenRef.current = false
      savedRangeRef.current = null
      seededRef.current = false
      const props = { ...node.props, ...node.resolvedProps } as any
      const text = propTarget
        ? propTarget.initialText
        : typeof props?.children === 'string'
          ? (props.children as string)
          : ''
      const resolve = (token: string) =>
        resolveTokenLabel(token, labelContextRef.current)

      const build = (target: HTMLElement) => {
        if (rich) {
          const initial =
            typeof props?.html === 'string' && props.html
              ? (props.html as string)
              : escapeHtml(text)
          target.innerHTML = initial
          // Raw {{tokens}} in the stored markup become pills (AGL-586).
          materializeTokenPillsInElement(target, resolve)
          return
        }
        // Plain mode: text nodes + pills, then the browser owns the DOM.
        target.textContent = ''
        for (const segment of parseTokenSegments(text)) {
          if (segment.type === 'token') {
            target.appendChild(
              createTokenPillElement(
                target.ownerDocument,
                segment.token ?? segment.value,
                resolve(segment.token ?? segment.value),
              ),
            )
          } else {
            target.appendChild(target.ownerDocument.createTextNode(segment.value))
          }
        }
      }

      // The element itself, whenever there is one to edit.
      const surface = beginInPlaceEdit(anchor, build)
      if (surface) {
        inPlaceRef.current = surface
        seededRef.current = true
        setInPlaceActive(true)
        surface.element.focus()
        const selection = surface.selection()
        if (selection) {
          const range = surface.element.ownerDocument.createRange()
          range.selectNodeContents(surface.element)
          // Caret at the end, never select-all: the author double-clicked a
          // word to edit it, and replacing the lot on the next keystroke is
          // how a heading gets destroyed by a typo.
          range.collapse(false)
          selection.removeAllRanges()
          selection.addRange(range)
        }
        return () => {
          surface.dispose()
          inPlaceRef.current = undefined
          setInPlaceActive(false)
        }
      }

      // No element to edit — the OPAQUE overlay. Built on a frame because
      // the surface it writes into has not rendered yet, which is the race
      // `seededRef` exists for.
      setInPlaceActive(false)
      const raf = requestAnimationFrame(() => {
        const editable = rich ? richRef.current : plainRef.current
        if (!editable) return
        build(editable)
        editable.focus()
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(editable)
          if (rich) range.collapse(false)
          selection.removeAllRanges()
          selection.addRange(range)
        }
        seededRef.current = true
      })
      return () => cancelAnimationFrame(raf)
    }, [node, rich, propTarget, anchor])

    /**
     * Writes `next` only when it is a different document (AGL-2486).
     *
     * Closing this editor is not by itself an edit. Every branch below
     * rebuilds the WHOLE props object from the surface's DOM, so a commit
     * that changed nothing still produced a fresh object — an undo entry, a
     * node-changed signal, and a co-editing mirror publish, all for an edit
     * the author never made. The mirror is the expensive one: it is cleared
     * only by a successful save, so an unsaved no-op is replayed into every
     * joiner's canvas for `COEDIT_MIRROR_MAX_AGE_MS` (seven days) and each
     * of them opens a document that reads dirty with nothing to see.
     */
    const commitProps = useCallback(
      (node: Aglyn.NodeSchema<any>, next: Record<string, unknown>) => {
        if (isEqual(toJS(node.props), next)) return
        Aglyn.canvas.updateNodeProps(node, next as never)
      },
      [],
    )

    const commit = useCallback(() => {
      if (committedRef.current) return
      committedRef.current = true
      const current = inlineTextEdit.node
      // An unbuilt surface is not an emptied one (AGL-2486) — close, do not
      // write. See `seededRef`.
      /**
       * Collected first, WRITTEN LAST (AGL-2486).
       *
       * The markup this computes is correct; the hazard is that it can be
       * undone a moment later. Ending the edit restores the element's
       * original child nodes — deliberately, by reference, so React's fibers
       * keep pointing at live nodes — and that restore must not run in the
       * effect cleanup, i.e. AFTER `updateNodeProps` has already told React
       * to re-render the leaf. In that order React paints the new text and
       * the parked ORIGINAL nodes then go back over the top of it, so an
       * edit reads as never having taken.
       *
       * Worst for formatted text, which is how it was found: a node with
       * `html` renders through `dangerouslySetInnerHTML`, so React does not
       * track those children at all and never corrects them afterwards. The
       * canvas kept the pre-edit markup, the store held the new value, and
       * the break came back every time — until "Remove formatting" dropped
       * `html` and the plain `children` finally showed.
       *
       * So the element is given back BEFORE the store is written, and the
       * write is the last thing that happens. React then re-renders onto a
       * subtree that is exactly where it left it.
       */
      let nextWrite: Record<string, unknown> | undefined
      if (current && seededRef.current) {
        // UpdateNodeProps REPLACES the props object — spread the existing
        // props so variant/component/etc. survive the text edit.
        const surface = activeEditable()
        if (rich && surface) {
          // Pills serialize back to raw tokens BEFORE sanitizing (the
          // sanitizer strips attributes, and pill labels must never
          // reach storage) — on a clone, the live DOM stays intact.
          const clone = surface.cloneNode(true) as HTMLElement
          replacePillsWithTokenText(clone)
          // The toolbar offers no block command on a phrasing-only surface,
          // but a PASTE can still carry one in, and the renderer would strip
          // it — so the commit strips it first and what is stored is what
          // the page will draw.
          const sanitized = sanitizeRichText(clone.innerHTML, { phrasingOnly })
          const plain = richTextToPlain(sanitized)
          const hasMarkup = /<[a-z]/i.test(sanitized)
          const nextProps: Record<string, unknown> = {
            ...toJS(current.props),
            children: plain,
          }
          // ABSENT, not `''`, when there is no markup (AGL-2486). The
          // renderer gates on `typeof html === 'string' && Boolean(html)`,
          // so the two are the same document to everything that draws it —
          // but `isInitialSame` compares serialized node maps with
          // `isEqual`, and there the empty key is a difference. Writing it
          // onto a node that never had one is what put SAVE on the header
          // of a screen nobody had touched.
          if (hasMarkup) nextProps['html'] = sanitized
          else delete nextProps['html']
          nextWrite = nextProps
        } else if (surface) {
          let value = serializeTokenSegments(
            readTokenSegmentsFromDom(surface),
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
            nextWrite = toJS(nextProps) as Record<string, unknown>
          } else {
            nextWrite = {
              ...toJS(current.props),
              children: value,
            }
          }
        }
      }
      // Give the element back to React BEFORE the write — see `nextWrite`.
      inPlaceRef.current?.dispose()
      inPlaceRef.current = undefined
      if (current && nextWrite) commitProps(current, nextWrite)
      inlineTextEdit.close()
    }, [rich, phrasingOnly, commitProps, activeEditable])

    const cancel = useCallback(() => {
      committedRef.current = true
      inlineTextEdit.close()
    }, [])

    const handleEditableBlur = useCallback(() => {
      if (menuOpenRef.current) return
      commit()
    }, [commit])

    // Latest `commit` for the document listener below, which must not
    // re-register on every render just to stay current.
    const commitRef = useRef(commit)
    commitRef.current = commit

    /**
     * Wires the editing handlers onto the LEAF while it is the surface.
     *
     * Imperatively, because the element belongs to the canvas renderer and
     * not to this component's JSX — the same reason `contentEditable` is set
     * as a DOM property. Registered once per edit and torn down with it.
     *
     * No `input` handler is needed any more, and that absence is the point:
     * the element being typed into IS the element being laid out, so the
     * card, the row and the siblings re-flow on their own. The stand-in that
     * used to reproduce that effect for an overlay is gone with the overlay.
     */
    useEffect(() => {
      const surface = inPlaceActive ? inPlaceRef.current : undefined
      const element = surface?.element
      if (!element) return
      const onKeyDown = (event: Event) =>
        (rich ? handlersRef.current.richKeyDown : handlersRef.current.keyDown)(
          event as unknown as KeyboardEvent<HTMLDivElement>,
        )
      const onBlur = () => handlersRef.current.blur()
      const onClick = (event: Event) =>
        handlersRef.current.click(
          event as unknown as MouseEvent<HTMLDivElement>,
        )
      const onMouseDown = (event: Event) =>
        handlersRef.current.mouseDown(
          event as unknown as MouseEvent<HTMLDivElement>,
        )
      element.addEventListener('keydown', onKeyDown)
      element.addEventListener('blur', onBlur)
      element.addEventListener('click', onClick)
      element.addEventListener('mousedown', onMouseDown)
      return () => {
        element.removeEventListener('keydown', onKeyDown)
        element.removeEventListener('blur', onBlur)
        element.removeEventListener('click', onClick)
        element.removeEventListener('mousedown', onMouseDown)
      }
    }, [inPlaceActive, rich])

    /**
     * Click-away commits, because on this canvas blur never arrives
     * (AGL-2486).
     *
     * `commit()` used to be reachable from a click only through `onBlur`,
     * and a click on another element cannot produce one: `DraggableDroppable`
     * registers `mousedown` AND `pointerdown` on every leaf and both begin
     * `e.preventDefault(); e.stopPropagation()`. Preventing a mousedown's
     * default suppresses the focus change it would have caused, so the
     * editable keeps focus and stays open — while the same handler runs
     * `Besigner.focus.handleNodeSelection(node, …)` and moves the selection
     * out from under it. Clicking out "just selects other elements rather
     * than applying", and the edit sits in a surface the author has already
     * mentally left. This repo has recorded that exact shape once before:
     * an attribute that commits on blur, discarded by selecting the next
     * node, with the canvas still looking right.
     *
     * A CAPTURE-phase listener on the document is what reaches the commit
     * first: capture runs from the document down, so it is ahead of the
     * leaf's own bubble-phase listener and ahead of the `preventDefault`
     * that would have swallowed the blur. It calls the SAME `commit()` the
     * Done button does — one commit path, one undo entry, and the same
     * no-op guard, rather than a second route into the document.
     *
     * The click is deliberately NOT consumed: committing and then letting
     * the canvas select what was clicked is what every other design tool
     * does, and it is what the author asked for by clicking there.
     *
     * `pointerdown`, not `mousedown`: it is the first of the pair, and
     * `preventDefault` on it suppresses the mouse events that follow, so a
     * `mousedown` listener would never run for a touch or pen edit.
     *
     * Targets inside the canvas retarget to its CLOSED shadow host, which is
     * not inside this overlay, so `contains` reads them as outside — which
     * they are. The portalled insert picker and pill popover ARE outside the
     * overlay in the DOM, and are covered by the same `menuOpenRef` stand-down
     * that already guards commit-on-blur (AGL-586).
     */
    useEffect(() => {
      if (!node) return
      const editing = inPlaceRef.current?.element
      const root = editing?.getRootNode() as ShadowRoot | Document | undefined
      const host =
        root && 'host' in root ? (root as ShadowRoot).host : undefined

      const isInsideTheEditor = (target: Node | null): boolean => {
        if (!target) return false
        // Read LIVE, never the value captured when this effect ran: a click
        // inside the text is the author placing a caret, and getting that
        // wrong tears the surface down and rebuilds it on every click, which
        // looks exactly like a caret that will not move.
        const live = inPlaceRef.current?.element
        if (live?.contains(target)) return true
        const overlay = overlayRef.current
        return Boolean(overlay?.contains(target))
      }

      const handlePointerDownAway = (event: Event) => {
        if (menuOpenRef.current) return
        const target = event.target as Node | null
        // Inside the CLOSED canvas root, an event seen from the document has
        // already been retargeted to the host, so it cannot say whether the
        // click landed on the text being edited or beside it. The listener on
        // the root itself sees the real target and has already decided; this
        // one must not overrule it with a guess.
        if (host && target === host) return
        if (isInsideTheEditor(target)) return
        commitRef.current()
      }

      document.addEventListener('pointerdown', handlePointerDownAway, true)
      // Second listener, INSIDE the shadow root, for the clicks the first one
      // is blind to — including a click on the very element being edited,
      // which must move the caret rather than end the edit.
      if (root && root !== document) {
        root.addEventListener('pointerdown', handlePointerDownAway, true)
      }
      return () => {
        document.removeEventListener('pointerdown', handlePointerDownAway, true)
        if (root && root !== document) {
          root.removeEventListener('pointerdown', handlePointerDownAway, true)
        }
      }
    }, [node, inPlaceActive])

    const insertPlainNewline = useCallback(() => {
      const editable = activeEditable()
      const selection = editable ? selectionOf(editable) : null
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const newline = document.createTextNode('\n')
      range.insertNode(newline)
      range.setStartAfter(newline)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }, [activeEditable])

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
        } else if (event.key === 'Enter' && phrasingOnly && !event.shiftKey) {
          // A phrasing-only surface is a control's LABEL — a button, a link,
          // an accordion header. Enter there means "done", the same as it
          // does on the plain surface; a browser would otherwise fork the
          // contentEditable into `<div>`s, which is exactly the markup this
          // surface may not hold. Shift+Enter still breaks the line, and a
          // `<br>` is phrasing content.
          event.preventDefault()
          commit()
        }
      },
      [cancel, commit, phrasingOnly],
    )

    // Keep the selection inside the editable surface while clicking tools.
    const keepFocus = useCallback((event: MouseEvent) => {
      event.preventDefault()
    }, [])

    const exec = useCallback(
      (command: string) => () => {
        // ExecCommand is deprecated but universally supported and keeps this
        // dependency-free; the output is normalized by the sanitizer anyway.
        document.execCommand(command)
        activeEditable()?.focus()
      },
      [activeEditable],
    )

    const handleLink = useCallback(() => {
      const url = window.prompt('Link URL (https://…)')
      if (url) document.execCommand('createLink', false, url)
      activeEditable()?.focus()
    }, [activeEditable])

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

    handlersRef.current = {
      keyDown: handleKeyDown,
      richKeyDown: handleRichKeyDown,
      blur: handleEditableBlur,
      click: handleEditableClick,
      mouseDown: handleEditableMouseDown,
    }

    /** The toolbar {x}: captures the live selection, opens the picker. */
    const handleInsertOpen = useCallback(
      (event: MouseEvent<HTMLElement>) => {
        const editable = activeEditable()
        const selection = editable ? selectionOf(editable) : null
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
        const selection = selectionOf(editable)
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
    // The fallback overlay is ALWAYS the opaque box (AGL-2486). It exists
    // only for an edit with no element to type into, and an element that is
    // not there cannot re-flow — so a see-through surface over it would be
    // exactly what the invariant forbids. In-place editing needs no surface
    // here at all: the leaf is the surface, and this component renders only
    // the toolbar.
    //
    // Built as plain records and cast ONCE, the way `tokenPillContainerSx`
    // is: MUI's `sx` union cannot absorb a computed spread and reports every
    // neighbouring key as the error instead.
    const surfaceSx: Record<string, unknown> = BOXED_SURFACE_SX
    const richSurfaceSx = {
      width: '100%',
      minHeight: live.height,
      boxSizing: 'border-box',
      font: 'inherit',
      ...surfaceSx,
      '& a': { pointerEvents: 'none' },
      ...tokenPillContainerSx,
    } as SystemStyleObject<Theme>
    const plainSurfaceSx = {
      width: '100%',
      minHeight: live.height,
      boxSizing: 'border-box',
      font: 'inherit',
      ...surfaceSx,
      // After the anchor's type, never from it: `pre-wrap` is what makes a
      // Shift+Enter newline visible while typing.
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      ...tokenPillContainerSx,
    } as SystemStyleObject<Theme>
    const minWidth = Math.max(live.width, 120)
    const TOOLBAR_CLEARANCE = 48
    const KEEP_VISIBLE = 80

    return (
      <Box
        ref={overlayRef}
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
        {/* The toolbar survives in-place editing — B / I / U, lists, link
            and the {} token control are the reason this editor exists at
            all, and it is chrome, not text, so it stays an overlay above
            the run being edited rather than inside it. */}
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
          {rich
            ? RICH_COMMANDS.filter(({ group }) =>
                commandGroups.has(group),
              ).map(({ command, label, title }) => (
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
              ))
            : null}
          {rich && commandGroups.has(Aglyn.RICH_TEXT_COMMANDS.LINK) ? (
            <IconButton
              size="small"
              title="Insert link"
              onMouseDown={keepFocus}
              onClick={handleLink}
              sx={{ width: 28, height: 28, fontSize: 13, borderRadius: 0.5 }}
            >
              {'\u{1F517}'}
            </IconButton>
          ) : null}
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
        {/* No surface at all when the leaf is the surface (AGL-2486). */}
        {inPlaceActive ? null : rich ? (
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
            sx={richSurfaceSx}
          />
        ) : (
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
            sx={plainSurfaceSx}
          />
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
