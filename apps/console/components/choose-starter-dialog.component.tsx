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
'use client'

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { SiteStarterMode } from '@aglyn/aglyn/app-utils/site-starter'
import { SITE_STYLES } from '@aglyn/aglyn/app-utils/site-styles'
import { ICON_VARIANT_CLOSE, ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogContent,
  IconButton,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'

const TITLE_ID = 'choose-starter-title'

/** The full-screen surface, flat, as the start it opens from is drawn. */
const SURFACE_SX = { bgcolor: 'background.default' } as const

export interface ChooseStarterDialogProps {
  /** The site's name and address, as the shell asks for them. */
  fields: ReactNode
  /** "Start in preview", for the starter. */
  previewControl: ReactNode
  /** Base starters, or AI starters. */
  mode: SiteStarterMode
  onModeChange: (mode: SiteStarterMode) => void
  /** Whether the AI starters tab is offered: only where the AI start is. */
  offersAi: boolean
  search: string
  onSearchChange: (search: string) => void
  /** The kind of site narrowed to, or `null` for any. */
  kind: string | null
  onKindChange: (kind: string | null) => void
  /** Whether the search and kind filters apply: not to the styles drawn in the picker's place. */
  filters: boolean
  /** The starters: the marketplace's picker, or the styles in its place. */
  picker: ReactNode
  /** Why the create refused the last pick, or `null`. */
  notice: string | null
  onDismissNotice: () => void
  /** Why Create site is unavailable, or `null` when it is available. */
  blocked: string | null
  busy: boolean
  onCreate: () => void
  /** Leaves Create site with nothing created. */
  onClose: () => void
  /** Back to the start this was opened from, when there is one. */
  onBack?: () => void
  /** The heading: "Choose your starter", or "Choose a style" when only the styles are drawn. */
  title: string
  lede: string
  /** Only staff can see it while its release flag is off: said, and marked as staff-only chrome. */
  staffPreview?: boolean
}

/**
 * "Choose your starter" (AGL-4049): the starter path of Create site with the
 * marketplace's starters in it. The platform's styles are listed first, as
 * starters, then publishers' starters; nothing is chosen for the person, and
 * Create site waits until they pick one they may create from.
 *
 * The shell's own view: the name and address, a Starters / AI starters tab
 * where the AI start is offered, a search, the kinds of site, and whatever is
 * handed in as `picker` — the `hostStarterPicker` zone, or the style cards in
 * its place. Close leaves with nothing created; Back returns to the start it
 * was opened from.
 */
export function ChooseStarterDialog(props: ChooseStarterDialogProps) {
  const {
    fields,
    previewControl,
    mode,
    onModeChange,
    offersAi,
    search,
    onSearchChange,
    kind,
    onKindChange,
    filters,
    picker,
    notice,
    onDismissNotice,
    blocked,
    busy,
    onCreate,
    onClose,
    onBack,
    title,
    lede,
    staffPreview = false,
  } = props
  return (
    <Dialog
      open
      fullScreen
      onClose={() => (busy ? null : onClose())}
      aria-labelledby={TITLE_ID}
      data-create-area="choose-starter"
      slotProps={{ paper: { elevation: 0, sx: SURFACE_SX } }}
    >
      <AppBar
        position="relative"
        color="inherit"
        elevation={0}
        enableColorOnDark
        sx={{ ...SURFACE_SX, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <IconButton edge="start" color="inherit" onClick={onClose} disabled={busy} aria-label="Close Create site">
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
          <Typography variant="subtitle1" component="div" noWrap sx={{ flex: 1, textOverflow: 'ellipsis' }}>
            {'Create site'}
          </Typography>
          {onBack ? (
            <Button color="inherit" onClick={onBack} disabled={busy}>
              {'Back'}
            </Button>
          ) : null}
          <Button variant="contained" disabled={Boolean(blocked) || busy} onClick={onCreate}>
            {busy ? 'Creating…' : 'Create site'}
          </Button>
        </Toolbar>
      </AppBar>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Container maxWidth="lg" disableGutters sx={{ py: { xs: 3, sm: 4 } }}>
          <Stack spacing={3}>
            <Stack spacing={1}>
              <Typography id={TITLE_ID} variant="h4" component="h1">
                {title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {lede}
              </Typography>
            </Stack>
            {staffPreview ? (
              <Alert severity="warning" data-staff-only="release_site_starters">
                {'Release-flagged: customers do not see Choose your starter yet. You see it because you are staff.'}
              </Alert>
            ) : null}
            {notice ? (
              <Alert severity="warning" onClose={onDismissNotice} data-create-area="starter-notice">
                {notice}
              </Alert>
            ) : null}
            <Stack spacing={2} component="section" aria-label="Your site">
              {fields}
              {previewControl}
            </Stack>
            {offersAi ? (
              <Tabs
                value={mode}
                onChange={(_event, value: SiteStarterMode) => onModeChange(value)}
                aria-label="Kind of starter"
                sx={{ borderBottom: 1, borderColor: 'divider' }}
              >
                <Tab value="base" label="Starters" />
                <Tab value="ai" label="AI starters" />
              </Tabs>
            ) : null}
            {filters ? (
              <Stack spacing={1.5}>
                <TextField
                  label="Search starters"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  size="small"
                  fullWidth
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <MdiIcon path={ICON_VARIANT_SEARCH.path} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <Box
                  role="group"
                  aria-label="Kind of site"
                  sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
                >
                  <Chip
                    label="Every kind"
                    size="small"
                    color={kind === null ? 'primary' : 'default'}
                    variant={kind === null ? 'filled' : 'outlined'}
                    aria-pressed={kind === null}
                    onClick={() => onKindChange(null)}
                  />
                  {SITE_STYLES.map((style) => (
                    <Chip
                      key={style.id}
                      label={style.name}
                      size="small"
                      color={kind === style.id ? 'primary' : 'default'}
                      variant={kind === style.id ? 'filled' : 'outlined'}
                      aria-pressed={kind === style.id}
                      onClick={() => onKindChange(kind === style.id ? null : style.id)}
                    />
                  ))}
                </Box>
              </Stack>
            ) : null}
            {picker}
            {blocked ? (
              <Typography variant="body2" color="text.secondary" data-create-area="starter-blocked">
                {blocked}
              </Typography>
            ) : null}
          </Stack>
        </Container>
      </DialogContent>
    </Dialog>
  )
}
ChooseStarterDialog.displayName = 'ChooseStarterDialog'

/** The heading's words, for the starters or for the styles drawn in their place. */
export const CHOOSE_STARTER_COPY = {
  starters: {
    title: 'Choose your starter',
    lede:
      `${PLATFORM_BRAND_NAME}'s styles come first, then starters from the marketplace. ` +
      'Nothing is chosen for you, and you can change everything later.',
  },
  styles: {
    title: 'Choose a style',
    lede:
      'Your site starts with a home page, a header and a footer in the style you choose. ' +
      'You can change everything later.',
  },
} as const

export default ChooseStarterDialog
