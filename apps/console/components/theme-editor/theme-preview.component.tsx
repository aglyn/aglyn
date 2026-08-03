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

import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import {
  consoleOptions,
  consoleOptionsDark,
  createResponsiveTheme,
  hostThemeToThemeOptions,
  mergeThemeOptions,
  ThemeProvider,
} from '@aglyn/shared-ui-theme'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'

export interface ThemePreviewProps {
  theme: HostTheme
  scheme: HostThemeScheme
}

/**
 * Sample kit of MUI components rendered under the draft theme so every
 * control change is visible immediately without saving.
 */
export function ThemePreview(props: ThemePreviewProps) {
  const { theme, scheme } = props

  const previewTheme = useMemo(() => {
    // Preview what the SITE will render, which layers the host's overrides
    // onto the brand theme (AGL-1180). Building from the host document alone
    // showed MUI's stock blue/purple for every slot left on "Default", so an
    // untouched host previewed in colours it would never actually serve.
    return createResponsiveTheme({
      themeOptions: mergeThemeOptions(
        scheme === 'dark' ? consoleOptionsDark : consoleOptions,
        hostThemeToThemeOptions(theme, scheme),
      ),
    })
  }, [theme, scheme])

  return (
    <ThemeProvider theme={previewTheme}>
      <Box
        sx={{
          backgroundColor: 'background.default',
          color: 'text.primary',
          borderRadius: 1,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <AppBar position="static" color="primary" enableColorOnDark>
          <Toolbar variant="dense">
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              {'Site preview'}
            </Typography>
            <Button color="inherit">{'Action'}</Button>
          </Toolbar>
        </AppBar>
        <Stack spacing={2} sx={{ p: 2 }}>
          <Typography variant="h4">{'Heading four'}</Typography>
          <Typography variant="body1">
            {'Body copy shows the font family, size, and text colors. '}
            <Link href="#" onClick={(e) => e.preventDefault()}>
              {'A link'}
            </Link>
            {' sits inline with the text.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {/* Every colour is named EXPLICITLY (AGL-1180). The theme sets
                MuiButton.defaultProps.color = 'secondary', so the unlabelled
                button that used to sit here rendered secondary under the
                label "Primary" — two identical blue buttons, and no way to
                tell which swatch you had just changed. */}
            <Button variant="contained" color="primary">
              {'Primary'}
            </Button>
            <Button variant="contained" color="secondary">
              {'Secondary'}
            </Button>
            <Button variant="contained" color="tertiary">
              {'Tertiary'}
            </Button>
            <Button variant="outlined" color="primary">
              {'Outlined'}
            </Button>
            <Button variant="text" color="primary">
              {'Text'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label="Primary" color="primary" />
            <Chip label="Secondary" color="secondary" />
            <Chip label="Tertiary" color="tertiary" />
            <Chip label="Outlined" variant="outlined" />
            <Switch defaultChecked />
          </Stack>
          <Card>
            <CardContent>
              <Typography variant="h6">{'Card title'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {'Cards pick up the paper background and border radius.'}
              </Typography>
            </CardContent>
          </Card>
          {/* Surface had a swatch in the palette but nothing rendering it,
              so the one control with no feedback was the one people were
              most likely to get wrong. */}
          <Box
            sx={{
              backgroundColor: 'surface.main',
              color: 'surface.contrastText',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              p: 1.5,
            }}
          >
            <Typography variant="subtitle2">{'Surface'}</Typography>
            <Typography variant="body2">
              {'Raised panels and toolbars sit on the surface color.'}
            </Typography>
          </Box>
          <TextField label="Text field" size="small" fullWidth />
          <Divider />
          <Alert severity="success">{'Success alert uses the palette.'}</Alert>
          <Alert severity="error">{'Error alert uses the palette.'}</Alert>
        </Stack>
      </Box>
    </ThemeProvider>
  )
}
ThemePreview.displayName = 'ThemePreview'

export default ThemePreview
