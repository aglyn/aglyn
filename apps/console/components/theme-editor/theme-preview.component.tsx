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
  createResponsiveTheme,
  hostThemeToThemeOptions,
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
    return createResponsiveTheme({
      themeOptions: hostThemeToThemeOptions(theme, scheme),
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
            <Button variant="contained">{'Primary'}</Button>
            <Button variant="contained" color="secondary">
              {'Secondary'}
            </Button>
            <Button variant="outlined">{'Outlined'}</Button>
            <Button variant="text">{'Text'}</Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label="Chip" color="primary" />
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
