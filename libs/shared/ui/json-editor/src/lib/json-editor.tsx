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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  type DialogProps,
  DialogTitle,
  IconButton,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import {
  forwardRef,
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Else, If, Then, When } from 'react-if'
import type { CodeMirrorProps } from './components/code-mirror-editor'
import type { MonacoEditorProps } from './components/monaco-editor'

const Editor = dynamic<MonacoEditorProps>(() => import('./components/monaco-editor'), {
  ssr: false,
})

type OnClose = {
  bivarianceHack(
    event: any,
    reason: 'backdropClick' | 'escapeKeyDown' | 'saveClick' | 'cancelClick',
  ): void
}['bivarianceHack']
type OnSave = {
  bivarianceHack(event: SyntheticEvent<any, any>, value: iJSON): void
}['bivarianceHack']

export interface JsonEditorProps
  extends Omit<DialogProps, 'defaultValue' | 'title'> {
  defaultValue?: CodeMirrorProps['defaultValue']
  onSave?: OnSave
  onClose?: OnClose
  /** Dialog title; defaults to the classic "Raw JSON". */
  title?: React.ReactNode
  /** Optional hint rendered under the title (e.g. subtree scope note). */
  description?: React.ReactNode
  /**
   * Pre-save check (AGL-457): return an error message to keep the dialog
   * open and surface it instead of saving.
   */
  validate?: (value: iJSON) => string | null | undefined
}

const JsonEditorRaw = forwardRef<any, JsonEditorProps>(
  (props, ref) => {
    const {
      onClose,
      onSave,
      defaultValue,
      open,
      title = 'Raw JSON',
      description,
      validate,
      ...rest
    } = props
    /** The stored document, as the text a buffer is seeded from. */
    const documentText = useMemo(
      () => JSON.stringify(defaultValue || {}, null, 2),
      [defaultValue],
    )
    const [data, setData] = useState(documentText)
    const [warnOpen, setWarnOpen] = useState(true)
    const [saveError, setSaveError] = useState<string | null>(null)
    const closeWarn = useCallback(() => setWarnOpen(false), [])

    /**
     * The document text this buffer was seeded from, or `null` while closed.
     *
     * `data !== seededFrom.current` is therefore "the author has typed
     * something that is not yet saved", which is the one question both the
     * re-seed below and the backdrop guard need answered.
     */
    const seededFrom = useRef<string | null>(null)

    /**
     * Seed the buffer, and NEVER re-seed one that has been typed into
     * (AGL-2486 item 17).
     *
     * `defaultValue` is `Aglyn.canvas.nestedNodes` at every call site — a
     * freshly built object, from a MobX store this dialog re-renders with.
     * The previous version compared the incoming document against the BUFFER
     * and re-seeded whenever they differed, which is true by definition the
     * moment the author types: any canvas change, autosave or co-edit echo
     * then replaced their work in progress with the stored document.
     *
     * Re-seeding a PRISTINE buffer is still right — nothing is lost, and the
     * dialog should not show a document the canvas has moved past.
     */
    useEffect(() => {
      if (!open) {
        // A closed dialog holds nothing: the next open seeds from whatever
        // the document says then, rather than from a buffer walked away from.
        seededFrom.current = null
        return
      }
      setData(prev => {
        if (seededFrom.current !== null && prev !== seededFrom.current) {
          return prev
        }
        seededFrom.current = documentText
        return documentText
      })
    }, [documentText, open])

    /**
     * Why the buffer does not parse, or `null` when it does.
     *
     * Surfaced as a live, NON-destructive notice: a half-written document is
     * allowed to be invalid, so the only thing to do about it is say so.
     */
    const parseError = useMemo<string | null>(() => {
      if (!open) return null
      try {
        JSON.parse(data)
        return null
      } catch (e: any) {
        return e?.message ?? 'Invalid JSON'
      }
    }, [data, open])

    const handleChange = useCallback((value: any) => {
      setData(value)
      setSaveError(null)
    }, [])
    const handleClose = useCallback<OnClose>(
      (event, reason) => {
        // A stray click outside a 95vw dialog must not destroy an unsaved
        // buffer. Cancel and Escape are deliberate acts and still close.
        if (reason === 'backdropClick' && data !== seededFrom.current) return
        setSaveError(null)
        onClose && onClose(event, reason)
      },
      [onClose, data],
    )
    const handleSave = useCallback(
      (event: any) => {
        // Parse the raw text directly so malformed JSON blocks the save
        // with an error instead of silently saving `{}` (AGL-457).
        let value: iJSON
        try {
          value = JSON.parse(data)
        } catch (error: any) {
          setSaveError(error?.message ?? 'Invalid JSON')
          return
        }
        const problem = validate?.(value)
        if (problem) {
          setSaveError(problem)
          return
        }
        onSave && onSave(event, value)
        handleClose(event, 'saveClick')
      },
      [onSave, handleClose, data, validate],
    )

    return (
      <Dialog
        ref={ref}
        open={open}
        // A raw-JSON editor is unusable in a small box — component
        // overrides run to hundreds of lines. Fill most of the viewport in
        // BOTH axes; `rest` spreads after, so a caller can still override.
        maxWidth={false}
        fullWidth
        slotProps={{
          paper: {
            sx: {
              width: '95vw',
              maxWidth: 'none',
              height: '92vh',
              maxHeight: 'none',
            },
          },
        }}
        onClose={handleClose}
        // keepMounted
        {...rest}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent
          sx={{
            position: 'relative',
            p: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {description ? (
            <Box sx={{ px: 3, pb: 1, color: 'text.secondary' }}>
              {description}
            </Box>
          ) : null}
          {saveError ? (
            <Alert severity="error" sx={{ mx: 3, mb: 1 }}>
              {saveError}
            </Alert>
          ) : parseError ? (
            <Alert severity="warning" sx={{ mx: 3, mb: 1 }}>
              {'Not valid JSON yet — '}
              {parseError}
              {'. Your text is kept exactly as typed; Save JSON works again '}
              {'once it parses.'}
            </Alert>
          ) : null}
          <When condition={open}>
            <If condition={warnOpen}>
              <Then>
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    position: 'relative',
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    bgcolor: 'action.disabled',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(2px)',
                    p: { xs: 2, sm: 3 }
                  }}>
                  <Alert
                    severity="warning"
                    sx={{
                      maxWidth: 620,
                    }}
                    action={
                      <IconButton
                        onClick={closeWarn}
                        color="inherit"
                        aria-label="Dismiss this warning"
                        title="Dismiss this warning"
                      >
                        <MdiIcon path={ICON_VARIANT_CLOSE.path} />
                      </IconButton>
                    }
                  >
                    <AlertTitle>Warning: Advanced Feature Ahead!</AlertTitle>
                    Using the raw json editor is highly discouraged and should
                    only be used by individuals who understand the consequences.
                    Changes may potentially result in undesired outcomes which
                    are <strong>destructive and irreversible</strong>.
                  </Alert>
                </Box>
              </Then>
              <Else>
                {/*
                  `value` is the author's buffer VERBATIM, and nothing else
                  (AGL-2486 item 17).

                  It used to be `JSON.stringify(JSON.parse(data) ?? {})`, whose
                  parse fell back to `{}`. `@monaco-editor/react` treats `value`
                  as authoritative — on every change it runs
                  `executeEdits(fullModelRange, value)` — so the first keystroke
                  that left the buffer transiently unparseable replaced the
                  whole document on screen with `{}`. A comma does that, which
                  is exactly how it was reported. Worse, that overwrite is made
                  with `onChange` suppressed, so `data` kept the text the editor
                  no longer showed and there was nothing to recover from.

                  Feeding the buffer back unchanged means the prop always equals
                  `editor.getValue()`, so the effect's `value !==` guard never
                  fires from typing and no keystroke can rewrite the document.
                  It also stops the buffer being re-indented under the cursor
                  whenever the author's valid text was not already 2-space
                  pretty-printed.
                */}
                <Editor
                  height="100%"
                  defaultValue={documentText}
                  value={data}
                  onChange={handleChange}
                />
              </Else>
            </If>
          </When>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={(e) => handleClose(e, 'cancelClick')}
          >
            {'Cancel'}
          </Button>
          <Button variant="contained" onClick={handleSave}>
            {'Save JSON'}
          </Button>
        </DialogActions>
      </Dialog>
    );
  },
)
JsonEditorRaw.displayName = 'JsonEditor'

export const JsonEditor = observer(JsonEditorRaw)

export default JsonEditor
