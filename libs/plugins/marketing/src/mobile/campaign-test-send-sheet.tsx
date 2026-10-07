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

/**
 * PROOF ONE EMAIL, natively (AGL-3622): the console composer's test drawer.
 *
 * Opening asks the route who a test may go to (`proofOptions`): the reader
 * and the workspace's account holders, never a contact, and whose stored
 * data may fill the merge tags. The summary restates both before the button,
 * the drawer's own confirmation, and the test is one `action: 'test'` POST
 * carrying the message as the stored email holds it.
 */

import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import { Button, ListRow, Sheet, Text } from '@aglyn/mobile-ui'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { postCampaignSend, refusalOf, testMessageFromRecord, type CampaignSendRecord } from './campaign-sends'

interface ProofRecipient {
  email: string
  label: string
  self: boolean
}

interface ProofPersona {
  email: string
  name: string
  source: 'lead' | 'member' | 'contact'
}

const SOURCE_LABEL: Record<ProofPersona['source'], string> = {
  lead: 'Lead',
  member: 'Site user',
  contact: 'Contact',
}

export function CampaignTestSendSheet(props: {
  visible: boolean
  onClose: () => void
  api: MobileApiClient
  hostId: string
  send: CampaignSendRecord
}) {
  const { visible, onClose, api, hostId, send } = props
  const [recipients, setRecipients] = useState<ProofRecipient[] | null>(null)
  const [personas, setPersonas] = useState<ProofPersona[]>([])
  const [to, setTo] = useState('')
  const [personaEmail, setPersonaEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  useEffect(() => {
    if (!visible) return
    let active = true
    setError('')
    setSentTo('')
    postCampaignSend<{ recipients?: ProofRecipient[]; personas?: ProofPersona[] }>(api, hostId, {
      action: 'proofOptions',
    }).then(
      (payload) => {
        if (!active) return
        const list = payload.recipients ?? []
        setRecipients(list)
        setPersonas(payload.personas ?? [])
        setTo((current) => current || list.find((one) => one.self)?.email || '')
      },
      (failure) => {
        if (!active) return
        setRecipients([])
        setError(refusalOf(failure, 'Could not load who a test can go to'))
      },
    )
    return () => {
      active = false
    }
  }, [api, hostId, visible])

  const persona = personas.find((one) => one.email === personaEmail)

  const handleSend = async () => {
    if (busy || !to) return
    setBusy(true)
    setError('')
    try {
      const payload = await postCampaignSend<{ to?: string }>(api, hostId, {
        ...testMessageFromRecord(send),
        action: 'test',
        to,
        ...(personaEmail ? { personaEmail } : {}),
      })
      setSentTo(String(payload.to ?? to))
    } catch (failure) {
      setError(refusalOf(failure, 'The test send was refused'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Send a test">
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Text tone="secondary">
          A test mails one copy of this email and records nothing — no recipient count, no report figures, and nobody is
          marked as having received it.
        </Text>
        <Text variant="label">Fill the merge tags with</Text>
        <ListRow
          testID="test-persona-none"
          title="Nobody in particular"
          selected={!personaEmail}
          onPress={() => setPersonaEmail('')}
        />
        {personas.map((one) => (
          <ListRow
            key={one.email}
            testID={`test-persona-${one.email}`}
            title={one.name || one.email}
            subtitle={SOURCE_LABEL[one.source]}
            selected={one.email === personaEmail}
            onPress={() => setPersonaEmail(one.email)}
          />
        ))}
        <Text variant="caption" tone="secondary">
          {persona
            ? `The email will read as if addressed to ${persona.name || persona.email}. ${persona.email} is not sent anything.`
            : 'Leave this alone to see the fallbacks — {{firstName|there}} and the rest — as somebody with no stored name would.'}
        </Text>
        <Text variant="label">Deliver it to</Text>
        {(recipients ?? []).map((one) => (
          <ListRow
            key={one.email}
            testID={`test-to-${one.email}`}
            title={one.self ? `${one.email} (you)` : one.email}
            subtitle={one.self ? undefined : one.label}
            selected={one.email === to}
            onPress={() => setTo(one.email)}
          />
        ))}
        <Text variant="caption" tone="secondary">
          The only address this test is sent to. A test can go to you or to someone with an account on this workspace —
          never to a contact, who has not agreed to receive it.
        </Text>
        <View>
          <Text testID="test-summary">
            {to
              ? `We will send one copy to ${to}, from this site’s sending address${
                  persona ? `, written as if it were going to ${persona.name || persona.email}` : ''
                }.`
              : 'Choose an address to send the test to.'}
          </Text>
        </View>
        {error ? (
          <Text testID="test-error" tone="error">
            {error}
          </Text>
        ) : null}
        {sentTo ? (
          <Text testID="test-sent" tone="accent">
            {`Sent to ${sentTo}.`}
          </Text>
        ) : null}
        <Button testID="test-send" title={busy ? 'Sending…' : 'Send test'} disabled={busy || !to} onPress={() => void handleSend()} />
      </ScrollView>
    </Sheet>
  )
}
