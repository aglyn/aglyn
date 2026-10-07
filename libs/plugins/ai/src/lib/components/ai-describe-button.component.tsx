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

import type {
  ConsoleHostComponentsZoneProps,
  ConsoleHostLayoutsZoneProps,
  ConsoleHostScreensZoneProps,
  ConsoleHostTemplatesZoneProps,
  ConsoleWidgetEntitlementProps,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { AiBriefDialog, type AiBriefKind } from './ai-brief-dialog.component'
import { AiUpsellButton } from './ai-upsell-dialog.component'
import { aiJobsProbeVerdict, type AiJobsVerdict } from './use-ai-job-run'

/**
 * "Create with AI" (AGL-2907, AGL-3043, AGL-3051): a job from a brief, beside the
 * create actions of the page that lists what the job makes — a page on
 * Screens, a page template on Templates, a layout on Layouts, a form on Forms
 * and a reusable component on Components — each mounted through that page's
 * zone. The Assist panel's AI jobs opens the same dialog for a page.
 */

export interface AiDescribeButtonProps
  extends ConsoleHostScreensZoneProps,
    ConsoleWidgetEntitlementProps {
  /** The job the brief starts: what the page the button sits on lists. */
  kind: AiBriefKind
}

/**
 * Renders nothing until the jobs route has answered for this workspace: the
 * shell decided the plan, the member's permission and the site's AI switch
 * before mounting it, and the release flag is the route's to decide, so a 404
 * or a 403 there is this control staying absent. A lockdown is the start
 * door's to say, in the dialog, in its own words.
 *
 * On a plan that could buy the AI add-on and has not (AGL-3601) the shell
 * mounts it with `entitled={false}` and an `upgrade` link, and the route
 * answers that the plan is what is missing: the same button then opens the
 * add-on's dialog instead of the brief. Anything else — the release flag off,
 * a member refused — still leaves it absent.
 */
export function AiDescribeButton({
  kind,
  hostId,
  orgId,
  entitled,
  upgrade,
}: AiDescribeButtonProps) {
  const { data: user } = useUser()
  // Held in a ref so the probe keys on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<AiJobsVerdict>('checking')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=1`,
        )
        const answer = await aiJobsProbeVerdict(response)
        if (active) setVerdict(answer)
      } catch {
        if (active) setVerdict('hidden')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, uid])

  if (verdict === 'upsell' && entitled === false && upgrade) {
    return <AiUpsellButton kind={kind} upgrade={upgrade} />
  }
  if (verdict !== 'ready') return null
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
      <AiBriefDialog
        kind={kind}
        open={open}
        onClose={() => setOpen(false)}
        orgId={orgId}
        hostId={hostId}
        user={user}
      />
    </>
  )
}

/** A page template from a brief, on the Templates page (`hostTemplates`). */
export function AiDescribeTemplateButton(props: ConsoleHostTemplatesZoneProps) {
  return <AiDescribeButton {...props} kind="template" />
}

/** A layout from a brief, on the Layouts page (`hostLayouts`). */
export function AiDescribeLayoutButton(props: ConsoleHostLayoutsZoneProps) {
  return <AiDescribeButton {...props} kind="layout" />
}

/**
 * A form from a brief, on the Forms page (`hostForms`, which the forms plugin
 * hosts on the `hostScreens` contract).
 */
export function AiDescribeFormButton(props: ConsoleHostScreensZoneProps) {
  return <AiDescribeButton {...props} kind="form" />
}

/** A reusable component from a brief, on the Components page (`hostComponents`). */
export function AiDescribeComponentButton(props: ConsoleHostComponentsZoneProps) {
  return <AiDescribeButton {...props} kind="component" />
}

export default AiDescribeButton
