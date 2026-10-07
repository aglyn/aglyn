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
import { MdiIcon } from '@aglyn/shared-ui-jsx'
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
import type { AiBriefKind } from './ai-brief-dialog.component'

/**
 * "Create with AI" on a plan that could buy the AI add-on and has not
 * (AGL-3601). The shell mounts the entry with `entitled={false}` only where
 * the add-on is sold to this workspace, and the jobs route has said the plan
 * is the one thing missing; the entry then keeps its place on the page and
 * opens this instead of the brief, so the reader sees where the add-on is used.
 */

/** What a "Create with AI" entry makes: the brief kinds, and an automation. */
export type AiUpsellKind = AiBriefKind | 'workflow'

/** What the dialog says one entry would do here. */
export const AI_UPSELL_COPY: Readonly<Record<AiUpsellKind, { title: string; does: string }>> = {
  page: {
    title: 'Create a page with AI',
    does:
      'Describe the page you need and AI plans it from your brief, using your theme and ' +
      'what the site already has. You confirm the plan, and the page is built as an ' +
      'unpublished draft.',
  },
  template: {
    title: 'Create a page template with AI',
    does:
      'Describe what each page should show and AI plans the template, filling what ' +
      'changes from page to page from each record. You confirm the plan, and the template ' +
      'is built as a draft in your library.',
  },
  layout: {
    title: 'Create a layout with AI',
    does:
      'Describe what the layout should hold and AI plans it, linking your pages and placing ' +
      'your navigation or menu component when the site has one. You confirm the plan, and ' +
      'the layout is built as a draft no page uses until you assign it.',
  },
  form: {
    title: 'Create a form with AI',
    does:
      'Describe what the form is for and AI plans its fields, its marketing consent and ' +
      'where each submission goes. You confirm the plan, and the form is built as a draft.',
  },
  component: {
    title: 'Create a reusable component with AI',
    does:
      'Describe what the component should show and AI plans it, making what each page can ' +
      'change into its properties. You confirm the plan, and the component is built as a ' +
      'draft.',
  },
  workflow: {
    title: 'Create an automation with AI',
    does:
      'Describe what should happen, and when, and AI drafts the automation from the ' +
      'triggers and steps your plan includes. It is saved switched off for you to review.',
  },
}

/** The sentence that says where the feature comes from, and who can add it. */
export function aiUpsellOffer(canManageBilling: boolean): string {
  const addon = aiAddonName()
  return canManageBilling
    ? `Create with AI comes with the ${addon} add-on, which you can add to this ` +
        'workspace from Billing.'
    : `Create with AI comes with the ${addon} add-on. Ask a workspace owner or admin ` +
        'to add it from Billing.'
}

export interface AiUpsellDialogProps {
  kind: AiUpsellKind
  open: boolean
  onClose: () => void
  upgrade: ConsoleWidgetUpgrade
}

export function AiUpsellDialog({ kind, open, onClose, upgrade }: AiUpsellDialogProps) {
  const copy = AI_UPSELL_COPY[kind]
  const { canManageBilling, billingHref } = upgrade

  // Counted once per opening: the denominator the click is a rate against.
  useEffect(() => {
    if (open) trackEvent('ai_upsell_shown', { kind, can_manage: canManageBilling })
  }, [open, kind, canManageBilling])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">{copy.does}</Typography>
          <Typography variant="body2" color="text.secondary">
            {aiUpsellOffer(canManageBilling)}
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
 * icon as the entitled entry, opening {@link AiUpsellDialog}.
 */
export function AiUpsellButton({
  kind,
  upgrade,
}: {
  kind: AiUpsellKind
  upgrade: ConsoleWidgetUpgrade
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
        {'Create with AI'}
      </Button>
      <AiUpsellDialog kind={kind} open={open} onClose={() => setOpen(false)} upgrade={upgrade} />
    </>
  )
}
