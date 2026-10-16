'use client'

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

import { aiAddonName } from '@aglyn/aglyn'
import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import type { ConsoleWidgetUpgrade } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import {
  AI_UPSELL_COPY,
  AI_UPSELL_CREATE_LABEL,
  aiUpsellLabel,
  aiUpsellOffer,
  type AiUpsellKind,
} from '../model/ai-upsell-copy'

/**
 * "Create with AI" on a plan that could buy the AI add-on and has not
 * (AGL-3601). The shell mounts the entry with `entitled={false}` only where
 * the add-on is sold to this workspace, and the jobs route has said the plan
 * is the one thing missing; the entry then keeps its place on the page and
 * opens this instead of the brief, so the reader sees where the add-on is used.
 */

// The entries' words are the model's, which the native apps' door reads too
// (AGL-3854); re-exported for this dialog's existing readers.
export { AI_UPSELL_COPY, AI_UPSELL_CREATE_LABEL, aiUpsellLabel, aiUpsellOffer }
export type { AiUpsellCopy, AiUpsellKind } from '../model/ai-upsell-copy'

export interface AiUpsellDialogProps {
  kind: AiUpsellKind
  open: boolean
  onClose: () => void
  upgrade: ConsoleWidgetUpgrade
}

/** The add-on's own section of the Create with AI guide (AGL-3660). */
const aiUpsellHelp = () =>
  pluginDocsHelp('aiCreate', {
    anchor: '#without-the-add-on',
    excerpt: `Create with AI needs the ${aiAddonName()} add-on on a paid plan. An owner or admin adds it from Billing; on Free, the monthly AI credits cover it.`,
  })

export function AiUpsellDialog({ kind, open, onClose, upgrade }: AiUpsellDialogProps) {
  const copy = AI_UPSELL_COPY[kind]
  const { canManageBilling, billingHref } = upgrade

  // Counted once per opening: the denominator the click is a rate against.
  useEffect(() => {
    if (open) trackEvent('ai_upsell_shown', { kind, can_manage: canManageBilling })
  }, [open, kind, canManageBilling])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {copy.title}
        <HelpTip {...aiUpsellHelp()} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">{copy.does}</Typography>
          <Typography variant="body2" color="text.secondary">
            {aiUpsellOffer(canManageBilling, kind === 'insight' ? copy.title : AI_UPSELL_CREATE_LABEL)}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{canManageBilling ? 'Not now' : 'Close'}</Button>
        {canManageBilling ? (
          <Button
            variant="contained"
            href={billingHref}
            onClick={() => trackEvent('ai_upsell_clicked', { kind })}
          >
            {`Add ${aiAddonName()}`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}

/**
 * The entry itself on a plan without the add-on: the same button, label and
 * icon as the entitled entry, opening {@link AiUpsellDialog}. Every entry that
 * draws it renders from the shell's client-side gates alone and asks the
 * server nothing until it is used (AGL-3601).
 */
export function AiUpsellButton({
  kind,
  upgrade,
  label,
}: {
  kind: AiUpsellKind
  upgrade: ConsoleWidgetUpgrade
  /** The entitled entry's own label, when it is not the kind's. */
  label?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
      >
        {label ?? aiUpsellLabel(kind)}
      </Button>
      <AiUpsellDialog kind={kind} open={open} onClose={() => setOpen(false)} upgrade={upgrade} />
    </>
  )
}
