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

import { siteFontPairing } from '@aglyn/aglyn/app-utils/site-font-pairings'
import type { SiteStarterBuiltinReading } from '@aglyn/aglyn/app-utils/site-starter-theme'
import { SITE_STYLES } from '@aglyn/aglyn/app-utils/site-styles'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import {
  Alert,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useId, type ReactNode } from 'react'
import type {
  StarterPublishPages,
  StarterPublishStep,
  StarterThemeChoice,
} from '../model/starter-publish'

export interface PublishStarterFieldsProps {
  /** The site's built-in as a starter would carry it, or `null` when it wears none. */
  builtin: SiteStarterBuiltinReading | null
  /** The host has been read, so `builtin` is an answer. */
  hostReady: boolean
  /** The pages the publish will capture, or `null` while they load. */
  pages: StarterPublishPages | null
  /** What stands in the way, each with where it is fixed. */
  steps: readonly StarterPublishStep[]
  choice: StarterThemeChoice | null
  onChoiceChange: (choice: StarterThemeChoice) => void
  /** The closest style's id, or `''` for none. */
  styleKind: string
  onStyleKindChange: (kind: string) => void
  disabled?: boolean
}

/** The fonts a pairing sets, as a person names them. */
function pairingLabel(id: string | null): string | null {
  const pairing = siteFontPairing(id)
  if (!pairing) return null
  return pairing.heading.family === pairing.body.family
    ? pairing.body.family
    : `${pairing.heading.family} and ${pairing.body.family}`
}

/** One theme option: its name, and a line on what it carries. */
function OptionLabel(props: { title: string; detail: ReactNode }) {
  return (
    <Stack spacing={0.25} sx={{ py: 0.5 }}>
      <Typography variant="body2" component="span" sx={{ fontWeight: 'fontWeightMedium' }}>
        {props.title}
      </Typography>
      <Typography variant="caption" component="span" color="text.secondary">
        {props.detail}
      </Typography>
    </Stack>
  )
}

/**
 * The half of the publish form only a site starter has (AGL-4049): what it
 * captures, the theme it carries (chosen by the publisher; neither shape is
 * chosen for them), the style it is listed under, and every setup step that
 * stands in the way, said before the click with where it is fixed.
 *
 * A theme shape this site cannot be published as stays on screen, disabled,
 * with the reason: a site that wears its own theme has no built-in to name.
 */
export function PublishStarterFields(props: PublishStarterFieldsProps) {
  const {
    builtin,
    hostReady,
    pages,
    steps,
    choice,
    onChoiceChange,
    styleKind,
    onStyleKindChange,
    disabled = false,
  } = props
  const themeLabelId = useId()
  const fonts = pairingLabel(builtin?.theme.fonts ?? null)
  const recolored = !!builtin && Object.values(builtin.theme.brand).some((colors) => colors && Object.keys(colors).length)

  const builtinDetail = !hostReady
    ? "Reading this site's theme…"
    : builtin
      ? `${builtin.baseName}, ${recolored ? 'with the brand colors this site set over it' : 'in its own colors'}` +
        `${fonts ? `, set in ${fonts}` : ''}. A site created from it can switch to another built-in theme.`
      : 'This site wears its own theme, not a built-in one, so a starter can carry it only as its full theme.'

  return (
    <Stack spacing={2}>
      {pages ? (
        <Typography variant="body2" color="text.secondary" data-starter-publish="pages">
          {pages.count === 1
            ? 'Captures its one published page, '
            : `Captures its ${pages.count} published pages, `}
          {'the shared header and footer they sit in, and the theme you choose below.'}
        </Typography>
      ) : null}

      <FormControl required disabled={disabled}>
        <FormLabel id={themeLabelId} sx={{ typography: 'body2' }}>
          {'Theme'}
        </FormLabel>
        <RadioGroup
          aria-labelledby={themeLabelId}
          value={choice ?? ''}
          onChange={(event) => onChoiceChange(event.target.value as StarterThemeChoice)}
        >
          <FormControlLabel
            value="builtin"
            disabled={disabled || !builtin}
            sx={{ alignItems: 'flex-start', mr: 0 }}
            control={<Radio size="small" sx={{ mt: 0.25 }} />}
            label={
              <OptionLabel title="This site's built-in theme with its brand colors" detail={builtinDetail} />
            }
          />
          <FormControlLabel
            value="full"
            disabled={disabled}
            sx={{ alignItems: 'flex-start', mr: 0 }}
            control={<Radio size="small" sx={{ mt: 0.25 }} />}
            label={
              <OptionLabel
                title="The site's full theme"
                detail="Every color, font and style this site's theme sets. A site created from it gets it as one of its themes, named after the starter."
              />
            }
          />
        </RadioGroup>
        {!choice ? (
          <FormHelperText sx={{ mx: 0 }}>{"Choose the starter's theme to publish it."}</FormHelperText>
        ) : null}
      </FormControl>

      {choice === 'builtin' && builtin && !builtin.fontsCarried ? (
        <Alert severity="info">
          {`This site's fonts are not a pairing a built-in theme can name, so the starter uses ` +
            `${builtin.baseName}'s own fonts. Choose the full theme to keep them.`}
        </Alert>
      ) : null}

      <TextField
        select
        size="small"
        label="Closest style"
        value={styleKind}
        onChange={(event) => onStyleKindChange(event.target.value)}
        disabled={disabled}
        helperText="The kind of site it is listed under when people choose a starter. Optional."
        fullWidth
      >
        <MenuItem value="">{'None'}</MenuItem>
        {SITE_STYLES.map((style) => (
          <MenuItem key={style.id} value={style.id}>
            {style.name}
          </MenuItem>
        ))}
      </TextField>

      {steps.map((step) => (
        <PrerequisiteNotice
          key={step.id}
          severity="warning"
          href={step.href ?? undefined}
          actionLabel={step.actionLabel}
        >
          <span data-starter-publish-step={step.id}>{step.text}</span>
        </PrerequisiteNotice>
      ))}
    </Stack>
  )
}

PublishStarterFields.displayName = 'PublishStarterFields'

export default PublishStarterFields
