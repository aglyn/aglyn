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

import type * as Aglyn from '@aglyn/aglyn'
import { RICH_TEXT_COMMANDS } from '@aglyn/aglyn'
import {
  FormFieldGrid,
  type ExtendedFieldMeta,
  useFieldApi,
  useFormApi,
  validationError,
} from '@aglyn/shared-ui-jsx-forms'
import {
  Box,
  IconButton,
  Paper,
  TextField as MuiTextField,
} from '@mui/material'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
} from 'react'

import type { BindingOption } from '../contexts/binding-picker-context'
import { readAttributeFieldValue } from '../utils/attribute-field-value'
import { RICH_COMMANDS } from '../utils/rich-text-commands'
import {
  richTextToPlain,
  sanitizeRichText,
  textToHtml,
} from '../utils/sanitize-rich-text'
import {
  createTokenPillElement,
  materializeTokenPillsInElement,
  replacePillsWithTokenText,
  TOKEN_PILL_ATTR,
} from '../utils/token-editable-dom'
import { resolveTokenLabel, type TokenLabelContext } from '../utils/token-segments'
import {
  InsertTokenAdornment,
  InsertTokenMenu,
} from './insert-token-menu.component'
import { TokenPillPopover, tokenPillContainerSx } from './token-pill.component'

/** Mapper key for the attributes form (editor-internal, never persisted). */
export const RICH_TEXT_FIELD_COMPONENT = 'aglyn-rich-text-field'

/**
 * How a text field edits formatted text: where the markup lives beside the
 * plain value the field is named for, and which formatting the element
 * allows.
 */
export interface RichTextFieldSpec {
  /** Form path of the markup — `html` for an element, `propHtml.<name>` for an instance's prop. */
  markupName: string
  /** The formatting groups the element allows (AGL-2557). */
  commands: readonly Aglyn.RICH_TEXT_COMMANDS[]
}

/** The two halves one edit writes, read off the surface together. */
export interface RichTextReading {
  /** The plain reading — what `children` (or the prop value) stores. */
  plain: string
  /** The sanitized markup, or `undefined` when nothing is formatted. */
  markup: string | undefined
}

/**
 * Reads formatted text off an editable surface the way the canvas editor
 * commits it, so the two cannot store the same edit differently.
 *
 * Pills go back to raw tokens BEFORE sanitizing, on a clone: the sanitizer
 * strips attributes, and pill labels must never reach storage. Markup with
 * no tag in it is no markup at all — plain text is stored plain, with the
 * `html` key absent rather than empty (AGL-2486).
 */
export function readRichTextSurface(
  surface: HTMLElement,
  options: { phrasingOnly: boolean },
): RichTextReading {
  const clone = surface.cloneNode(true) as HTMLElement
  replacePillsWithTokenText(clone)
  const sanitized = sanitizeRichText(clone.innerHTML, options)
  const plain = richTextToPlain(sanitized)
  return { plain, markup: /<[a-z]/i.test(sanitized) ? sanitized : undefined }
}

/** Imperative surface ops the field chrome drives. */
interface RichEditableHandle {
  element(): HTMLDivElement | null
}

interface RichEditableInputProps {
  /** The markup to show, or `''` to show `plain`. */
  markup: string
  plain: string
  /** What this surface itself last wrote, so its own echo does not rebuild it. */
  lastWrittenRef: MutableRefObject<RichTextReading | null>
  labelContextRef: MutableRefObject<TokenLabelContext>
  handleRef: MutableRefObject<RichEditableHandle | null>
  onEdit: () => void
  onPillClick: (pill: HTMLElement) => void
  phrasingOnly: boolean
  // Injected by MUI InputBase:
  className?: string
  disabled?: boolean
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/**
 * The contentEditable surface, mounted as the TextField's input so the label,
 * outline and helper text are MUI's own.
 *
 * The browser owns the DOM between edits, as it does in the token field and
 * on the canvas: a rebuild under the caret would lose it. The surface is
 * rebuilt from the value only when the value changed for a reason other than
 * this surface — another element selected, the canvas editor committing, an
 * undo — which `lastWrittenRef` tells apart.
 */
const RichEditableInput = forwardRef<HTMLDivElement, RichEditableInputProps>(
  function RichEditableInput(props, ref) {
    const {
      markup,
      plain,
      lastWrittenRef,
      labelContextRef,
      handleRef,
      onEdit,
      onPillClick,
      phrasingOnly,
      className,
      disabled,
      onFocus,
      onBlur,
      'aria-invalid': ariaInvalid,
      'aria-describedby': ariaDescribedBy,
    } = props
    const surfaceRef = useRef<HTMLDivElement>(null)
    useImperativeHandle(ref, () => surfaceRef.current as HTMLDivElement)
    useImperativeHandle(handleRef, () => ({
      element: () => surfaceRef.current,
    }))

    useLayoutEffect(() => {
      const surface = surfaceRef.current
      if (!surface) return
      const written = lastWrittenRef.current
      if (
        written &&
        written.plain === plain &&
        (written.markup ?? '') === markup
      ) {
        return
      }
      surface.innerHTML = markup || textToHtml(plain)
      materializeTokenPillsInElement(surface, (token) =>
        resolveTokenLabel(token, labelContextRef.current),
      )
      lastWrittenRef.current = null
    }, [markup, plain, lastWrittenRef, labelContextRef])

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        // A control's label holds phrasing content only, and a browser forks
        // a contentEditable into `<div>`s on Enter — so Enter is a `<br>`
        // there, which is phrasing content, as Shift+Enter is everywhere.
        if (event.key === 'Enter' && (phrasingOnly || event.shiftKey)) {
          event.preventDefault()
          document.execCommand('insertLineBreak')
        }
      },
      [phrasingOnly],
    )

    const handleClick = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        const pill = (event.target as HTMLElement | null)?.closest?.(
          `[${TOKEN_PILL_ATTR}]`,
        ) as HTMLElement | null
        if (pill) onPillClick(pill)
      },
      [onPillClick],
    )

    return (
      <Box
        ref={surfaceRef}
        className={className}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onInput={onEdit}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onFocus={onFocus}
        onBlur={onBlur}
        sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          outline: 'none',
          '& a': { color: 'primary.main', pointerEvents: 'none' },
          '& ul, & ol': { my: 0.5, pl: 3 },
          ...tokenPillContainerSx,
        }}
      />
    )
  },
)

/**
 * The Text field of an element that takes formatted text (AGL-2486): the
 * text drawn WITH its formatting, and the same B / I / U, list and link tools
 * the canvas editor has, shown while the field is focused.
 *
 * It replaced a read-only field. Formatted text used to be the canvas's
 * alone, because a plain field could only edit it by silently throwing the
 * formatting away; a field that edits the markup itself has no such
 * trade-off, so the two places that show the text can both edit it.
 *
 * Every edit writes both halves through the form, the plain reading under the
 * field's own name and the markup under `markupName`, so the debounced commit
 * stores them together exactly as the canvas editor does.
 */
export const RichTextField = (props: Record<string, unknown>) => {
  const {
    input,
    meta,
    label,
    helperText,
    description,
    isReadOnly,
    isDisabled,
    isRequired,
    validateOnMount,
    tokenOptions = [],
    tokenLabelContext = {},
    markupName,
    richCommands = [],
    FormFieldGridProps = {},
    // Not for a contentEditable surface: swallowed rather than spread.
    inputProps: _inputProps,
    multiline: _multiline,
    placeholder: _placeholder,
    ...rest
  } = useFieldApi(props as never) as Record<string, any>
  const formApi = useFormApi()
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  const values = formApi.getState().values as Record<string, unknown>
  const stored = readAttributeFieldValue(values, markupName as string)
  const markup = typeof stored === 'string' ? stored : ''
  const plain =
    typeof input.value === 'string'
      ? input.value
      : input.value == null
        ? ''
        : String(input.value)

  const groups = new Set(richCommands as Aglyn.RICH_TEXT_COMMANDS[])
  // Derived exactly as the canvas editor derives it: a component allowing
  // neither a list nor a link is a control whose label holds phrasing only.
  const phrasingOnly =
    !groups.has(RICH_TEXT_COMMANDS.LIST) && !groups.has(RICH_TEXT_COMMANDS.LINK)

  const handleRef = useRef<RichEditableHandle | null>(null)
  const lastWrittenRef = useRef<RichTextReading | null>(null)
  const labelContextRef = useRef<TokenLabelContext>(tokenLabelContext)
  labelContextRef.current = tokenLabelContext
  const [focused, setFocused] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const [insertAnchor, setInsertAnchor] = useState<HTMLElement | null>(null)
  const [pillMenu, setPillMenu] = useState<HTMLElement | null>(null)
  const replacePillRef = useRef<HTMLElement | null>(null)

  const handleEdit = useCallback(() => {
    const surface = handleRef.current?.element()
    if (!surface) return
    const reading = readRichTextSurface(surface, { phrasingOnly })
    lastWrittenRef.current = reading
    formApi.change(markupName as string, reading.markup)
    input.onChange(reading.plain)
  }, [formApi, input, markupName, phrasingOnly])

  // Keep the caret where it was while a tool is clicked.
  const keepFocus = useCallback((event: MouseEvent) => {
    event.preventDefault()
  }, [])

  const exec = useCallback(
    (command: string, value?: string) => () => {
      handleRef.current?.element()?.focus()
      document.execCommand(command, false, value)
      // `execCommand` raises `input` in some engines and not others.
      handleEdit()
    },
    [handleEdit],
  )

  const handleLink = useCallback(() => {
    const url = window.prompt('Link URL (https://…)')
    if (url) exec('createLink', url)()
  }, [exec])

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      setFocused(true)
      input.onFocus?.(event)
    },
    [input],
  )
  const handleBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      // The toolbar and the token menus keep focus off the surface while in
      // use; leaving for them is not leaving the field.
      const next = event.relatedTarget as Node | null
      if (next && fieldRef.current?.contains(next)) return
      setFocused(false)
      input.onBlur?.(event)
    },
    [input],
  )

  const handleOpenInsert = useCallback((anchor: HTMLElement) => {
    const surface = handleRef.current?.element()
    const selection = surface?.ownerDocument.getSelection()
    const range =
      selection && selection.rangeCount ? selection.getRangeAt(0) : null
    savedRangeRef.current =
      range && surface?.contains(range.startContainer) ? range.cloneRange() : null
    replacePillRef.current = null
    setInsertAnchor(anchor)
  }, [])

  const handleInsert = useCallback(
    (token: string) => {
      const surface = handleRef.current?.element()
      setInsertAnchor(null)
      if (!surface) return
      const pill = createTokenPillElement(
        surface.ownerDocument,
        token,
        resolveTokenLabel(token, labelContextRef.current),
      )
      const replacing = replacePillRef.current
      const range = savedRangeRef.current
      if (replacing && surface.contains(replacing)) {
        replacing.replaceWith(pill)
      } else if (range) {
        range.deleteContents()
        range.insertNode(pill)
      } else {
        surface.appendChild(pill)
      }
      replacePillRef.current = null
      savedRangeRef.current = null
      surface.focus()
      handleEdit()
    },
    [handleEdit],
  )

  const handlePillReplace = useCallback(() => {
    replacePillRef.current = pillMenu
    setInsertAnchor(pillMenu)
    setPillMenu(null)
  }, [pillMenu])

  const handlePillRemove = useCallback(() => {
    pillMenu?.remove()
    setPillMenu(null)
    handleEdit()
  }, [pillMenu, handleEdit])

  const editable = !isReadOnly && !isDisabled

  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <Box ref={fieldRef} sx={{ position: 'relative' }}>
        {/* The canvas editor's tools, above the field while it is in use.
            Same list, same allowance, same commands — one editor, two
            places to open it. */}
        {focused && editable ? (
          <Paper
            elevation={2}
            data-aglyn="rich-text-field-toolbar"
            sx={{
              display: 'flex',
              gap: 0.25,
              alignItems: 'center',
              px: 0.5,
              py: 0.25,
              mb: 0.75,
              width: 'fit-content',
            }}
          >
            {RICH_COMMANDS.filter(({ group }) => groups.has(group)).map(
              ({ command, label: glyph, title }) => (
                <IconButton
                  key={command}
                  size="small"
                  title={title}
                  aria-label={title}
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
                  {glyph}
                </IconButton>
              ),
            )}
            {groups.has(RICH_TEXT_COMMANDS.LINK) ? (
              <IconButton
                size="small"
                title="Insert link"
                aria-label="Insert link"
                onMouseDown={keepFocus}
                onClick={handleLink}
                sx={{ width: 28, height: 28, fontSize: 13, borderRadius: 0.5 }}
              >
                {'\u{1F517}'}
              </IconButton>
            ) : null}
          </Paper>
        ) : null}
        <MuiTextField
          fullWidth
          error={!!invalid}
          helperText={invalid || helperText || description}
          disabled={Boolean(isDisabled)}
          label={label}
          required={isRequired}
          slotProps={{
            inputLabel: { shrink: true },
            input: {
              readOnly: isReadOnly,
              sx: {
                height: 'auto',
                alignItems: 'flex-start',
                '& .MuiInputBase-input': {
                  height: 'auto',
                  maxHeight: '12em',
                  overflowY: 'auto',
                },
                '& .MuiInputAdornment-root': { mt: '4px' },
              },
              inputComponent: RichEditableInput as never,
              inputProps: {
                markup,
                plain,
                lastWrittenRef,
                labelContextRef,
                handleRef,
                onEdit: handleEdit,
                onPillClick: setPillMenu,
                phrasingOnly,
                disabled: !editable,
                onFocus: handleFocus,
                onBlur: handleBlur,
              },
              endAdornment: editable ? (
                <InsertTokenAdornment
                  onOpen={(anchor) => handleOpenInsert(anchor)}
                />
              ) : undefined,
            },
          }}
          {...rest}
        />
      </Box>
      <InsertTokenMenu
        anchorEl={insertAnchor}
        open={Boolean(insertAnchor)}
        onClose={() => setInsertAnchor(null)}
        options={tokenOptions as BindingOption[]}
        onInsert={handleInsert}
      />
      <TokenPillPopover
        anchorEl={pillMenu}
        token={pillMenu?.getAttribute(TOKEN_PILL_ATTR) ?? ''}
        onClose={() => setPillMenu(null)}
        onReplace={handlePillReplace}
        onRemove={handlePillRemove}
      />
    </FormFieldGrid>
  )
}
RichTextField.displayName = 'RichTextField'

export default RichTextField
