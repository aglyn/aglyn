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

import { lockdownRefusalText, parseLockdownRefusal, resolveEffectivePlan } from '@aglyn/aglyn'
import type { ConsoleMediaLibraryZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  ListItemText,
  ListSubheader,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { aiMediaCreditsPerPicture } from '../model/ai-media-credits'
import {
  AI_MEDIA_KIND_GROUP_LABELS,
  AI_MEDIA_KIND_GROUPS,
  aiMediaKind,
  aiMediaKindsOffered,
  type AiMediaKind,
  type AiMediaKindId,
} from '../model/ai-media-kinds'
import {
  AI_IMAGE_ASPECT_RATIOS,
  AI_IMAGE_MAX_COUNT,
  AI_IMAGE_PROMPT_MAX_CHARS,
  aiImageSizeForPlan,
  AI_SVG_MAX_COLORS,
  aiImagePhotosOffered,
  type AiImageAspectRatio,
  type AiImageMode,
  type AiImageSize,
} from '../providers/image-contract'

/**
 * "Create with AI" in Media (AGL-3602): pictures from a description, added to
 * the library that is open, through the `mediaLibrary` zone beside Upload
 * media and in the library's empty state.
 *
 * It draws from the shell's gates alone — the plan, the member's
 * `ai.generate`, the plugin being on for the workspace and the site — and asks
 * no server anything until someone creates a picture: the door decides then,
 * and the dialog says what it decided. One Kind menu, in sections: Vector
 * kinds (an SVG the text AI draws, wherever text AI runs) and, where the
 * deployment makes them, Photo, Art and Design kinds from the image provider.
 */

/** Where the shell sends a reader to buy what the plan lacks (AGL-3601). */
export interface AiMediaUpgrade {
  billingHref: string
  canManageBilling: boolean
}

export interface AiMediaCreateButtonProps extends ConsoleMediaLibraryZoneProps {
  /**
   * `false` when the shell mounted this as its own upsell: the plan lacks AI
   * generation and an add-on would grant it. Absent means entitled.
   */
  entitled?: boolean
  upgrade?: AiMediaUpgrade
}

/** The words each shape is offered in. */
const ASPECT_LABELS: Record<AiImageAspectRatio, string> = {
  '1:1': 'Square',
  '4:3': 'Landscape',
  '3:4': 'Portrait',
  '16:9': 'Wide',
  '9:16': 'Tall',
}

/**
 * What a picture from the image provider may be declined for, as the code
 * and the provider decide it: Google's filters, and its policies on real
 * people and brands. A declined picture is never charged.
 */
export const AI_MEDIA_RASTER_SAFETY_NOTE =
  'Pictures of real, identifiable people, celebrities or brands may be declined by the image service. A declined picture is not charged.'

/** The line under the description for a kind whose colors are described rather than picked. */
export const AI_MEDIA_DESCRIBE_COLORS_NOTE =
  'To steer the colors, name them in the description, such as navy and coral.'

/** The menu's items: each section's heading, then its kinds with what one costs. */
function kindMenuItems(kinds: readonly AiMediaKind[], size: AiImageSize): ReactNode[] {
  const groups = AI_MEDIA_KIND_GROUPS.filter((group) => kinds.some((kind) => kind.group === group))
  const item = (kind: AiMediaKind) => (
    <MenuItem key={kind.id} value={kind.id} sx={{ gap: 2 }}>
      <ListItemText primary={kind.label} />
      <Typography variant="caption" color="text.secondary">
        {`about ${aiMediaCreditsPerPicture(kind.mode, undefined, size).toLocaleString()} credits`}
      </Typography>
    </MenuItem>
  )
  // One section needs no heading: a deployment without the image provider
  // lists the vector kinds alone, as it always has.
  if (groups.length < 2) return kinds.map(item)
  return groups.flatMap((group) => [
    <ListSubheader key={`group:${group}`}>{AI_MEDIA_KIND_GROUP_LABELS[group]}</ListSubheader>,
    ...kinds.filter((kind) => kind.group === group).map(item),
  ])
}

/**
 * The window's own help (AGL-3660): each control links the section of the
 * guide about it, not the guide's top.
 */
const AI_MEDIA_HELP = {
  dialog: pluginDocsHelp('aiImages', {
    anchor: '#make-a-picture',
    excerpt:
      'Choose a kind, describe the picture, pick a shape and how many. The pictures land in the folder you have open, with alt text you can edit.',
  }),
  locked: pluginDocsHelp('aiImages', {
    anchor: '#who-can-use-it',
    excerpt:
      'Creating pictures needs AI on your plan and the Generate with AI permission. A Free workspace creates them from its monthly credits.',
  }),
  shape: pluginDocsHelp('aiImages', {
    anchor: '#shapes-and-how-many',
    excerpt:
      'Five shapes, from Square 1:1 to Tall 9:16, and one to four pictures per request. Each picture is charged on its own.',
  }),
  credits: pluginDocsHelp('aiImages', {
    anchor: '#credits',
    excerpt:
      'The estimate is per picture times how many. You are charged only for pictures that reach your library; a declined or failed picture costs nothing.',
  }),
  declined: pluginDocsHelp('aiImages', {
    anchor: '#declined-pictures',
    excerpt:
      'Google’s safety filters may decline real people, celebrities, brands and unsafe content. A declined picture is not charged.',
  }),
}

/**
 * The size the door will make a picture at for this workspace (AGL-3602):
 * 512 px on the Free plan, 1K on a paid one. The door decides from the plan
 * itself; this reads the same plan so the estimate matches, and reads 1K —
 * the dearer estimate — until the workspace has arrived.
 */
export function useAiMediaImageSize(orgId: string): AiImageSize {
  const firestore = useFirestore()
  const { data: org, status } = useFirestoreDoc<Record<string, unknown>>(
    () => doc(firestore, 'orgs', orgId),
    [firestore, orgId],
  )
  return aiImageSizeForPlan(status === 'success' && resolveEffectivePlan(org as never) === 'free')
}

/** The sentence the estimate reads as, before anything is spent. */
export function aiMediaCreditEstimate(
  mode: AiImageMode,
  count: number,
  size: AiImageSize = '1K',
): string {
  const each = aiMediaCreditsPerPicture(mode, undefined, size)
  const pictures = count === 1 ? '1 picture' : `${count} pictures`
  return (
    `${pictures} uses about ${(count * each).toLocaleString()} AI credits ` +
    `(about ${each.toLocaleString()} each). A picture that is held back or does not come out is not charged.`
  )
}

export function AiMediaCreateButton(props: AiMediaCreateButtonProps) {
  const { orgId, entitled, upgrade } = props
  const [open, setOpen] = useState(false)
  if (!orgId) return null
  const button = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<MdiIcon path={mdiCreation.path} />}
      onClick={() => setOpen(true)}
    >
      {'Create with AI'}
    </Button>
  )
  if (entitled === false) {
    if (!upgrade) return null
    return (
      <>
        {button}
        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {'Create images with AI'}
            <HelpTip {...AI_MEDIA_HELP.locked} />
          </DialogTitle>
          <DialogContent>
            <Typography>
              {upgrade.canManageBilling
                ? 'Creating pictures and illustrations comes with the AI add-on.'
                : 'Creating pictures and illustrations comes with the AI add-on. Ask an owner or admin of this workspace to add it.'}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{'Close'}</Button>
            {upgrade.canManageBilling ? (
              <Button variant="contained" href={upgrade.billingHref}>
                {'See the AI add-on'}
              </Button>
            ) : null}
          </DialogActions>
        </Dialog>
      </>
    )
  }
  return (
    <>
      {button}
      <AiMediaCreateDialog {...props} orgId={orgId} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export interface AiMediaCreateDialogProps
  extends Pick<ConsoleMediaLibraryZoneProps, 'hostId' | 'library' | 'folderId' | 'onCreated'> {
  open: boolean
  onClose: () => void
  orgId: string
}

export function AiMediaCreateDialog({
  open,
  onClose,
  orgId,
  hostId,
  library,
  folderId,
  onCreated,
}: AiMediaCreateDialogProps) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const photos = aiImagePhotosOffered()
  const imageSize = useAiMediaImageSize(orgId)
  const kinds = useMemo(() => aiMediaKindsOffered(photos), [photos])
  const [kindId, setKindId] = useState<AiMediaKindId>(photos ? 'photo' : 'illustration')
  const kind = kinds.find((entry) => entry.id === kindId) ?? kinds[0]
  const mode = kind.mode
  // The site theme's colors need a site; the organization's library names none.
  const [paletteSource, setPaletteSource] = useState<'theme' | 'custom'>(hostId ? 'theme' : 'custom')
  const [colors, setColors] = useState<string[]>(['#1a73e8', '#fbbc04'])
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AiImageAspectRatio>(kind.aspectRatio)
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ severity: 'error' | 'warning'; text: string } | null>(null)

  useEffect(() => {
    if (open) setNotice(null)
  }, [open])

  /** A new kind brings its own shape; the person may still change it. */
  const chooseKind = (next: AiMediaKindId) => {
    setKindId(next)
    const chosen = aiMediaKind(next)
    if (chosen) setAspectRatio(chosen.aspectRatio)
  }

  const create = useCallback(async () => {
    const description = prompt.trim()
    if (!description) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/media/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          library,
          hostId,
          folderId,
          mode,
          prompt: description,
          aspectRatio,
          count,
          style: kind.id,
          ...(kind.colors === 'palette'
            ? {
                palette:
                  paletteSource === 'theme' ? { source: 'theme' } : { source: 'custom', colors },
              }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice({
          severity: 'error',
          text: locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The pictures could not be made — try again.'),
        })
        return
      }
      const ids: string[] = Array.isArray(payload?.mediaIds) ? payload.mediaIds : []
      onCreated(ids)
      const missing = Number(payload?.filtered ?? 0) + Number(payload?.failed ?? 0)
      if (missing > 0) {
        setNotice({
          severity: 'warning',
          text:
            `Added ${ids.length} of ${count} to the library. ` +
            (payload?.warning
              ? String(payload.warning)
              : 'The rest were held back and were not charged.'),
        })
        return
      }
      setPrompt('')
      onClose()
    } catch {
      setNotice({ severity: 'error', text: 'The pictures could not be made — try again.' })
    } finally {
      setBusy(false)
    }
  }, [prompt, orgId, library, hostId, folderId, mode, aspectRatio, count, kind, paletteSource, colors, onCreated, onClose])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {'Create images with AI'}
        <HelpTip {...AI_MEDIA_HELP.dialog} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            size="small"
            label="Kind"
            value={kind.id}
            onChange={(event) => chooseKind(event.target.value as AiMediaKindId)}
            disabled={busy}
            fullWidth
            helperText={kind.hint}
            slotProps={{
              select: {
                renderValue: (value) => aiMediaKind(String(value))?.label ?? String(value),
                MenuProps: { slotProps: { paper: { sx: { maxHeight: 420 } } } },
              },
            }}
          >
            {kindMenuItems(kinds, imageSize)}
          </TextField>
          <TextField
            label={mode === 'photo' ? 'Describe the picture' : 'Describe what to draw'}
            placeholder={kind.placeholder}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, AI_IMAGE_PROMPT_MAX_CHARS))}
            multiline
            minRows={3}
            autoFocus
            disabled={busy}
            helperText={
              kind.colors === 'describe'
                ? `${AI_MEDIA_DESCRIBE_COLORS_NOTE} The description becomes each picture's alt text, which you can edit.`
                : "The description becomes each picture's alt text, which you can edit."
            }
          />
          {mode === 'photo' ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {AI_MEDIA_RASTER_SAFETY_NOTE}
              </Typography>
              <HelpTip {...AI_MEDIA_HELP.declined} />
            </Stack>
          ) : null}
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {'Shape'}
              </Typography>
              <HelpTip {...AI_MEDIA_HELP.shape} />
            </Stack>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={aspectRatio}
              onChange={(_event, next) => {
                if (next) setAspectRatio(next)
              }}
              aria-label="Shape"
              disabled={busy}
              sx={{ flexWrap: 'wrap' }}
            >
              {AI_IMAGE_ASPECT_RATIOS.map((ratio) => (
                <ToggleButton key={ratio} value={ratio} aria-label={`${ASPECT_LABELS[ratio]} ${ratio}`}>
                  {`${ASPECT_LABELS[ratio]} ${ratio}`}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          {kind.colors === 'palette' ? (
            <Stack spacing={1}>
              <RadioGroup
                value={paletteSource}
                onChange={(event) => setPaletteSource(event.target.value as 'theme' | 'custom')}
                aria-label="Colors"
              >
                <FormControlLabel
                  value="theme"
                  control={<Radio size="small" />}
                  label="Use my site's theme colors"
                  disabled={busy || !hostId}
                />
                <FormControlLabel
                  value="custom"
                  control={<Radio size="small" />}
                  label="Choose colors"
                  disabled={busy}
                />
              </RadioGroup>
              {paletteSource === 'custom' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  {colors.map((color, index) => (
                    <Stack key={index} direction="row" sx={{ alignItems: 'center' }}>
                      <TextField
                        type="color"
                        size="small"
                        value={color}
                        onChange={(event) =>
                          setColors((current) =>
                            current.map((value, at) => (at === index ? event.target.value : value)),
                          )
                        }
                        disabled={busy}
                        slotProps={{ htmlInput: { 'aria-label': `Color ${index + 1}` } }}
                        sx={{ width: 64 }}
                      />
                      {colors.length > 1 ? (
                        <IconButton
                          size="small"
                          aria-label={`Remove color ${index + 1}`}
                          onClick={() => setColors((current) => current.filter((_value, at) => at !== index))}
                          disabled={busy}
                        >
                          {'×'}
                        </IconButton>
                      ) : null}
                    </Stack>
                  ))}
                  {colors.length < AI_SVG_MAX_COLORS ? (
                    <Button size="small" onClick={() => setColors((current) => [...current, '#333333'])} disabled={busy}>
                      {'Add a color'}
                    </Button>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
          <TextField
            select
            size="small"
            label="How many"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            disabled={busy}
            sx={{ maxWidth: 160 }}
          >
            {Array.from({ length: AI_IMAGE_MAX_COUNT }, (_unused, index) => index + 1).map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {aiMediaCreditEstimate(mode, count, imageSize)}
            </Typography>
            <HelpTip {...AI_MEDIA_HELP.credits} />
          </Stack>
          {busy ? (
            <Stack spacing={1}>
              <LinearProgress />
              <Typography variant="body2" color="text.secondary">
                {'Making your pictures and adding them to the library…'}
              </Typography>
            </Stack>
          ) : null}
          {notice ? <Alert severity={notice.severity}>{notice.text}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Close'}
        </Button>
        <Button variant="contained" onClick={() => void create()} disabled={busy || !prompt.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default AiMediaCreateButton
