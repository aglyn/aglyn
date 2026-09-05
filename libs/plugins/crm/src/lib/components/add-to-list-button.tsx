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
import { Button } from '@mui/material'
import { useState } from 'react'
import { useOrgDataScope } from '@aglyn/tenant-feature-instance'
import AddToListDialog from './add-to-list-dialog'

export interface AddToListButtonProps {
  hostId: string
  /** The org the shell passed, so the scope needs no lookup when it has an id. */
  org?: Partial<AglynOrgBilling> | null
  /** The record the button sits on. */
  contactId: string
  /** The person's address; a contact with none cannot be on a list. */
  email: string | null | undefined
}

/**
 * "Add to list", for one person's page (AGL-2603).
 *
 * The bulk bar's dialog over a selection of one. It lives on the contact
 * record because that is where somebody reading about one person decides
 * they belong on the newsletter — and it opens the same checked, attested
 * door the selection uses, so the record page cannot enroll anyone the
 * audience page would refuse.
 */
export function AddToListButton(props: AddToListButtonProps) {
  const { hostId, org, email } = props
  const { scope } = useOrgDataScope({ hostId, orgId: org?.$id })
  const [open, setOpen] = useState(false)
  const address = String(email ?? '').trim()
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={!scope || !address}
        onClick={() => setOpen(true)}
      >
        {'Add to list'}
      </Button>
      {open ? (
        <AddToListDialog
          open
          onClose={() => setOpen(false)}
          hostId={hostId}
          scope={scope}
          emails={address ? [address] : []}
        />
      ) : null}
    </>
  )
}
AddToListButton.displayName = 'AddToListButton'

export default AddToListButton
