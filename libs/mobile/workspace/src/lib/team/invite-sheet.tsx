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

import { mobileBrandName } from '@aglyn/mobile-core'
import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import { Button, ChipRow, Sheet, Text, TextField } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { View } from 'react-native'
import { confirmAction, showNotice, showRefusal } from '../shared/actions'
import { titleCase } from '../shared/format'
import { SiteAccessPicker, type SiteAccessDraft } from './site-access-picker'
import { addOrInvite, ASSIGNABLE_ROLES, isEmailAddress, type AssignableRole } from './team-api'

const ROLE_CHIPS = ASSIGNABLE_ROLES.map((value) => ({ value, label: titleCase(value) }))

/**
 * Add or invite by email, with a role and, for an editor or viewer, all
 * sites or a role on each named site: the console's add row, whose owner
 * handoff stays in the console.
 */
export function InviteSheet({
  visible,
  onClose,
  onDone,
  api,
  orgId,
  sites,
}: {
  visible: boolean
  onClose: () => void
  onDone: () => void
  api: MobileApiClient
  orgId: string
  sites: ReadonlyArray<{ id: string; name: string }>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('editor')
  const [access, setAccess] = useState<SiteAccessDraft>({ allHosts: true, hostAccess: {} })
  const [busy, setBusy] = useState(false)
  const trimmed = email.trim()
  const valid = isEmailAddress(trimmed)
  const brand = mobileBrandName()

  const submit = async () => {
    const target = trimmed.toLowerCase()
    const confirmed = await confirmAction({
      title: `Add ${target}?`,
      message: `As ${role}${role === 'admin' || access.allHosts ? ', on every site' : ''}. If they are new to ${brand}, they get an email invite.`,
      confirmLabel: 'Add or invite',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await addOrInvite(api, orgId, { email: target, role, ...access })
      showNotice(
        result.kind === 'added' ? `Added ${target}` : `Invited ${target}`,
        result.kind === 'added'
          ? undefined
          : result.emailed
            ? 'The invite email was sent.'
            : 'They will see the invite when they sign in.',
      )
      setEmail('')
      setRole('editor')
      setAccess({ allHosts: true, hostAccess: {} })
      onDone()
    } catch (error) {
      showRefusal('Could not add them', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Add or invite">
      <View style={{ gap: 12, paddingBottom: 16 }}>
        <View style={{ paddingHorizontal: 16 }}>
          <TextField
            testID="invite-email"
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={trimmed && !valid ? 'Enter a valid email address' : null}
          />
        </View>
        <Text variant="caption" tone="secondary" style={{ paddingHorizontal: 16 }}>
          Role
        </Text>
        <ChipRow<AssignableRole> testID="invite-role" options={ROLE_CHIPS} value={role} onChange={setRole} />
        {role === 'admin' ? (
          <Text variant="caption" tone="secondary" style={{ paddingHorizontal: 16 }}>
            Admins manage the whole workspace and every site.
          </Text>
        ) : (
          <SiteAccessPicker value={access} onChange={setAccess} sites={sites} roleLabel={role} />
        )}
        <Text variant="caption" tone="secondary" style={{ paddingHorizontal: 16 }}>
          {`Already on ${brand}? They join right away. New to ${brand}? We email them an invite they accept when they first sign in.`}
        </Text>
        <View style={{ paddingHorizontal: 16 }}>
          <Button
            testID="invite-submit"
            title="Add or invite"
            disabled={!valid}
            busy={busy}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Sheet>
  )
}
