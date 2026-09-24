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

/*==========================================
 * ONE STEP'S EMAIL, AS A PERSON WOULD GET IT (AGL-2980).
 *
 * The editor's live preview and the preview route both show an email
 * before anyone is sent it, and both write it with the engine's own
 * composer — the merge, the footer, the threading — so what the rep reads
 * is what the runtime would send. Client-safe.
 *
 * A step later in the thread is sent as `Re:` the thread's subject, and the
 * composer refuses to write one without a thread to answer. A preview has
 * no thread, so it lends the composer one: the subject the thread would
 * have been started with, rendered for the same person, and a placeholder
 * message id that never leaves the preview.
 *==========================================*/

import type { CrmMergeContext } from '@aglyn/aglyn/app-utils/crm-email-templates'
import { resolveCrmMergeFields } from '@aglyn/aglyn/app-utils/crm-email-templates'
import {
  composeOutreachEmail,
  type ComposeOutreachEmailInput,
  type OutreachComposeResult,
} from '../engine/compose'
import { isInThreadEmailStep } from '../engine/sequence-validation'
import type { OutreachOrgSettings, OutreachSequenceStep, OutreachStepOverrides } from './outreach.types'

/** The holder id the sample person's facet is filed under. */
const SAMPLE_GROUP = 'outreach-preview'

/** The person a preview is written to when it names no contact. */
export const OUTREACH_SAMPLE_PERSON = {
  name: 'Casey Morgan',
  email: 'casey.morgan@example.com',
  companyName: 'Example Co',
  jobTitle: 'Head of Operations',
  personalLine: 'I saw Example Co just opened its second location.',
} as const

/** The merge context of the sample person, from the sender and site given. */
export function outreachSampleMergeContext(input: {
  sender?: CrmMergeContext['sender']
  siteName?: string | null
}): CrmMergeContext {
  return {
    contact: {
      name: OUTREACH_SAMPLE_PERSON.name,
      email: OUTREACH_SAMPLE_PERSON.email,
      facets: {
        [SAMPLE_GROUP]: {
          companyName: OUTREACH_SAMPLE_PERSON.companyName,
          jobTitle: OUTREACH_SAMPLE_PERSON.jobTitle,
        },
      },
    },
    contactGroupId: SAMPLE_GROUP,
    sender: input.sender ?? null,
    site: { name: input.siteName ?? '' },
  }
}

/** The placeholder a preview lends the composer as the thread's last message. */
const PREVIEW_MESSAGE_ID = '<preview@outreach.invalid>'

export interface OutreachStepPreviewInput {
  steps: readonly OutreachSequenceStep[]
  stepIndex: number
  orgSettings: Pick<OutreachOrgSettings, 'legalName' | 'brandName' | 'postalAddress'> | null
  merge: CrmMergeContext
  /** The recipient's address. */
  email: string
  personalLine: string
  /** The CRM template's body, when the step names a template. */
  templateBody?: string | null
  /**
   * The composer's link rewriter (AGL-3325), for a TEST send whose links
   * are minted as test links. A preview passes nothing and shows the links
   * as written.
   */
  rewriteLink?: ComposeOutreachEmailInput['rewriteLink']
  /** The person's own copies of steps (AGL-3324), as the enrollment would carry them. */
  stepOverrides?: OutreachStepOverrides | null
}

/** The step's email, or why it can't be written — see the module note. */
export function previewOutreachStep(input: OutreachStepPreviewInput): OutreachComposeResult {
  const steps = [...input.steps]
  let threadSubject: string | null = null
  if (isInThreadEmailStep(steps, input.stepIndex)) {
    // The thread was started by the latest email before this one that did
    // not itself reply in a thread.
    for (let index = input.stepIndex - 1; index >= 0; index -= 1) {
      const step = steps[index]
      if (step?.kind === 'email' && !isInThreadEmailStep(steps, index)) {
        threadSubject = resolveCrmMergeFields(step.subject, input.merge).text.trim() || null
        break
      }
    }
  }
  return composeOutreachEmail({
    sequence: { steps },
    enrollment: {
      email: input.email,
      stepIndex: input.stepIndex,
      personalLine: input.personalLine,
      threadSubject,
      messageIds: threadSubject ? [PREVIEW_MESSAGE_ID] : [],
      gmailThreadId: threadSubject ? 'preview' : null,
      ...(input.stepOverrides ? { stepOverrides: input.stepOverrides } : {}),
    },
    orgSettings: input.orgSettings,
    merge: input.merge,
    templateBody: input.templateBody ?? null,
    rewriteLink: input.rewriteLink ?? null,
  })
}
