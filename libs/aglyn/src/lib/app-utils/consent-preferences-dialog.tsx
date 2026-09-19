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
// No 'use client' directive, for the reason `consent-banner-ui.tsx` gives:
// inside @aglyn/aglyn it would split the bundler into a duplicate module graph.
// The only importer is that module, which is already inside the client graph.

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import type { ReactElement, ReactNode } from 'react'

/**
 * The visitor consent preferences panel: one switch per category, and refuse
 * and save as the same control at the same level.
 *
 * Its own module because it is the one consent surface a visit has to ASK
 * for. The banner and the pill are drawn without a click; this panel opens
 * only from Preferences, the pill or a `#aglyn-consent` link, and MUI's
 * `Dialog`, `Modal`, focus trap, transitions and `Switch` are the larger half
 * of what the consent surfaces weigh. `consent-banner-ui.tsx` loads this file
 * when the panel is asked for (or looks about to be) and draws it from there;
 * it holds the state, and this file only draws it.
 */

/** The words the panel shows — the `ConsentCopy` fields it reads, resolved. */
export interface ConsentPreferencesWords {
  panelIntro: string
  strictlyNecessary: string
  analyticsLabel: string
  analyticsDetail: string
  advertisingLabel: string
  advertisingDetail: string
}

export interface ConsentPreferencesDialogProps {
  /** The panel's title, fixed by regulation (`CONSENT_OPT_OUT_TITLE`). */
  title: string
  /** Stacking order; it has to outrank any popup backdrop on the page. */
  zIndex: number
  words: ConsentPreferencesWords
  /** Whether the surface asks about advertising storage at all. */
  advertising?: boolean
  /** Links to the policies behind the choice, under the copy. */
  policyLinks?: ReactNode
  analyticsChecked: boolean
  onAnalyticsChange: (checked: boolean) => void
  adsChecked: boolean
  onAdsChange: (checked: boolean) => void
  onClose: () => void
  onDeclineAll: () => void
  onSave: () => void
}

/** One control per category, label and detail on two lines. */
function CategorySwitch(props: {
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}): ReactElement {
  const { label, detail, checked, onChange } = props
  return (
    <FormControlLabel
      control={
        <Switch
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{ input: { 'aria-label': label } }}
        />
      }
      label={
        <Box>
          <Typography variant="body2">{label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        </Box>
      }
    />
  )
}

export function ConsentPreferencesDialog(
  props: ConsentPreferencesDialogProps,
): ReactElement {
  const {
    title,
    zIndex,
    words,
    advertising,
    policyLinks,
    analyticsChecked,
    onAnalyticsChange,
    adsChecked,
    onAdsChange,
    onClose,
    onDeclineAll,
    onSave,
  } = props
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-label={title}
      data-aglyn-consent-preferences=""
      sx={{ zIndex }}
    >
      {/* The exact words are fixed by CCPA regs §7015 for a combined
          opt-out control — see `CONSENT_OPT_OUT_TITLE`. */}
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            {`${words.panelIntro} ${words.strictlyNecessary}`}
          </Typography>
          <CategorySwitch
            label={words.analyticsLabel}
            detail={words.analyticsDetail}
            checked={analyticsChecked}
            onChange={onAnalyticsChange}
          />
          {advertising ? (
            <CategorySwitch
              label={words.advertisingLabel}
              detail={words.advertisingDetail}
              checked={adsChecked}
              onChange={onAdsChange}
            />
          ) : null}
          {policyLinks}
        </Stack>
      </DialogContent>
      <DialogActions>
        {/* Refuse and accept are the SAME control at the same level — no
            dark patterns, no click-deep refusal. */}
        <Button onClick={onDeclineAll}>{'Decline all'}</Button>
        <Button variant="contained" onClick={onSave}>
          {'Save choices'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ConsentPreferencesDialog
