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

import type { AiEmailType } from '../jobs/ai-job-email-step'
import type { AiJobKind } from './ai-jobs.types'
import type { AiPageType } from './ai-page-job'
import { parseAiTemplateJobInputs, type AiTemplateSubject } from './ai-template-subjects'

/**
 * WHAT EVERY "CREATE WITH AI" BRIEF SAYS AND SENDS (AGL-2907, AGL-3043,
 * AGL-3051, AGL-3596): each kind's words, the choices beside the brief, and
 * the job and inputs they start. Pure, so the console's brief dialog and the
 * door the native apps read (AGL-3854) say the same thing from one place.
 */

/** The longest brief a job admits. */
export const AI_BRIEF_MAX_CHARS = 4_000

/** The job kinds a member describes from a console page. */
export type AiBriefKind = Extract<
  AiJobKind,
  'page' | 'template' | 'layout' | 'form' | 'component' | 'email' | 'campaign'
>

/** What the dialog says for one kind. */
export interface AiBriefCopy {
  title: string
  /** The brief box's label. */
  briefLabel: string
  placeholder: string
  /** What happens after the member starts the job, under the fields. */
  next: string
  /** The action that starts the job. */
  submit: string
  /** What the dialog says once the job exists, above its live status. */
  started: string
  /** What it says when the door gave no reason, or could not be reached. */
  failed: string
}

export const AI_BRIEF_COPY: Readonly<Record<AiBriefKind, AiBriefCopy>> = {
  page: {
    title: 'Describe a page',
    briefLabel: 'What is the page for?',
    placeholder:
      'A landing page for our spring roof inspection offer, with the quote request form',
    next:
      'A plan comes first, and nothing is built until you confirm it. The page uses your ' +
      'theme and what the site already has, and the plan lists anything the job builds first.',
    submit: 'Plan the page',
    started:
      'The page is being planned. Review the plan here or in AI jobs, and confirm it to ' +
      'build. The page is built as an unpublished draft.',
    failed: 'The page could not be started. Try again.',
  },
  template: {
    title: 'Describe a page template',
    briefLabel: 'What should each page show?',
    placeholder:
      'A page for each of our team members: their name and photo, their role, a short ' +
      'biography and a way to get in touch',
    next:
      'A plan comes first, and nothing is built until you confirm it. What changes from one ' +
      'page to the next, such as a name or a photo, is filled in from each record rather ' +
      'than typed.',
    submit: 'Plan the template',
    started:
      'The template is being planned. Review the plan here or in AI jobs, and confirm it ' +
      'to build. The template is built as a draft in your library, and nothing on your ' +
      'site uses it until you do.',
    failed: 'The template could not be started. Try again.',
  },
  layout: {
    title: 'Describe a layout',
    briefLabel: 'What should the layout hold?',
    placeholder:
      'A header with our name and links to Services, About and Contact, and a footer with ' +
      'our address and opening hours',
    next:
      'A plan comes first, and nothing is built until you confirm it. The layout links your ' +
      'pages, and places your navigation or menu component when the site has one.',
    submit: 'Plan the layout',
    started:
      'The layout is being planned. Review the plan here or in AI jobs, and confirm it to ' +
      'build. The layout is built as a draft, and no page uses it until you assign it.',
    failed: 'The layout could not be started. Try again.',
  },
  form: {
    title: 'Describe a form',
    briefLabel: 'What is the form for?',
    placeholder:
      'A quote request form for a roofing company, asking what needs fixing and the best ' +
      'time to call',
    next:
      'A plan comes first, and nothing is built until you confirm it. The form’s fields, its ' +
      'marketing consent and where each submission goes are planned together.',
    submit: 'Plan the form',
    started:
      'The form is being planned. Review the plan here or in AI jobs, and confirm it to ' +
      'build. The form is built as a draft, and it collects nothing until you place it on ' +
      'a page.',
    failed: 'The form could not be started. Try again.',
  },
  component: {
    title: 'Describe a reusable component',
    briefLabel: 'What should the component show?',
    placeholder:
      'A testimonial card with the customer’s name, their role, their quote and a photo',
    next:
      'A plan comes first, and nothing is built until you confirm it. What each page can ' +
      'change, such as a name or a photo, becomes a property of the component.',
    submit: 'Plan the component',
    started:
      'The component is being planned. Review the plan here or in AI jobs, and confirm it ' +
      'to build. The component is built as a draft, and no page shows it until you insert ' +
      'it.',
    failed: 'The component could not be started. Try again.',
  },
  email: {
    title: 'Describe an email',
    briefLabel: 'What is the email for?',
    placeholder:
      'Announce the autumn menu to our regulars, and point them at the class page to book ' +
      'the Tuesday bread class',
    next:
      'A plan comes first, and nothing is built until you confirm it. The email is built ' +
      'from email blocks, with three subject lines and three preheaders to choose from. ' +
      'Nothing is sent or scheduled.',
    submit: 'Plan the email',
    started:
      'The email is being planned. Review the plan here or in AI jobs, and confirm it to ' +
      'build. The email is saved as a draft template, and nothing sends it until a ' +
      'campaign does.',
    failed: 'The email could not be started. Try again.',
  },
  campaign: {
    title: 'Describe a campaign',
    briefLabel: 'What is the campaign’s email for?',
    placeholder:
      'Announce the autumn menu to our regulars, and point them at the class page to book ' +
      'the Tuesday bread class',
    next:
      'A plan comes first, and nothing is built until you confirm it. The job writes the ' +
      'email and a draft campaign that would send it. The campaign is aimed at nobody and ' +
      'sends nothing until you pick who receives it and schedule it.',
    submit: 'Plan the campaign',
    started:
      'The campaign is being planned. Review the plan here or in AI jobs, and confirm it ' +
      'to build. The email and the campaign are saved as drafts, and nothing is sent.',
    failed: 'The campaign could not be started. Try again.',
  },
}

/**
 * The kinds of email a member picks from, as their chips name them. The jobs'
 * own catalog (`AI_EMAIL_TYPES`) also holds `reply`, which only a job the
 * platform composes sets, so it is not offered here.
 */
export const AI_EMAIL_TYPE_LABELS: Readonly<Record<Exclude<AiEmailType, 'reply'>, string>> = {
  welcome: 'Welcome',
  newsletter: 'Newsletter',
  launch: 'Launch',
  abandonedCart: 'Cart reminder',
  eventReminder: 'Event reminder',
}

/** Each template subject as its chip names it: what one page is drawn for. */
export const AI_TEMPLATE_SUBJECT_LABELS: Readonly<Record<AiTemplateSubject, string>> = {
  entry: 'Collection entry',
  product: 'Product',
  author: 'Author',
}

/** What a member picked beside the brief; each kind reads only its own. */
export interface AiBriefChoice {
  /** A page's type, or `null` for none. */
  pageType: AiPageType | null
  /** What a template's pages are drawn for, or `null` until one is picked. */
  subject: AiTemplateSubject | null
  /** A collection entry template's collection, or `null` until one is picked. */
  collectionId: string | null
  /** An email's or a campaign's kind of email; `null` or absent for none. */
  emailType?: Exclude<AiEmailType, 'reply'> | null
  /** An email's door only: also draft the campaign that would send it. */
  withCampaign?: boolean
}

export const AI_BRIEF_NO_CHOICE: AiBriefChoice = {
  pageType: null,
  subject: null,
  collectionId: null,
  emailType: null,
  withCampaign: false,
}

/**
 * The job the door starts: its own kind, except an email that also asked for
 * its campaign, which is a `campaign` job — the campaign step writes the same
 * design and drafts the campaign around it.
 */
export function aiBriefJobKind(kind: AiBriefKind, choice: AiBriefChoice): AiBriefKind {
  return kind === 'email' && choice.withCampaign ? 'campaign' : kind
}

/**
 * The job's `inputs` for what the member picked, or `null` while the kind's
 * door would refuse them.
 *
 * A template's are read by the parser its door reads, so the dialog cannot
 * send a subject the door does not know or an entry page with no collection.
 * A page's type is optional, and so is an email's or a campaign's kind of
 * email (`inputs.emailType`, which both steps read). A layout, a form and a component read no inputs
 * at all (AGL-2909, AGL-2913, AGL-2908), so theirs are empty.
 */
export function aiBriefJobInputs(
  kind: AiBriefKind,
  choice: AiBriefChoice,
): Record<string, string> | null {
  if (kind === 'page') return choice.pageType ? { pageType: choice.pageType } : {}
  if (kind === 'email' || kind === 'campaign') {
    return choice.emailType ? { emailType: choice.emailType } : {}
  }
  if (kind === 'template') {
    const inputs = parseAiTemplateJobInputs({
      subject: choice.subject,
      collectionId: choice.collectionId,
    })
    if (typeof inputs === 'string') return null
    return inputs.collectionId
      ? { subject: inputs.subject, collectionId: inputs.collectionId }
      : { subject: inputs.subject }
  }
  return {}
}
