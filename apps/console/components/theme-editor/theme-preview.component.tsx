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
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  Slider,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
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
          {/* The type ramp, not one sample: heading sizes and weights are
              the first thing a font change alters. */}
          <Typography variant="h4">{'Heading four'}</Typography>
          <Typography variant="h6">{'Heading six'}</Typography>
          <Typography variant="subtitle2" color="text.secondary">
            {'Subtitle two — secondary text'}
          </Typography>
          <Typography variant="body1">
            {'Body copy shows the font family, size, and text colors. '}
            <Link href="#" onClick={(e) => e.preventDefault()}>
              {'A link'}
            </Link>
            {' sits inline with the text.'}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            {'Caption — disabled text, the smallest size in the ramp.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {/* Every colour is named EXPLICITLY: this kit DEMOS the palette,
                so each control must show the slot it is labelled with. It is
                also the one place the rotation sweep had to be undone by
                hand — swept, the "Secondary" button would have rendered
                primary. */}
            <Button variant="contained" color="primary">
              {'Primary'}
            </Button>
            <Button variant="contained" color="secondary">
              {'Secondary'}
            </Button>
            <Button variant="contained" color="tertiary">
              {'Tertiary'}
            </Button>
            {/* Variant demos, so they keep the theme's default colour —
                pinning them to primary made them near-invisible in dark
                mode, where primary is a dark surface tone. */}
            <Button variant="outlined">{'Outlined'}</Button>
            <Button variant="text">{'Text'}</Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label="Primary" color="primary" />
            <Chip label="Secondary" color="secondary" />
            <Chip label="Tertiary" color="tertiary" />
            <Chip label="Outlined" variant="outlined" />
            <Switch defaultChecked />
            <Checkbox defaultChecked />
            <Radio checked />
          </Stack>
          {/* The status colours — error/warning/info/success each have a
              palette swatch, and until now only two of them appeared. */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip label="Error" color="error" />
            <Chip label="Warning" color="warning" />
            <Chip label="Info" color="info" />
            <Chip label="Success" color="success" />
          </Stack>
          <LinearProgress />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Avatar>{'A'}</Avatar>
            <Tooltip title="Tooltips use the theme too">
              <IconButton aria-label="tooltip demo">
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: '2px solid currentColor',
                  }}
                />
              </IconButton>
            </Tooltip>
            <Divider orientation="vertical" flexItem />
            <Typography variant="body2" color="text.secondary">
              {'Divider and avatar'}
            </Typography>
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
          <Stack direction="row" spacing={1}>
            <TextField label="Text field" size="small" fullWidth />
            <TextField
              label="Error"
              size="small"
              fullWidth
              error
              defaultValue="Invalid"
              helperText="Field errors use the error color."
            />
          </Stack>
          <Divider />
          <Alert severity="success">{'Success alert uses the palette.'}</Alert>
          <Alert severity="info">{'Info alert uses the palette.'}</Alert>
          <Alert severity="warning">{'Warning alert uses the palette.'}</Alert>
          <Alert severity="error">{'Error alert uses the palette.'}</Alert>

          {/* Selection and navigation surfaces — a theme change lands on
              these just as hard as on buttons, and none were represented. */}
          <Tabs value={0} sx={{ minHeight: 0 }}>
            <Tab label="Tab one" />
            <Tab label="Tab two" />
          </Tabs>
          <List dense disablePadding>
            <ListItemButton selected>
              <ListItemText
                primary="Selected list row"
                secondary="Selection uses the palette's action colors."
              />
            </ListItemButton>
            <ListItemButton>
              <ListItemText primary="Unselected list row" />
            </ListItemButton>
          </List>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Column'}</TableCell>
                <TableCell align="right">{'Value'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>{'Table rows show divider color'}</TableCell>
                <TableCell align="right">{'12'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{'and the paper background'}</TableCell>
                <TableCell align="right">{'34'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Accordion disableGutters>
            <AccordionSummary>
              <Typography variant="body2">{'Accordion summary'}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary">
                {'Expanded detail sits on the paper background.'}
              </Typography>
            </AccordionDetails>
          </Accordion>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Badge badgeContent={4} color="primary">
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: 1,
                  bgcolor: 'action.selected',
                }}
              />
            </Badge>
            <Slider
              size="small"
              defaultValue={40}
              aria-label="preview slider"
              sx={{ maxWidth: 160 }}
            />
            <CircularProgress size={20} />
          </Stack>
        </Stack>
      </Box>
    </ThemeProvider>
  )
}
ThemePreview.displayName = 'ThemePreview'

export default ThemePreview
