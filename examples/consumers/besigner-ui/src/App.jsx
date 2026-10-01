import {
  ViewportCanvasComponent,
  ViewportRootComponent,
  WorkspaceEditorComponent,
  withBesignerContext,
} from '@aglyn/besigner-ui'
import { consoleThemeDark, consoleThemeLight, ThemeCssVarProvider } from '@aglyn/shared-ui-theme'
import { Button, CssBaseline, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { currentDocument, loadDocument } from './document.js'
import { clearSavedDocument, saveDocument } from './storage.js'

// The editor reads its colors, spacing and shadows from Aglyn's console
// theme, served as CSS variables, so it is mounted inside that theme.
const THEME = { light: consoleThemeLight, dark: consoleThemeDark }

function Toolbar() {
  const [status, setStatus] = useState('')
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
        Besigner UI example
      </Typography>
      <Typography variant="body2" color="text.secondary" role="status">
        {status}
      </Typography>
      <Button
        onClick={() => {
          saveDocument(currentDocument())
          setStatus('Saved')
        }}
      >
        Save
      </Button>
      <Button
        onClick={() => {
          clearSavedDocument()
          loadDocument()
          setStatus('Reset to the sample')
        }}
      >
        Reset
      </Button>
    </Stack>
  )
}

/**
 * The editor as Aglyn's console composes it: the workspace with its element
 * tree and inspector, the viewport, and the canvas inside it.
 * `withBesignerContext` supplies the editor's state, drag and drop and
 * clipboard to everything below it.
 */
const Editor = withBesignerContext(function Editor() {
  return (
    <Stack sx={{ height: '100vh' }}>
      <Toolbar />
      <Stack sx={{ flexGrow: 1, minHeight: 0 }}>
        <WorkspaceEditorComponent>
          <ViewportRootComponent>
            <ViewportCanvasComponent />
          </ViewportRootComponent>
        </WorkspaceEditorComponent>
      </Stack>
    </Stack>
  )
})

export function App() {
  return (
    <ThemeCssVarProvider theme={THEME}>
      <CssBaseline />
      <Editor />
    </ThemeCssVarProvider>
  )
}
