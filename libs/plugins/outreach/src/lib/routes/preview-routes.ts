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

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { normalizeCrmEmailTemplate } from '@aglyn/aglyn/app-utils/crm-email-templates'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { firstEmailStepIndex } from '../engine/sequence-validation'
import { leadAsContact } from '../enrollment/enroll-people'
import type { OutreachPreviewResponse } from '../model/outreach-api'
import type { OutreachEmailStep, OutreachMailbox, OutreachSequence } from '../model/outreach.types'
import {
  OUTREACH_SAMPLE_PERSON,
  outreachSampleMergeContext,
  previewOutreachStep,
  type OutreachStepPreviewInput,
} from '../model/step-preview'
import { readOutreachComplianceSettingsDoc } from '../storage/compliance-settings-store'
import {
  outreachOrgCollection,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import { OUTREACH_READS_PEOPLE } from './enroll-routes'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate, type OutreachRouteCaller } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachDocumentId,
  readOutreachJsonBody,
} from './route-http'

/**
 * ONE EMAIL OF A SAVED SEQUENCE, AS A PERSON WOULD GET IT (AGL-2980):
 * `outreach/preview`.
 *
 * Written from what is stored — the sequence, the CRM template a step names,
 * the mailbox it sends as, the organization's footer — by the engine's own
 * composer (`previewOutreachStep`), for a real contact with the personal
 * line the rep is writing, or for a sample person. The enroll dialog shows
 * it beside each person before Confirm, so the rep reads the sentence they
 * wrote in the email it goes into.
 *
 * A real contact is read from the CRM, so naming one asks for `data.manage`
 * as enrolling does; the sample person asks for nothing more.
 *
 * The reading is {@link readOutreachStepRender}, shared with the test send
 * (`step-test-routes.ts`, AGL-3325): a test is the preview's own email,
 * sent — so both routes read the same records through the same gate, and
 * what a member reads on screen is what arrives in their inbox.
 */

/** What a preview and a test both read before the composer runs. */
export interface OutreachStepRender {
  caller: OutreachRouteCaller
  sequence: OutreachSequence
  stepIndex: number
  step: OutreachEmailStep
  /** The sequence's mailbox as stored, or `null` when it names none or the mailbox is gone. */
  mailbox: OutreachMailbox | null
  /** The composer's input: the person, the line, the footer, the template. */
  input: OutreachStepPreviewInput
}

/**
 * The gate, then the sequence, the step and everything the step is rendered
 * from — as the request body names them — or the refusal that stops it.
 */
export async function readOutreachStepRender(
  deps: OutreachRouteDeps,
  request: Request,
  body: Record<string, unknown>,
): Promise<Response | OutreachStepRender> {
  const contactId = body['contactId'] === undefined ? null : readOutreachDocumentId(body['contactId'])
  if (body['contactId'] !== undefined && !contactId) {
    return outreachRefusal(400, 'invalid-request', 'Name the contact to preview for.')
  }
  // A lead the sequence's site holds (AGL-3234), previewed as the contact it would be.
  const leadId = body['leadId'] === undefined ? null : readOutreachDocumentId(body['leadId'])
  if (body['leadId'] !== undefined && !leadId) {
    return outreachRefusal(400, 'invalid-request', 'Name the lead to preview for.')
  }
  const caller = await outreachRouteGate(
    request,
    body['orgId'],
    deps.gate,
    contactId || leadId ? [OUTREACH_READS_PEOPLE] : [],
  )
  if (caller instanceof Response) return caller
  const sequenceId = readOutreachDocumentId(body['sequenceId'])
  if (!sequenceId) return outreachRefusal(400, 'invalid-request', 'Name the sequence to preview.')
  const firestore = deps.firestore()
  const org = firestore.collection('orgs').doc(caller.orgId)
  const snapshot = await outreachOrgCollection(firestore, caller.orgId, 'sequences').doc(sequenceId).get()
  const sequence = readStoredOutreachSequence(sequenceId, snapshot.exists ? snapshot.data() : undefined)
  if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')

  const requested = body['stepIndex']
  const stepIndex = typeof requested === 'number' ? requested : firstEmailStepIndex(sequence.steps)
  const step = sequence.steps[stepIndex]
  if (step?.kind !== 'email') {
    return outreachRefusal(400, 'invalid-request', 'That step does not send an email.')
  }

  const [orgSettings, mailboxSnapshot, host, template, contact, lead] = await Promise.all([
    readOutreachComplianceSettingsDoc(firestore, caller.orgId),
    sequence.mailboxId ? outreachOrgCollection(firestore, caller.orgId, 'mailboxes').doc(sequence.mailboxId).get() : null,
    sequence.hostId ? firestore.collection('hosts').doc(sequence.hostId).get() : null,
    step.templateId ? org.collection(CRM_COLLECTIONS.emailTemplates).doc(step.templateId).get() : null,
    contactId ? org.collection('contacts').doc(contactId).get() : null,
    // One org row (AGL-3275); the site is still required because a lead
    // preview is rendered in a site's context.
    leadId && sequence.hostId ? org.collection('leads').doc(leadId).get() : null,
  ])
  const leadData = lead?.exists ? (lead.data() as Record<string, unknown>) : null
  if (leadId && !leadData) {
    return outreachRefusal(404, 'contact-not-found', "That lead isn't in this sequence's site's CRM.")
  }
  const contactGroupId = consentGroupForHost(caller.org, sequence.hostId).groupId
  const contactData = contact?.exists
    ? (contact.data() as Record<string, unknown>)
    : leadData
      ? leadAsContact(leadData, contactGroupId)
      : null
  if (
    contactId &&
    (!contactData || !visibleToHost(contactData['visibleTo'] as string[] | undefined, sequence.hostId))
  ) {
    return outreachRefusal(404, 'contact-not-found', "That contact isn't in this sequence's site's CRM.")
  }
  const mailbox = readStoredOutreachMailbox(
    sequence.mailboxId,
    mailboxSnapshot?.exists ? mailboxSnapshot.data() : undefined,
  )
  const sender = mailbox ? { name: mailbox.displayName, email: mailbox.sendAs || mailbox.email } : null
  const siteName = host?.exists ? String(host.get('name') ?? '') : ''
  const merge = contactData
    ? {
        contact: contactData,
        contactGroupId,
        lead: leadData,
        sender,
        site: { name: siteName },
      }
    : outreachSampleMergeContext({ sender, siteName })
  const personalLine =
    typeof body['personalLine'] === 'string'
      ? body['personalLine']
      : contactData
        ? ''
        : OUTREACH_SAMPLE_PERSON.personalLine
  return {
    caller,
    sequence,
    stepIndex,
    step,
    mailbox,
    input: {
      steps: sequence.steps,
      stepIndex,
      orgSettings,
      merge,
      email: contactData ? (normalizeContactEmail(contactData['email']) ?? '') : OUTREACH_SAMPLE_PERSON.email,
      personalLine,
      templateBody: template?.exists
        ? normalizeCrmEmailTemplate(template.data() as Record<string, unknown>).body
        : null,
    },
  }
}

export function createOutreachPreviewRoute(deps: OutreachRouteDeps): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const loaded = await readOutreachStepRender(deps, request, body)
    if (loaded instanceof Response) return loaded
    const result = previewOutreachStep(loaded.input)
    return outreachOk({
      ok: true,
      stepIndex: loaded.stepIndex,
      subject: result.email?.subject ?? '',
      text: result.email?.text ?? '',
      unresolvedFields: result.unresolvedFields,
      error: result.error,
    } satisfies OutreachPreviewResponse)
  }
}
