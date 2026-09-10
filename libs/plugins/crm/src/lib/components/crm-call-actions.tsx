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

import { type AglynOrgBilling, crmTelHref } from '@aglyn/aglyn'
import { mdiPhoneOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Button, Link, Tooltip } from '@mui/material'
import { useState } from 'react'
import type { ActivityRecordLink } from './activity-queries'
import { useActivityScope } from './activity-queries'
import { CrmSuiteLockedButton } from './crm-suite-lock'
import { LogActivityDialog } from './log-activity-dialog'

/**
 * CLICK-TO-CALL (AGL-2661): a stored phone number, reachable in one tap,
 * and the call logged in one more.
 *
 * A rep working a list opens a record to call the person on it. Until now
 * the number was text: they read it, switched to a phone, typed it, and
 * then — if they remembered — opened the activity dialog, chose "call" and
 * wrote what happened. Two of those four steps are the machine's to do.
 *
 * `crmTelHref` in the shared library decides what is callable, so the link
 * a record page draws and the one a list would draw cannot disagree; a
 * value it refuses is shown as plain text rather than as a link that rings
 * nothing.
 */

export interface CrmPhoneLinkProps {
  /** The stored number — E.164 for anything the console wrote. */
  phone?: string | null
  /** What a record with no number shows; nothing renders by default. */
  fallback?: React.ReactNode
}

/**
 * A phone number as a `tel:` link, the one shape every CRM surface prints a
 * number in. Not a link when the value is not a number a dialer could take
 * — see `crmTelHref` — because a link that cannot ring is worse than text.
 */
export function CrmPhoneLink(props: CrmPhoneLinkProps) {
  const { phone, fallback = null } = props
  const text = String(phone ?? '').trim()
  if (!text) return <>{fallback}</>
  const href = crmTelHref(text)
  if (!href) return <>{text}</>
  return (
    <Link href={href} underline="hover">
      {text}
    </Link>
  )
}
CrmPhoneLink.displayName = 'CrmPhoneLink'

export interface CrmCallButtonProps {
  /**
   * The site the activity is filed under, or `null` at the organization
   * level — the same prop `CrmSendEmailButton` takes, for the same reason.
   */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
  /** The record the call is about; exactly one, as `ActivityRecordLink` says. */
  link: ActivityRecordLink
  /** The record's number, when the page holds one. */
  phone?: string | null
  /**
   * The org's plan lacks the CRM suite (AGL-2788). Logging the call is the
   * suite's and stands locked; dialing the number is not, and stays.
   */
  suiteLocked?: boolean
}

/**
 * The **Call** and **Log a call** pair a record page carries beside its
 * number (AGL-2661): the first dials, the second opens the activity dialog
 * already a call, with the record bound.
 *
 * One component file so a record page adds both with one import and one
 * line, whichever header the page draws its actions in — the shape
 * `CrmSendEmailButton` established. **Call** is disabled with its reason
 * for a record whose number a dialer could not take, rather than absent:
 * a rep looking for it should learn that the number is unusable, not
 * wonder where the button went. **Log a call** stands whatever the number
 * is, because a call placed from a mobile is still a call to log.
 */
export function CrmCallButton(props: CrmCallButtonProps) {
  const { hostId, org, link, phone, suiteLocked = false } = props
  const [open, setOpen] = useState(false)
  const scope = useActivityScope(hostId, org)
  const text = String(phone ?? '').trim()
  const href = crmTelHref(text)
  const reason = !text
    ? 'This record has no phone number'
    : !href
      ? `“${text}” is not a number a dialer can take`
      : ''
  const call = (
    <Button
      size="small"
      variant="outlined"
      disabled={!href}
      startIcon={<MdiIcon path={mdiPhoneOutline.path} size={0.8} />}
      {...(href ? { component: 'a' as const, href } : {})}
    >
      {'Call'}
    </Button>
  )
  return (
    <>
      {reason ? (
        <Tooltip title={reason}>
          <span>{call}</span>
        </Tooltip>
      ) : (
        call
      )}
      {suiteLocked ? (
        <CrmSuiteLockedButton variant="outlined">{'Log a call'}</CrmSuiteLockedButton>
      ) : (
        <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
          {'Log a call'}
        </Button>
      )}
      {open && !suiteLocked ? (
        <LogActivityDialog
          open
          onClose={() => setOpen(false)}
          scope={scope}
          link={link}
          kind="call"
        />
      ) : null}
    </>
  )
}
CrmCallButton.displayName = 'CrmCallButton'
