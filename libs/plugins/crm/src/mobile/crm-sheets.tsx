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

import {
  type CrmLeadFields,
  type CrmPicklist,
  crmLeadStatusLabel,
  crmLeadStatusLabelFor,
  crmLeadStatusOptions,
} from '@aglyn/aglyn/app-utils/crm'
import { Button, Chip, ListRow, Sheet, Text, TextField, useMobileTheme } from '@aglyn/mobile-ui'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { type LeadStatusChoice, leadStatusChoices, UNQUALIFY_REASON_MAX } from '../lib/model/lead-status-choices'
import { CRM_NOTE_MAX } from './crm-writes'

/*
 * The CRM's confirmations, as the console asks them (AGL-3622): a lead's
 * status select (Unqualified asks the reason, required), a deal marked
 * lost (the reason, optional), and a note.
 */

/** What the lead status sheet asks the page to write. */
export type LeadStatusPick =
  | { kind: 'status'; choice: LeadStatusChoice }
  | { kind: 'unqualify'; statusLabel: string; reason: string }

export function LeadStatusSheet(props: {
  visible: boolean
  onClose: () => void
  lead: Pick<CrmLeadFields, 'status' | 'statusLabel'> & { name?: unknown; email?: unknown }
  picklist: CrmPicklist
  busy: boolean
  onPick: (pick: LeadStatusPick) => void
}) {
  const { visible, onClose, lead, picklist, busy, onPick } = props
  const theme = useMobileTheme()
  // The Unqualified value picked from the list, while its reason is asked.
  const [unqualifyAs, setUnqualifyAs] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (!visible) return
    setUnqualifyAs(null)
    setReason('')
  }, [visible])
  const current = crmLeadStatusLabel(lead, picklist)
  const choices = leadStatusChoices(picklist, lead)
  const closedAs = crmLeadStatusOptions(picklist, ['unqualified'])
  const label = String(lead.name || lead.email || 'this lead')

  if (unqualifyAs !== null) {
    return (
      <Sheet visible={visible} onClose={onClose} title={`Unqualify ${label}?`}>
        <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
          <Text tone="secondary">
            The lead stays on file and drops out of the open list. Say why, so the reason can be counted later.
          </Text>
          {closedAs.length > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
              {closedAs.map((option) => (
                <Chip
                  key={option.label}
                  testID={`unqualify-as-${option.label}`}
                  label={option.label}
                  selected={option.label === unqualifyAs}
                  onPress={() => setUnqualifyAs(option.label)}
                />
              ))}
            </View>
          ) : null}
          <TextField
            testID="unqualify-reason"
            label="Reason"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={UNQUALIFY_REASON_MAX}
            autoFocus
          />
          <Button
            testID="unqualify-confirm"
            title="Unqualify"
            busy={busy}
            disabled={!reason.trim()}
            onPress={() =>
              onPick({
                kind: 'unqualify',
                statusLabel: unqualifyAs || crmLeadStatusLabelFor(picklist, 'unqualified'),
                reason: reason.trim(),
              })
            }
          />
          <Button title="Cancel" variant="text" disabled={busy} onPress={onClose} />
        </View>
      </Sheet>
    )
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Status">
      {choices.map((choice) => (
        <ListRow
          key={choice.label}
          testID={`lead-status-${choice.label}`}
          title={choice.label}
          subtitle={choice.inactive ? 'No longer offered' : undefined}
          selected={choice.label === current}
          trailing={null}
          onPress={
            busy || choice.label === current || choice.inactive
              ? undefined
              : () =>
                  choice.status === 'unqualified'
                    ? setUnqualifyAs(choice.label)
                    : onPick({ kind: 'status', choice })
          }
        />
      ))}
    </Sheet>
  )
}

/** The console's Lost dialog: the reason is optional and kept on the deal and its event. */
export function DealLostSheet(props: {
  visible: boolean
  onClose: () => void
  dealTitle: string
  busy: boolean
  onConfirm: (reason: string) => void
}) {
  const { visible, onClose, dealTitle, busy, onConfirm } = props
  const theme = useMobileTheme()
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (visible) setReason('')
  }, [visible])
  return (
    <Sheet visible={visible} onClose={onClose} title="Mark this deal lost?">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        <Text tone="secondary">
          {`"${dealTitle}" moves to Lost and leaves the open pipeline. It can be reopened from its page.`}
        </Text>
        <TextField
          testID="deal-lost-reason"
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={500}
        />
        <Button testID="deal-lost-confirm" title="Mark lost" busy={busy} onPress={() => onConfirm(reason.trim())} />
        <Button title="Cancel" variant="text" disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  )
}

/** A note about the record, logged to its activity. */
export function NoteSheet(props: {
  visible: boolean
  onClose: () => void
  busy: boolean
  onSave: (body: string) => void
}) {
  const { visible, onClose, busy, onSave } = props
  const theme = useMobileTheme()
  const [body, setBody] = useState('')
  useEffect(() => {
    if (visible) setBody('')
  }, [visible])
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a note">
      <View style={{ padding: theme.space(2), gap: theme.space(2) }}>
        <TextField
          testID="crm-note-body"
          label="Note"
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={CRM_NOTE_MAX}
          autoFocus
        />
        <Button testID="crm-note-save" title="Save note" busy={busy} disabled={!body.trim()} onPress={() => onSave(body.trim())} />
      </View>
    </Sheet>
  )
}
