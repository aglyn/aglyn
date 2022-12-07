/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import type { iJSON } from '@aglyn/shared-data-types'
import MdiIcon from '@aglyn/shared-ui-mdi-jsx/components/mdi-icon'
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
import dynamic from 'next/dynamic'
import { forwardRef, useCallback, useMemo, useState } from 'react'
import type { CodeMirrorProps } from './code-mirror'

const CodeMirror = dynamic(
  async () => await import('./code-mirror').then((mod) => mod.CodeMirror),
  { ssr: false },
)

export interface BesignerJsonEditorProps
  extends Omit<DialogProps, 'defaultValue'> {
  defaultValue?: CodeMirrorProps['defaultValue']
  onSave?: {
    bivarianceHack(event: object, value: iJSON): void
  }['bivarianceHack']
  onClose?: {
    bivarianceHack(
      event: {},
      reason: 'backdropClick' | 'escapeKeyDown' | 'saveClick' | 'cancelClick',
    ): void
  }['bivarianceHack']
}

const BesignerJsonEditor = forwardRef<any, BesignerJsonEditorProps>(
  (props, ref) => {
    const { onClose, onSave, defaultValue, open, ...rest } = props
    const [data, setData] = useState(defaultValue)
    const [warnOpen, setWarnOpen] = useState(true)
    const closeWarn = useCallback(() => setWarnOpen(false), [])

    const value = useMemo(() => JSON.stringify(defaultValue, null, 2), [data])

    const handleChange = useCallback((value: any) => {
      try {
        const json = JSON.parse(value)
        setData(json)
      } catch (e) {
        console.warn(e)
      }
    }, [])
    const handleClose: BesignerJsonEditorProps['onClose'] = useCallback(
      (event, reason) => {
        onClose && onClose(event, reason)
      },
      [onClose],
    )
    const handleSave = useCallback(
      (event: any) => {
        onSave && onSave(event, data)
        handleClose(event, 'saveClick')
      },
      [onSave, handleClose, data],
    )

    return (
      <Dialog
        ref={ref}
        open={open}
        maxWidth="lg"
        fullWidth
        onClose={handleClose}
        {...rest}
      >
        <DialogTitle>Raw JSON</DialogTitle>
        <DialogContent sx={{ position: 'relative', p: 0 }}>
          {open && <CodeMirror value={value} onChange={handleChange} />}
          {warnOpen && (
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                bgcolor: 'action.disabled',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(2px)',
                p: { xs: 2, sm: 3 },
              }}
            >
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
                Using the raw json editor is highly discouraged and should only
                be used by individuals who understand the consequences. Changes
                may potentially result in undesired outcomes which are{' '}
                <strong>destructive and irreversible</strong>.
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={(e) => handleClose(e, 'cancelClick')}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave}>
            {'Save JSON'}
          </Button>
        </DialogActions>
      </Dialog>
    )
  },
)
BesignerJsonEditor.displayName = 'BesignerJsonEditor'

export { BesignerJsonEditor }
export default BesignerJsonEditor
