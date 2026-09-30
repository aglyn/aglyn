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

import {
  listConsoleThemePresets,
  lockdownRefusalText,
  parseLockdownRefusal,
  THEME_PRESETS_LOAD_POINT,
} from '@aglyn/aglyn'
import { resolveOverride, readArtifactOverride } from '@aglyn/aglyn/app-utils/artifact-overrides'
import { describeTheme } from '@aglyn/aglyn/app-utils/site-theme'
import {
  DEFAULT_THEME_ENTRY_ID,
  hasThemeEdits,
  presetEntryId,
  readThemeSelection,
  SITE_THEME_ENTRY_ID,
  THEME_NAME_MAX,
  type ThemeLibraryHost,
  type ThemeLibraryKind,
} from '@aglyn/aglyn/app-utils/theme-library'
import { BRAND } from '@aglyn/shared-data-enums'
import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHostSiteKey, wearsPlatformBrand } from '@aglyn/shared-ui-theme'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  ListItemText,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { useConsoleSlotPlugins } from '../../hooks/use-console-plugins'
import useThemeLibrary from '../../hooks/use-theme-library'
import { useEnabledPluginIds } from '../console-plugins-gate.component'
import ThemePreview from './theme-preview.component'

/** One row of the picker. */
interface ThemeOption {
  /** `kind:entryId`, unique across the picker. */
  key: string
  kind: ThemeLibraryKind
  /** The library entry id (a preset's is its stash entry). */
  id: string
  name: string
  description?: string
  /** The theme as picked, before any edits. */
  theme: HostTheme
  /** The plugin's own id, for a preset — what the route is sent. */
  presetId?: string
  /** Edits are waiting on this theme: live on the current one, stashed on the rest. */
  edited: boolean
}

const optionKey = (kind: ThemeLibraryKind, id: string) => `${kind}:${id}`

const GROUPS: Array<{ label: string; kinds: ThemeLibraryKind[] }> = [
  { label: 'Built-in', kinds: ['default', 'preset'] },
  { label: 'Your themes', kinds: ['custom'] },
  { label: 'From the marketplace', kinds: ['installed'] },
]

/** Two swatches from a theme's light scheme, so a row reads before it is picked. */
function Swatches(props: { theme: HostTheme }) {
  const light = props.theme.colorSchemes?.light
  const colors = [light?.primary?.main, light?.background?.default].filter(
    (color): color is string => Boolean(color),
  )
  if (!colors.length) return null
  return (
    <Stack direction="row" spacing={0.5} aria-hidden sx={{ flexShrink: 0 }}>
      {colors.map((color) => (
        <Box
          key={color}
          sx={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: 1,
            borderColor: 'divider',
            backgroundColor: color,
          }}
        />
      ))}
    </Stack>
  )
}

/** A stash as it resolves over its theme — what picking that theme will show. */
function withStash(theme: HostTheme, stash: unknown): HostTheme {
  const read = readArtifactOverride({ overrides: stash })
  return read ? resolveOverride<HostTheme>(theme, read.patch) : theme
}

/**
 * The theme picker (AGL-3404): every theme this site can run — the platform
 * default, the built-in themes plugins contribute, the site's own saved
 * themes and its marketplace installs — and what can be done with the one
 * picked.
 *
 * Picking is two steps on purpose. A theme repaints the live site the moment
 * it is applied, so the picker first PREVIEWS the choice here and applies it
 * only on "Use this theme".
 *
 * Nothing on this card can lose a theme. Every edit is an override on the
 * picked theme; leaving a theme keeps its edits for when you come back;
 * "Restore" drops the edits and not the theme; "Save as custom theme" adds a
 * theme and leaves the one it started from as it was.
 */
export function ThemeLibraryCard(props: {
  hostId: string
  host: (ThemeLibraryHost & Record<string, unknown>) | null | undefined
}) {
  const { hostId, host } = props
  // The site's own address decides the default's name and the base the
  // preview builds on — the same choice the published page makes (AGL-3068).
  const siteKey = useHostSiteKey()
  const installedVersion = (
    host?.themeInstalledFrom as { version?: string | null } | null | undefined
  )?.version
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  // The library is read once the picker is first opened, and listened to
  // from then on. The closed picker names the theme in use from
  // `themeSelection`, so a visit to the theme page that never opens it costs
  // no library reads at all (AGL-2501's per-section budget).
  const [libraryWanted, setLibraryWanted] = useState(false)
  const entries = useThemeLibrary(libraryWanted ? hostId : undefined)
  const presetsLoaded = useConsoleSlotPlugins([THEME_PRESETS_LOAD_POINT])
  const enabledPluginIds = useEnabledPluginIds()

  const selection = readThemeSelection(host)
  const currentKey = optionKey(selection.kind, selection.id)
  const edits = hasThemeEdits(host)
  // The default is the platform's theme, named after the platform — never
  // "Material UI", which is a built-in theme of its own (AGL-3422). A site on
  // one of the operator's own hosts wears the operator's brand; every other
  // site gets MUI's colors in the platform's type and component defaults.
  const brandHost = wearsPlatformBrand(siteKey)
  const defaultName = brandHost ? `${BRAND.ORG_NAME} brand` : `${BRAND.ORG_NAME} default`

  const options = useMemo(() => {
    const library = entries ?? {}
    const stashed = (id: string) =>
      Boolean(readArtifactOverride({ overrides: library[id]?.override }))
    const list: ThemeOption[] = [
      {
        key: optionKey('default', DEFAULT_THEME_ENTRY_ID),
        kind: 'default',
        id: DEFAULT_THEME_ENTRY_ID,
        name: defaultName,
        description: brandHost
          ? 'The platform’s own brand theme — what a site runs until it picks another'
          : 'MUI’s colors in the platform’s type and components — what a site runs until it picks another',
        theme: {},
        edited: stashed(DEFAULT_THEME_ENTRY_ID),
      },
    ]
    if (presetsLoaded) {
      for (const preset of listConsoleThemePresets(enabledPluginIds)) {
        const id = presetEntryId(preset.id)
        list.push({
          key: optionKey('preset', id),
          kind: 'preset',
          id,
          presetId: preset.id,
          name: preset.name,
          description: preset.description,
          theme: preset.theme,
          edited: stashed(id),
        })
      }
    }
    for (const [id, entry] of Object.entries(library)) {
      if (entry.kind !== 'custom' && entry.kind !== 'installed') continue
      list.push({
        key: optionKey(entry.kind, id),
        kind: entry.kind,
        id,
        name: entry.name,
        theme: entry.theme ?? {},
        edited: stashed(id),
      })
    }
    // The theme in use is always listed, even when nothing else names it:
    // a site's own theme from before the library, or a built-in theme whose
    // plugin is switched off.
    const current = list.find((option) => option.key === currentKey)
    if (current) current.edited = edits
    else {
      list.push({
        key: currentKey,
        kind: selection.kind,
        id: selection.id,
        name: selection.name,
        theme: (host?.theme ?? {}) as HostTheme,
        edited: edits,
      })
    }
    return list
  }, [
    entries,
    presetsLoaded,
    enabledPluginIds,
    defaultName,
    currentKey,
    selection.kind,
    selection.id,
    selection.name,
    host?.theme,
    edits,
  ])

  const [candidateKey, setCandidateKey] = useState(currentKey)
  // A switch made elsewhere (another tab, a marketplace install) moves the
  // picker with it rather than leaving it on a choice that is now applied.
  const [seenKey, setSeenKey] = useState(currentKey)
  if (seenKey !== currentKey) {
    setSeenKey(currentKey)
    setCandidateKey(currentKey)
  }
  const candidate =
    options.find((option) => option.key === candidateKey) ??
    options.find((option) => option.key === currentKey)
  const current = options.find((option) => option.key === currentKey)
  // What every sentence below calls the theme in use: the name the list
  // shows, so the default reads as the platform's rather than as its id.
  const themeName = current?.name ?? selection.name
  const previewing = Boolean(candidate && candidate.key !== currentKey)

  const [previewScheme, setPreviewScheme] = useState<HostThemeScheme>('light')
  const [busy, setBusy] = useState(false)
  const [nameDialog, setNameDialog] = useState<'save-as' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<'restore' | 'delete' | null>(null)

  const call = useCallback(
    async (body: Record<string, unknown>, success: string) => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user, '/api/hosts/theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, ...body }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          if (locked) {
            enqueueSnackbar(lockdownRefusalText(locked), {
              variant: 'warning',
              persist: true,
            })
            return false
          }
          enqueueSnackbar(payload?.error ?? 'That did not work', {
            variant: 'warning',
            allowDuplicate: true,
          })
          return false
        }
        enqueueSnackbar(success, { variant: 'success', persist: false })
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
        return false
      } finally {
        setBusy(false)
      }
    },
    [hostId, user, enqueueSnackbar],
  )

  const apply = useCallback(async () => {
    if (!candidate) return
    const target =
      candidate.kind === 'default'
        ? { kind: 'default' }
        : candidate.kind === 'preset'
          ? {
              kind: 'preset',
              id: candidate.presetId,
              name: candidate.name,
              theme: candidate.theme,
            }
          : { kind: candidate.kind, id: candidate.id }
    await call(
      { action: 'select', target },
      `This site now uses ${candidate.name}.`,
    )
  }, [candidate, call])

  const submitName = useCallback(async () => {
    const ok =
      nameDialog === 'save-as'
        ? await call(
            { action: 'save-as', name },
            `Saved as “${name.trim()}” and in use.`,
          )
        : await call(
            { action: 'rename', id: selection.id, name },
            'Renamed.',
          )
    if (ok) setNameDialog(null)
  }, [nameDialog, name, selection.id, call])

  const confirmAction = useCallback(async () => {
    const ok =
      confirm === 'restore'
        ? await call(
            { action: 'restore' },
            `${themeName} is back to how it was picked.`,
          )
        : await call(
            { action: 'delete', id: candidate?.id },
            `${candidate?.name ?? 'The theme'} is deleted.`,
          )
    if (ok) {
      setConfirm(null)
      if (confirm === 'delete') setCandidateKey(currentKey)
    }
  }, [confirm, call, themeName, candidate, currentKey])

  const summary = describeTheme((host?.theme ?? undefined) as HostTheme | undefined)
  const sourceChip: ReactNode =
    selection.kind === 'installed' ? (
      <Chip
        size="small"
        color="primary"
        label={
          installedVersion
            ? `From the marketplace · v${installedVersion}`
            : 'From the marketplace'
        }
      />
    ) : selection.kind === 'custom' ? (
      <Chip size="small" label={'Your theme'} />
    ) : (
      <Chip size="small" variant="outlined" label={'Built-in'} />
    )

  const previewTheme = candidate
    ? candidate.key === currentKey
      ? candidate.theme
      : withStash(candidate.theme, entries?.[candidate.id]?.override)
    : {}

  return (
    <>
      <CardDisplay
        header={'Theme'}
        help={docsHelp('themeBuilder', {
          excerpt:
            'Pick the theme this site runs. Your edits sit on top of it, so ' +
            'the theme itself is never changed and can always be restored.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <TextField
            select
            label={'Theme'}
            value={candidate?.key ?? currentKey}
            onChange={(event) => setCandidateKey(event.target.value)}
            disabled={busy}
            fullWidth
            slotProps={{
              select: {
                onOpen: () => setLibraryWanted(true),
                renderValue: (key) => {
                  const option = options.find((entry) => entry.key === key)
                  return (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      {option ? <Swatches theme={option.theme} /> : null}
                      <span>{option?.name ?? selection.name}</span>
                    </Stack>
                  )
                },
              },
            }}
          >
            {GROUPS.flatMap((group) => {
              const rows = options.filter((option) =>
                group.kinds.includes(option.kind),
              )
              if (!rows.length) return []
              return [
                <ListSubheader key={`group:${group.label}`}>
                  {group.label}
                </ListSubheader>,
                ...rows.map((option) => (
                  <MenuItem key={option.key} value={option.key}>
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}
                    >
                      <Swatches theme={option.theme} />
                      <ListItemText
                        primary={option.name}
                        secondary={option.description}
                        sx={{ minWidth: 0 }}
                      />
                      {option.key === currentKey ? (
                        <Chip size="small" label={'In use'} />
                      ) : null}
                      {option.edited ? (
                        <Chip size="small" variant="outlined" label={'Edited'} />
                      ) : null}
                    </Stack>
                  </MenuItem>
                )),
              ]
            })}
          </TextField>

          {previewing && candidate ? (
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <Typography variant="body2" color="text.secondary">
                  {candidate.edited
                    ? `Previewing ${candidate.name} with the edits you made to it.`
                    : `Previewing ${candidate.name}.`}
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={previewScheme}
                  onChange={(_, value) => value && setPreviewScheme(value)}
                >
                  <ToggleButton value="light">{'Light'}</ToggleButton>
                  <ToggleButton value="dark">{'Dark'}</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <ThemePreview theme={previewTheme} scheme={previewScheme} host={siteKey} />
              <Alert severity="info">
                {`Using ${candidate.name} repaints the live site now. ` +
                  `${current?.name ?? 'The current theme'} stays in this list` +
                  (edits ? ' with your edits to it,' : ',') +
                  ' so you can switch back. Unsaved changes in the editor ' +
                  'below are discarded.'}
              </Alert>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button variant="contained" disabled={busy} onClick={apply}>
                  {'Use this theme'}
                </Button>
                <Button
                  disabled={busy}
                  color="inherit"
                  onClick={() => setCandidateKey(currentKey)}
                >
                  {'Cancel'}
                </Button>
                {candidate.kind === 'custom' || candidate.kind === 'installed' ? (
                  candidate.id === SITE_THEME_ENTRY_ID && !entries?.[candidate.id] ? null : (
                    <Button
                      color="error"
                      disabled={busy}
                      onClick={() => setConfirm('delete')}
                    >
                      {'Delete'}
                    </Button>
                  )
                ) : null}
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                {sourceChip}
                {edits ? (
                  <Chip size="small" variant="outlined" color="warning" label={'Edited'} />
                ) : null}
                {summary.map((part) => (
                  <Chip key={part} size="small" variant="outlined" label={part} />
                ))}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {edits
                  ? `Your edits are stored on top of ${themeName}, which ` +
                    'itself is unchanged. Restore it to drop them, or save the ' +
                    'result as a theme of your own.'
                  : `This site runs ${themeName} as it was picked. ` +
                    'Anything you change below is stored as your edit on top ' +
                    'of it.'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => {
                    setName(
                      edits ? `${themeName} (edited)` : `${themeName} copy`,
                    )
                    setNameDialog('save-as')
                  }}
                >
                  {'Save as custom theme'}
                </Button>
                {selection.kind === 'custom' && edits ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() =>
                      call({ action: 'update' }, `${themeName} is updated.`)
                    }
                  >
                    {`Update ${themeName}`}
                  </Button>
                ) : null}
                {edits ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    disabled={busy}
                    onClick={() => setConfirm('restore')}
                  >
                    {`Restore ${themeName}`}
                  </Button>
                ) : null}
                {selection.kind === 'custom' ? (
                  <Button
                    size="small"
                    color="inherit"
                    disabled={busy}
                    onClick={() => {
                      setName(themeName)
                      setNameDialog('rename')
                    }}
                  >
                    {'Rename'}
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardDisplay>

      <Dialog
        open={nameDialog !== null}
        onClose={() => !busy && setNameDialog(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {nameDialog === 'save-as' ? 'Save as custom theme' : 'Rename theme'}
        </DialogTitle>
        <DialogContent>
          {nameDialog === 'save-as' ? (
            <DialogContentText sx={{ mb: 2 }}>
              {`The theme as it looks now — ${themeName}` +
                (edits ? ' with your edits' : '') +
                ' — becomes a theme of your own, and this site switches to it. ' +
                `${themeName} stays in the list as it was.`}
            </DialogContentText>
          ) : null}
          <TextField
            autoFocus
            fullWidth
            label={'Name'}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: THEME_NAME_MAX } }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() && !busy) submitName()
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setNameDialog(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !name.trim()}
            onClick={submitName}
          >
            {nameDialog === 'save-as' ? 'Save' : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirm !== null} onClose={() => !busy && setConfirm(null)}>
        <DialogTitle>
          {confirm === 'restore'
            ? `Restore ${themeName}?`
            : `Delete ${candidate?.name ?? 'this theme'}?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === 'restore'
              ? 'Your edits to this theme are dropped and the live site shows ' +
                `${themeName} as it was picked. To keep them, save them as a ` +
                'custom theme first.'
              : 'It is removed from this site’s list, along with any edits ' +
                'kept on it. This cannot be undone.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color={confirm === 'delete' ? 'error' : 'primary'}
            disabled={busy}
            onClick={confirmAction}
          >
            {confirm === 'restore' ? 'Restore' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default ThemeLibraryCard
