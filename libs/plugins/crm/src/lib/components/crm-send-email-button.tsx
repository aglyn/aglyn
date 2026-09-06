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

import type { AglynOrgBilling } from '@aglyn/aglyn'
import { Button, Tooltip } from '@mui/material'
import { useState } from 'react'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'
import CrmSendEmailDialog from './crm-send-email-dialog'

export interface CrmSendEmailButtonProps {
  /**
   * The site the message leaves from — passed in, never read off the URL.
   * At the organization level the record's own capturing site (AGL-2630),
   * or `null` for a record no site has captured: beneath the org hub's
   * mount the dialog offers the org's sites to send from (AGL-2634), and
   * only a surface mounted nowhere holds the button.
   */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
  contactId?: string
  leadId?: string
  dealId?: string
  /** The record's address, when the page holds it. */
  email?: string | null
  name?: string | null
}

/**
 * The **Send email** action a record page carries (AGL-2615): one button,
 * and the dialog it opens, mounted only while open.
 *
 * One component file so a record page adds the action with one import and
 * one line, whichever header the page draws its actions in. Disabled, with
 * the reason, for a record that names nobody to write to — a deal with no
 * contact, a contact with no address — rather than opening a dialog whose
 * To field is blank.
 */
export function CrmSendEmailButton(props: CrmSendEmailButtonProps) {
  const { hostId, org, contactId, leadId, dealId, email, name } = props
  const [open, setOpen] = useState(false)
  const address = String(email ?? '').trim()
  // A site to send from, or an org whose sites the dialog can offer.
  const canSend = Boolean(hostId) || Boolean(useCrmOrgMount())
  // A contact can be read for its address on open; a deal names one or
  // nothing; a lead carries its own.
  const reachable = canSend && (Boolean(address) || Boolean(contactId))
  const reason = !reachable
    ? !canSend
      ? 'No site has captured this record to send from'
      : dealId && !contactId
        ? 'This deal names no contact to email'
        : 'This record has no email address'
    : ''
  const button = (
    <Button
      size="small"
      variant="outlined"
      disabled={!reachable}
      onClick={() => setOpen(true)}
    >
      {'Send email'}
    </Button>
  )
  return (
    <>
      {reason ? (
        <Tooltip title={reason}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {open ? (
        <CrmSendEmailDialog
          open
          onClose={() => setOpen(false)}
          hostId={hostId}
          org={org}
          contactId={contactId}
          leadId={leadId}
          dealId={dealId}
          email={address || null}
          name={name}
        />
      ) : null}
    </>
  )
}
CrmSendEmailButton.displayName = 'CrmSendEmailButton'

export default CrmSendEmailButton
