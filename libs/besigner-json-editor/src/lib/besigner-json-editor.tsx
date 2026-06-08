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
import { toJS } from 'mobx'
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

const Editor = dynamic(() => import('./components/monaco-editor'), {
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

export interface BesignerJsonEditorProps
  extends Omit<DialogProps, 'defaultValue'> {
  defaultValue?: CodeMirrorProps['defaultValue']
  onSave?: OnSave
  onClose?: OnClose
}

const BesignerJsonEditorRaw = forwardRef<any, BesignerJsonEditorProps>(
  (props, ref) => {
    const { onClose, onSave, defaultValue, open, ...rest } = props
    const [data, setData] = useState(
      JSON.stringify(defaultValue || {}, null, 2),
    )
    const [warnOpen, setWarnOpen] = useState(true)
    const closeWarn = useCallback(() => setWarnOpen(false), [])

    useEffect(() => {
      const parsed = JSON.stringify(defaultValue || {}, null, 2)
      if (parsed !== data) setData(parsed)
    }, [defaultValue, data])

    const value = useMemo(() => {
      let str = ''
      let parsed: iJSON = {}
      try {
        str = JSON.stringify(data, null, 2)
      } catch (e) {
        console.warn('Error occurred in JsonEditor during stringify', e)
      }
      try {
        parsed = JSON.parse(data)
      } catch (e) {
        console.warn('Error occurred in JsonEditor during parse', e)
      }
      return { str, parsed }
    }, [data])

    const handleChange = useCallback((value: any) => {
      setData(value)
    }, [])
    const handleClose = useCallback<OnClose>(
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

    console.log(
      'BesignerJsonEditor',
      Aglyn.canvas.toJSON(),
      JSON.stringify({ ...toJS(Aglyn.canvas.nestedNodes) }, null, 2),
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
        <DialogTitle>Raw JSON</DialogTitle>
        <DialogContent sx={{ position: 'relative', p: 0 }}>
          <When condition={open}>
            <If condition={warnOpen}>
              <Then>
                <Box
                  height="50vh"
                  sx={{
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
                  defaultValue={defaultValue}
                  value={JSON.stringify(value.parsed, null, 2)}
                  onChange={handleChange}
                />
              </Else>
            </If>
          </When>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={(e) => handleClose(e as any, 'cancelClick')}
          >
            {'Cancel'}
          </Button>
          <Button variant="contained" onClick={handleSave}>
            {'Save JSON'}
          </Button>
        </DialogActions>
      </Dialog>
    )
  },
)
BesignerJsonEditorRaw.displayName = 'BesignerJsonEditor'

export const BesignerJsonEditor = observer(BesignerJsonEditorRaw)

export default BesignerJsonEditor
