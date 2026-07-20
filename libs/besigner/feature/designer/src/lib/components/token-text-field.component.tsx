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

import {
  FormFieldGrid,
  type FormFieldGridProps,
  useFieldApi,
  validationError,
  type ExtendedFieldMeta,
} from '@aglyn/shared-ui-jsx-forms'
import { Box, TextField as MuiTextField } from '@mui/material'
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
  type ClipboardEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'

import type { BindingOption } from '../contexts/binding-picker-context'
import {
  readTokenSegmentsFromDom,
  selectionUnitsWithin,
  setSelectionUnits,
  TOKEN_PILL_ATTR,
} from '../utils/token-editable-dom'
import {
  hasUnmaterializedTokens,
  parseTokenSegments,
  serializeTokenSegments,
  spliceSegmentsAtUnits,
  textSegment,
  tokenSegment,
  resolveTokenLabel,
  type TokenLabelContext,
  type TokenSegment,
} from '../utils/token-segments'
import {
  InsertTokenAdornment,
  InsertTokenMenu,
} from './insert-token-menu.component'
import {
  TokenPill,
  TokenPillPopover,
  tokenPillContainerSx,
} from './token-pill.component'

/**
 * TokenTextField (AGL-586): the attributes-panel editor for token-capable
 * free-text attributes. A contentEditable surface styled as a MUI
 * TextField renders the value as plain text plus atomic {@link TokenPill}
 * badges — users see resolved NAMES while the serialized value (what
 * react-final-form holds and the node stores) keeps the raw id-based
 * `{{...}}` grammar. Typing edits text natively; pills are clickable to
 * replace or remove; the {x} adornment inserts at the caret (AGL-583).
 *
 * Model/DOM contract (mirrors the AGL-582 markdown editor): the segment
 * model is source of truth ONLY at version bumps. Between bumps the
 * browser owns the DOM — every `input` event silently syncs the model and
 * emits through `input.onChange`, so the AGL-567 debounced commit treats
 * pill edits exactly like keystrokes. Structural edits (insert/replace/
 * remove pill, paste, Enter-newline) re-render from the model and restore
 * the selection from unit offsets (text char = 1 unit, pill = 1 unit).
 *
 * Raw `{{...}}` typed by hand materializes into a pill on BLUR, not per
 * keystroke: materializing mid-typing would re-render under the caret and
 * fight the IME/undo stack, while on blur there is no caret to disturb.
 *
 * Undo: native browser undo survives for plain typing runs (no re-render
 * happens between keystrokes), but any pill materialization/insert/remove
 * re-renders the surface and truncates the native undo stack — the same
 * trade the markdown editor makes, without its custom history (the canvas
 * model keeps its own undo at commit granularity, AGL-567).
 */

/** Mapper key for the attributes form (editor-internal, never persisted). */
export const TOKEN_TEXT_FIELD_COMPONENT = 'aglyn-token-text-field'

/** Imperative surface ops the field chrome (menus) drives. */
export interface TokenEditableHandle {
  /** Current selection in unit offsets, or null when unfocused/outside. */
  captureSelection(): { start: number; end: number } | null
  /** Splices a token at the captured units (null capture appends). */
  insertToken(token: string, capture: { start: number; end: number } | null): void
  /** Swaps the nth token segment for a new token, in place. */
  replaceTokenAt(tokenIndex: number, token: string): void
  /** Deletes the nth token segment from the value. */
  removeTokenAt(tokenIndex: number): void
}

interface TokenEditableInputProps {
  /** Serialized field value (raw token grammar). */
  tokenValue: string
  onTokenValueChange: (next: string) => void
  multiline?: boolean
  labelContextRef: MutableRefObject<TokenLabelContext>
  handleRef: MutableRefObject<TokenEditableHandle | null>
  onPillClick: (anchor: HTMLElement, tokenIndex: number, token: string) => void
  // Injected by MUI InputBase:
  className?: string
  disabled?: boolean
  placeholder?: string
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

const renderSegments = (
  segments: TokenSegment[],
  labelContext: TokenLabelContext,
): ReactNode =>
  segments.map((segment, index) =>
    segment.type === 'token' ? (
      <TokenPill
        key={index}
        token={segment.token ?? segment.value}
        resolved={resolveTokenLabel(segment.token ?? segment.value, labelContext)}
      />
    ) : (
      segment.value
    ),
  )

/**
 * The contentEditable input rendered INSIDE MUI's InputBase (via
 * `inputComponent`), so the border, label notch, focus ring and disabled
 * styling all come from the real TextField machinery.
 */
const TokenEditableInput = memo(
  forwardRef<unknown, TokenEditableInputProps>(function TokenEditableInput(
    props,
    ref,
  ) {
    const {
      tokenValue,
      onTokenValueChange,
      multiline,
      labelContextRef,
      handleRef,
      onPillClick,
      className,
      disabled,
      placeholder,
      onFocus,
      onBlur,
      ...rest
    } = props
    const editableRef = useRef<HTMLDivElement | null>(null)
    const segmentsRef = useRef<TokenSegment[] | null>(null)
    if (segmentsRef.current == null) {
      segmentsRef.current = parseTokenSegments(tokenValue)
    }
    const lastEmittedRef = useRef(tokenValue)
    const pendingSelectionRef = useRef<{ start: number; end: number } | null>(
      null,
    )
    const [version, setVersion] = useState(0)

    // MUI focuses the input through `inputRef` on label clicks; `.value`
    // keeps InputBase's filled-state probe from reading `undefined`.
    useImperativeHandle(ref, () => ({
      focus: () => editableRef.current?.focus(),
      get value() {
        return lastEmittedRef.current
      },
      node: editableRef.current,
    }))

    // External value changes (form reset, AI rewrite, undo at canvas
    // level): anything this surface didn't just emit re-parses the model.
    useEffect(() => {
      if (tokenValue === lastEmittedRef.current) return
      segmentsRef.current = parseTokenSegments(tokenValue)
      lastEmittedRef.current = tokenValue
      pendingSelectionRef.current = null
      setVersion((current) => current + 1)
    }, [tokenValue])

    const emit = useCallback(
      (segments: TokenSegment[]) => {
        segmentsRef.current = segments
        let serialized = serializeTokenSegments(segments)
        // An emptied contentEditable leaves a stray <br> behind in most
        // browsers — a value that is exactly one newline means "empty".
        if (serialized === '\n') serialized = ''
        lastEmittedRef.current = serialized
        onTokenValueChange(serialized)
        return serialized
      },
      [onTokenValueChange],
    )

    /** Structural edit: re-render from the model + restore the caret. */
    const commitStructural = useCallback(
      (
        segments: TokenSegment[],
        selection: { start: number; end: number } | null,
      ) => {
        emit(segments)
        pendingSelectionRef.current = selection
        setVersion((current) => current + 1)
      },
      [emit],
    )

    useLayoutEffect(() => {
      const pending = pendingSelectionRef.current
      if (!pending || !editableRef.current) return
      pendingSelectionRef.current = null
      editableRef.current.focus()
      setSelectionUnits(editableRef.current, pending.start, pending.end)
    }, [version])

    // Plain typing: silent model sync — no re-render, the DOM is already
    // correct and the caret must not move (AGL-582 pattern).
    const handleInput = useCallback(
      (_event: FormEvent<HTMLDivElement>) => {
        if (!editableRef.current) return
        emit(readTokenSegmentsFromDom(editableRef.current))
      },
      [emit],
    )

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        // Single-line surfaces swallow Enter (a contentEditable would
        // otherwise fork the DOM into divs); multiline inserts a literal
        // newline as a model edit so the DOM stays flat text + pills.
        event.preventDefault()
        if (!multiline || !editableRef.current) return
        const current = readTokenSegmentsFromDom(editableRef.current)
        const selection = selectionUnitsWithin(editableRef.current)
        const { segments, caretUnit } = spliceSegmentsAtUnits(
          current,
          [textSegment('\n')],
          selection?.start ?? null,
          selection?.end ?? null,
        )
        commitStructural(segments, { start: caretUnit, end: caretUnit })
      },
      [commitStructural, multiline],
    )

    // Paste is plain-text only; pasted `{{...}}` materializes immediately
    // (the paste is already a structural, selection-restoring edit).
    const handlePaste = useCallback(
      (event: ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault()
        if (!editableRef.current) return
        const raw = event.clipboardData?.getData('text/plain') ?? ''
        if (!raw) return
        const text = multiline ? raw : raw.replace(/\s*\n+\s*/g, ' ')
        const current = readTokenSegmentsFromDom(editableRef.current)
        const selection = selectionUnitsWithin(editableRef.current)
        const { segments, caretUnit } = spliceSegmentsAtUnits(
          current,
          parseTokenSegments(text),
          selection?.start ?? null,
          selection?.end ?? null,
        )
        commitStructural(segments, { start: caretUnit, end: caretUnit })
      },
      [commitStructural, multiline],
    )

    // Raw `{{...}}` typed by hand becomes a pill when focus leaves — the
    // least caret-disruptive point (see the component doc block).
    const handleBlur = useCallback(
      (event: FocusEvent<HTMLDivElement>) => {
        onBlur?.(event)
        const segments = segmentsRef.current ?? []
        if (!hasUnmaterializedTokens(segments)) return
        commitStructural(
          parseTokenSegments(serializeTokenSegments(segments)),
          null,
        )
      },
      [commitStructural, onBlur],
    )

    // Pill clicks bubble to the surface (delegation keeps pills dumb).
    const handleClick = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        const pill = (event.target as HTMLElement).closest?.(
          `[${TOKEN_PILL_ATTR}]`,
        ) as HTMLElement | null
        if (!pill || !editableRef.current?.contains(pill)) return
        const pills = Array.from(
          editableRef.current.querySelectorAll(`[${TOKEN_PILL_ATTR}]`),
        )
        onPillClick(
          pill,
          pills.indexOf(pill),
          pill.getAttribute(TOKEN_PILL_ATTR) ?? '',
        )
      },
      [onPillClick],
    )

    /** Index (within segments) of the nth token segment. */
    const segmentIndexOfToken = (tokenIndex: number): number => {
      const segments = segmentsRef.current ?? []
      let seen = -1
      for (let index = 0; index < segments.length; index++) {
        if (segments[index]?.type === 'token' && ++seen === tokenIndex) {
          return index
        }
      }
      return -1
    }

    useImperativeHandle(
      handleRef,
      (): TokenEditableHandle => ({
        captureSelection: () =>
          editableRef.current ? selectionUnitsWithin(editableRef.current) : null,
        insertToken: (token, capture) => {
          const { segments, caretUnit } = spliceSegmentsAtUnits(
            segmentsRef.current ?? [],
            [tokenSegment(token)],
            capture?.start ?? null,
            capture?.end ?? null,
          )
          commitStructural(segments, { start: caretUnit, end: caretUnit })
        },
        replaceTokenAt: (tokenIndex, token) => {
          const index = segmentIndexOfToken(tokenIndex)
          if (index < 0) return
          const segments = [...(segmentsRef.current ?? [])]
          segments[index] = tokenSegment(token)
          commitStructural(segments, null)
        },
        removeTokenAt: (tokenIndex) => {
          const index = segmentIndexOfToken(tokenIndex)
          if (index < 0) return
          const segments = [...(segmentsRef.current ?? [])]
          segments.splice(index, 1)
          commitStructural(segments, null)
        },
      }),
      [commitStructural],
    )

    // Children are FROZEN per version (AGL-582 pattern): parent re-renders
    // (form state changes every keystroke) receive identical element
    // references, so React never touches the browser-managed DOM. A
    // version bump swaps the key, remounting cleanly from the model.
    // Label context is read at render time; renamed variables re-label on
    // the next structural edit rather than yanking the caret mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const children = useMemo(
      () => renderSegments(segmentsRef.current ?? [], labelContextRef.current),
      [version],
    )

    return (
      <Box
        key={version}
        ref={editableRef}
        component="div"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={Boolean(multiline)}
        data-placeholder={placeholder ?? ''}
        data-testid="token-text-field"
        className={className}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={onFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        {...rest}
        sx={{
          outline: 'none',
          width: '100%',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          minHeight: multiline ? '4.5em' : undefined,
          '&:empty::before': {
            content: 'attr(data-placeholder)',
            color: 'text.disabled',
          },
          ...tokenPillContainerSx,
        }}
      >
        {children}
      </Box>
    )
  }),
)

export interface TokenTextFieldProps {
  [key: string]: unknown
  placeholder?: string
  multiline?: boolean
  tokenOptions?: BindingOption[]
  tokenLabelContext?: TokenLabelContext
  FormFieldGridProps?: FormFieldGridProps
}

/**
 * The data-driven-forms field (registered as
 * {@link TOKEN_TEXT_FIELD_COMPONENT} in the attributes mapper). The
 * serialized string flows through react-final-form exactly like the plain
 * TextField it replaces — the AGL-567 debounced autosave sees ordinary
 * value changes and commits through the existing path.
 */
export const TokenTextField = (props: TokenTextFieldProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    placeholder,
    isRequired,
    label,
    helperText,
    description,
    validateOnMount,
    meta,
    multiline,
    tokenOptions = [],
    tokenLabelContext = {},
    FormFieldGridProps = {},
    // Swallowed: htmlInput props from legacy schemas don't apply to a
    // contentEditable surface.
    inputProps: _inputProps,
    ...rest
  } = useFieldApi(props as never) as Record<string, any>
  const invalid = validationError(meta as ExtendedFieldMeta, validateOnMount)

  const handleRef = useRef<TokenEditableHandle | null>(null)
  // Ref so the frozen editable children read fresh labels at render time
  // without re-rendering on every context identity change.
  const labelContextRef = useRef<TokenLabelContext>(tokenLabelContext)
  labelContextRef.current = tokenLabelContext

  const [insertMenu, setInsertMenu] = useState<{
    anchorEl: HTMLElement
    capture: { start: number; end: number } | null
    replaceIndex: number | null
  } | null>(null)
  const [pillMenu, setPillMenu] = useState<{
    anchorEl: HTMLElement
    tokenIndex: number
    token: string
  } | null>(null)

  const value =
    typeof input.value === 'string'
      ? input.value
      : input.value == null
        ? ''
        : String(input.value)

  const handleOpenInsert = useCallback((anchor: HTMLElement) => {
    // The adornment's mousedown is prevented (AGL-583), so the surface
    // selection is still live here — capture it in unit offsets.
    setInsertMenu({
      anchorEl: anchor,
      capture: handleRef.current?.captureSelection() ?? null,
      replaceIndex: null,
    })
  }, [])

  const handleInsert = useCallback(
    (token: string) => {
      if (insertMenu?.replaceIndex != null) {
        handleRef.current?.replaceTokenAt(insertMenu.replaceIndex, token)
      } else {
        handleRef.current?.insertToken(token, insertMenu?.capture ?? null)
      }
      setInsertMenu(null)
    },
    [insertMenu],
  )

  const handlePillClick = useCallback(
    (anchorEl: HTMLElement, tokenIndex: number, token: string) => {
      setPillMenu({ anchorEl, tokenIndex, token })
    },
    [],
  )

  const handlePillReplace = useCallback(() => {
    if (pillMenu) {
      setInsertMenu({
        anchorEl: pillMenu.anchorEl,
        capture: null,
        replaceIndex: pillMenu.tokenIndex,
      })
    }
    setPillMenu(null)
  }, [pillMenu])

  const handlePillRemove = useCallback(() => {
    if (pillMenu) handleRef.current?.removeTokenAt(pillMenu.tokenIndex)
    setPillMenu(null)
  }, [pillMenu])

  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <MuiTextField
        fullWidth
        error={!!invalid}
        helperText={
          invalid ||
          ((meta.touched || validateOnMount) && meta.warning) ||
          helperText ||
          description
        }
        disabled={isDisabled}
        label={label}
        required={isRequired}
        onFocus={input.onFocus}
        onBlur={input.onBlur}
        slotProps={{
          // The surface holds pills, not text MUI can measure — keep the
          // label out of the way permanently.
          inputLabel: { shrink: true },
          input: {
            readOnly: isReadOnly,
            inputComponent: TokenEditableInput as never,
            inputProps: {
              tokenValue: value,
              onTokenValueChange: input.onChange,
              multiline: Boolean(multiline),
              labelContextRef,
              handleRef,
              onPillClick: handlePillClick,
              placeholder,
              disabled: isDisabled || isReadOnly,
            },
            endAdornment: (
              <InsertTokenAdornment
                onOpen={(anchor) => handleOpenInsert(anchor)}
              />
            ),
          },
        }}
        {...rest}
      />
      <InsertTokenMenu
        anchorEl={insertMenu?.anchorEl ?? null}
        open={Boolean(insertMenu)}
        onClose={() => setInsertMenu(null)}
        options={tokenOptions}
        onInsert={handleInsert}
      />
      <TokenPillPopover
        anchorEl={pillMenu?.anchorEl ?? null}
        token={pillMenu?.token ?? ''}
        onClose={() => setPillMenu(null)}
        onReplace={handlePillReplace}
        onRemove={handlePillRemove}
      />
    </FormFieldGrid>
  )
}
TokenTextField.displayName = 'TokenTextField'

export default TokenTextField
