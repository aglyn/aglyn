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
  useTheme,
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

/**
 * Every typography variant the theme defines, largest first.
 *
 * `theme.typography` holds scalars (`fontFamily`, the `fontWeight*` tokens,
 * `pxToRem`) alongside the variants; a variant is the entries that are OBJECTS
 * carrying a `fontSize`. Sorting by resolved size makes it read as a ramp
 * rather than as whatever order the theme object happened to be written in.
 */
function TypeRamp() {
  const theme = useTheme()
  const variants = useMemo(() => {
    const t = theme.typography as unknown as Record<string, any>
    // Rank by the size the variant reaches at its WIDEST breakpoint, not by
    // its base. `responsiveFontSizes` scales a variant down from the desktop
    // figure, and it scales the big ones hardest — so h2 (2.5rem desktop)
    // carries a SMALLER base than h3 (2rem, barely scaled) and a base-order
    // sort prints h1, h3, h2. Reading the ceiling puts the ramp back in the
    // order the ramp actually is.
    const ceiling = (v: Record<string, any>) => {
      const sizes = [v.fontSize, ...Object.keys(v)
        .filter((k) => k.startsWith('@media'))
        .map((k) => v[k]?.fontSize)]
      return Math.max(
        ...sizes.map((x) => Number.parseFloat(String(x ?? '')) || 0),
      )
    }
    return Object.keys(t)
      .filter((key) => {
        const v = t[key]
        // `inherit` names no size of its own — listing it prints
        // "inherit · inherit", which tells an author nothing.
        return (
          v &&
          typeof v === 'object' &&
          v.fontSize &&
          Number.isFinite(Number.parseFloat(String(v.fontSize)))
        )
      })
      .map((key) => ({
        key,
        size: ceiling(t[key]),
        weight: t[key].fontWeight,
        raw: String(t[key].fontSize),
      }))
      .sort((a, b) => b.size - a.size)
  }, [theme])
  return (
    <Stack spacing={1}>
      {variants.map(({ key, weight, raw }) => (
        <Stack
          key={key}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
        >
          <Typography variant={key as any} sx={{ minWidth: 0 }} noWrap>
            {key}
          </Typography>
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ flexShrink: 0 }}
          >
            {`${raw} · ${weight ?? ''}`}
          </Typography>
        </Stack>
      ))}
      <Typography variant="body1">
        {'Body copy shows the font family, size, and text colors. '}
        <Link href="#" onClick={(e) => e.preventDefault()}>
          {'A link'}
        </Link>
        {' sits inline with the text.'}
      </Typography>
    </Stack>
  )
}

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
          {/* The WHOLE type ramp, read off the theme (Zach 2026-08-25).
              This was five hand-picked samples — h4, h6, subtitle2, body1,
              caption — so the variants an author is most likely to retune
              were the ones they could not see: every heading above h4, both
              body sizes side by side, button and overline casing, and any
              rung the host added itself (Aglyn's own theme carries `lede`,
              `bodyCompact` and `micro`). A ramp you cannot see is a ramp you
              tune by reloading the site.

              Discovered rather than listed, for the same reason the besigner's
              pickers discover theirs: a host that adds a step gets it here
              with no edit. Each row names the variant and shows what it
              resolves to, so the preview doubles as the legend. */}
          <TypeRamp />
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
          {/* Same reasoning as the surface block above, for the tints
              (AGL-1244): the pairing is the whole point of the token, so the
              preview renders each wash under the accent that belongs on it
              rather than as three bare swatches. */}
          <Typography variant="body2" color="text.secondary">
            {'Tints are the pale washes a tile or panel is filled with — each '}
            {'one named after the accent whose icon sits on it. They are not '}
            {'the light shades of those accents.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            {(
              [
                ['tint.primary', 'primary.dark', 'Primary'],
                ['tint.secondary', 'secondary.main', 'Secondary'],
                ['tint.tertiary', 'tertiary.main', 'Tertiary'],
              ] as const
            ).map(([fill, ink, label]) => (
              <Box
                key={fill}
                sx={{
                  flex: 1,
                  backgroundColor: fill,
                  color: ink,
                  borderRadius: 1,
                  p: 1.5,
                }}
              >
                <Typography variant="subtitle2">{label}</Typography>
                <Typography variant="caption" sx={{ display: 'block' }}>
                  {`tint.${label.toLowerCase()}`}
                </Typography>
              </Box>
            ))}
          </Stack>
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
