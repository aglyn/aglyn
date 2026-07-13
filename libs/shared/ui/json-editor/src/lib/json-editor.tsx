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
    const [data, setData] = useState(
      JSON.stringify(defaultValue || {}, null, 2),
    )
    const [warnOpen, setWarnOpen] = useState(true)
    const [saveError, setSaveError] = useState<string | null>(null)
    const closeWarn = useCallback(() => setWarnOpen(false), [])

    useEffect(() => {
      setData(prev => {
        const parsed = JSON.stringify(defaultValue || {}, null, 2)
        return prev === parsed ? prev : parsed
      })
    }, [defaultValue])

    const parsedValue = useMemo<iJSON>(() => {
      try {
        return JSON.parse(data)
      } catch (e) {
        console.warn('Error occurred in JsonEditor during parse', e)
        return {}
      }
    }, [data])

    const handleChange = useCallback((value: any) => {
      setData(value)
      setSaveError(null)
    }, [])
    const handleClose = useCallback<OnClose>(
      (event, reason) => {
        setSaveError(null)
        onClose && onClose(event, reason)
      },
      [onClose],
    )
    const handleSave = useCallback(
      (event: any) => {
        // Parse the raw text directly so malformed JSON blocks the save
        // with an error instead of silently saving `{}` (AGL-457).
        let value: iJSON
        try {
          value = JSON.parse(data)
        } catch (parseError: any) {
          setSaveError(parseError?.message ?? 'Invalid JSON')
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
        maxWidth="lg"
        fullWidth
        onClose={handleClose}
        // keepMounted
        {...rest}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent sx={{ position: 'relative', p: 0 }}>
          {description ? (
            <Box sx={{ px: 3, pb: 1, color: 'text.secondary' }}>
              {description}
            </Box>
          ) : null}
          {saveError ? (
            <Alert severity="error" sx={{ mx: 3, mb: 1 }}>
              {saveError}
            </Alert>
          ) : null}
          <When condition={open}>
            <If condition={warnOpen}>
              <Then>
                <Box
                  sx={{
                    height: "50vh",
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
                      <IconButton onClick={closeWarn} color="inherit">
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
                <Editor
                  height="50vh"
                  defaultValue={data}
                  value={JSON.stringify(parsedValue, null, 2)}
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
