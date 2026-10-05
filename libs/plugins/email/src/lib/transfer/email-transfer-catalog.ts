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
 * WHAT THE EMAIL PLUGIN IMPORTS AND EXPORTS (AGL-3529) — the half both the
 * server and the console read: the resource keys, every field, the match
 * keys, the header spellings, the locked rules and the answers of the
 * plugin's own wizard steps.
 *
 * Two resources, both a site's:
 *
 *  - `email.list-members` — one list's members, one list at a time
 *    (`instances`: `email.list-members:<listId>`): an import is INTO one list
 *    and an export is OF one, and the console opens both from the list's page.
 *  - `email.suppressions` — the site's own suppression list. An import only
 *    ever ADDS: an address already on the list is left exactly as it is, and
 *    nothing — the import, its undo — ever removes one.
 *
 * Types only from the transfer core, so the console registrar that reads
 * this costs no transfer code.
 */

import type {
  MatchKeySpec,
  TransferAliasDictionary,
  TransferCatalogInput,
  TransferField,
  TransferLockedRule,
} from '@aglyn/aglyn/data-transfer'
import {
  LIST_IMPORT_EMAIL_COLUMNS,
  LIST_IMPORT_NAME_COLUMNS,
  LIST_IMPORT_OPT_IN_DATE_COLUMNS,
  LIST_IMPORT_OPT_IN_SOURCE_COLUMNS,
} from '../list-import'

/**
 * One list's members, imported into and exported from that list: declared
 * with `instances`, and reached per list as `email.list-members:<listId>`, so
 * a job, a person's remembered export fields and the one-running-import rule
 * each belong to one list.
 */
export const LIST_MEMBERS_RESOURCE = 'email.list-members'

/**
 * The resource key one list's members move under — the core's instance key
 * (`transferResourceInstanceKey`), spelled out so the list's page names it
 * without loading the transfer core; `email-transfer-catalog.spec.ts` holds
 * the two to the same answer.
 */
export function listMembersResourceKey(listId: string): string {
  return `${LIST_MEMBERS_RESOURCE}:${listId}`
}

/** The list a list-member resource key names, or `null` for any other key. */
export function listIdOfResourceKey(key: string): string | null {
  const prefix = `${LIST_MEMBERS_RESOURCE}:`
  const listId = String(key ?? '').startsWith(prefix) ? String(key).slice(prefix.length) : ''
  return /^[A-Za-z0-9_-]{1,128}$/.test(listId) ? listId : null
}

/** A site's suppression list. */
export const SUPPRESSIONS_RESOURCE = 'email.suppressions'

/*==========================================
 * THE PLUGIN'S OWN WIZARD STEPS
 *=========================================*/

/**
 * "People already on this list" — after Matching: whether the file may
 * change the contact details of people the workspace already holds.
 */
export const LIST_EXISTING_STEP_ID = 'email-existing'

/** "Permission" — after Conflicts: the statement of permission, with the screening. */
export const LIST_CONSENT_STEP_ID = 'email-consent'

/** The answer of the {@link LIST_EXISTING_STEP_ID} step. */
export interface ListExistingAnswer {
  /**
   * The file's contact columns may change the details of a person the
   * workspace already holds, under the field choices made in Conflicts.
   * Otherwise they fill only a contact the import creates, and somebody
   * already on the list is left exactly as they are.
   */
  updateContacts: boolean
}

/** The answer of the {@link LIST_CONSENT_STEP_ID} step. */
export interface ListConsentAnswer {
  /**
   * The operator states they have permission to email everyone in the file.
   * Without it only people with an opt-in on record are added.
   */
  attest: boolean
}

/**
 * The existing-people answer in `extras`, or the default — leave everybody
 * the workspace holds as they are. Anything but a literal `true` is no.
 */
export function readListExistingAnswer(
  extras: Readonly<Record<string, unknown>> | undefined,
): ListExistingAnswer {
  const value = extras?.[LIST_EXISTING_STEP_ID]
  return {
    updateContacts:
      !!value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>)['updateContacts'] === true,
  }
}

/**
 * The permission answer in `extras`, or `null` when the step was never
 * answered. Anything but a literal `true` is no statement at all.
 */
export function readListConsentAnswer(
  extras: Readonly<Record<string, unknown>> | undefined,
): ListConsentAnswer | null {
  const value = extras?.[LIST_CONSENT_STEP_ID]
  if (!value || typeof value !== 'object') return null
  const attest = (value as Record<string, unknown>)['attest']
  return typeof attest === 'boolean' ? { attest } : null
}

/** What the screening found, as the list's import ledger keeps it and the permission step shows it. */
export interface ListImportScreeningReport {
  roleAccounts: number
  roleAccountSamples: string[]
  purchaseTellColumns: string[]
  declaresBasis: boolean
  /** The consent gate over the first new addresses — a sample, with its size. */
  sample: { size: number; of: number; optedIn: number; needAttestation: number; refused: number }
}

/*==========================================
 * LIST MEMBERS
 *=========================================*/

/** A contact-record column's field id: `contact:<the record's own field name>`. */
export const CONTACT_FIELD_PREFIX = 'contact:'

/**
 * The contact record's fields a list file may carry, by the record's own
 * names — what the contact-capture door's `profile` takes. Written through
 * that door and never by this plugin (see `list-members.server.ts`).
 */
export const LIST_MEMBER_CONTACT_FIELDS: ReadonlyArray<{
  key: string
  label: string
  type: TransferField['type']
  aliases: readonly string[]
}> = [
  { key: 'firstName', label: 'First name', type: 'text', aliases: ['first name', 'firstname', 'given name', 'fname', 'FNAME'] },
  { key: 'lastName', label: 'Last name', type: 'text', aliases: ['last name', 'lastname', 'surname', 'family name', 'lname', 'LNAME'] },
  { key: 'phone', label: 'Phone', type: 'phone', aliases: ['phone', 'phone number', 'telephone', 'PHONE'] },
  { key: 'mobilePhone', label: 'Mobile phone', type: 'phone', aliases: ['mobile', 'mobile phone', 'cell', 'cell phone'] },
  { key: 'jobTitle', label: 'Job title', type: 'text', aliases: ['title', 'job title', 'position', 'role'] },
  { key: 'companyName', label: 'Company', type: 'text', aliases: ['company', 'company name', 'organization', 'employer'] },
  { key: 'department', label: 'Department', type: 'text', aliases: ['department', 'team'] },
]

/** The field id of a contact-record column. */
export function contactFieldId(key: string): string {
  return `${CONTACT_FIELD_PREFIX}${key}`
}

/** The contact record's own name for a field id, or `null` for a membership field. */
export function contactFieldKey(fieldId: string): string | null {
  return fieldId.startsWith(CONTACT_FIELD_PREFIX)
    ? fieldId.slice(CONTACT_FIELD_PREFIX.length)
    : null
}

/** Every contact-record field id, in catalog order. */
export const LIST_MEMBER_CONTACT_FIELD_IDS: readonly string[] =
  LIST_MEMBER_CONTACT_FIELDS.map((field) => contactFieldId(field.key))

/** The membership fields a file may write on a NEW member. */
export const LIST_MEMBER_WRITTEN_FIELDS = ['email', 'name', 'declaredSource', 'declaredAt'] as const

/** The groups, in picker order. */
const LIST_MEMBER_GROUPS = [
  { id: 'membership', label: 'Membership' },
  { id: 'evidence', label: 'Where the address came from' },
  { id: 'consent', label: 'Consent' },
  { id: 'contact', label: 'Contact record' },
]

/** One list's members: every field, for the wizard and the export dialog. */
export function listMemberCatalog(): TransferCatalogInput {
  return {
    groups: LIST_MEMBER_GROUPS,
    standard: [
      {
        id: 'email',
        label: 'Email',
        group: 'membership',
        type: 'email',
        required: true,
        matchKey: true,
        aliases: LIST_IMPORT_EMAIL_COLUMNS,
        description: 'Who the member is. A person is on a list once, by address.',
      },
      {
        id: 'name',
        label: 'Name',
        group: 'membership',
        type: 'text',
        maxLength: 120,
        aliases: LIST_IMPORT_NAME_COLUMNS,
        description: 'The name the list shows. Composed from the first and last name when only those are mapped.',
      },
      {
        id: 'declaredSource',
        label: 'Opt-in source',
        group: 'evidence',
        type: 'text',
        maxLength: 200,
        aliases: LIST_IMPORT_OPT_IN_SOURCE_COLUMNS,
        description: 'Where your file says the person signed up. Kept with your statement of permission, never as their own opt-in.',
      },
      {
        id: 'declaredAt',
        label: 'Opt-in date',
        group: 'evidence',
        type: 'text',
        maxLength: 60,
        aliases: LIST_IMPORT_OPT_IN_DATE_COLUMNS,
        description: 'When your file says the person signed up, kept as written.',
      },
      {
        id: 'addedAt',
        label: 'Added',
        group: 'membership',
        type: 'datetime',
        readOnly: true,
      },
      {
        id: 'source',
        label: 'Added through',
        group: 'membership',
        type: 'text',
        readOnly: true,
      },
      {
        id: 'via',
        label: 'How',
        group: 'membership',
        type: 'text',
        readOnly: true,
        description: '`rule` for a live list’s match, `manual` for everyone added another way.',
      },
      {
        id: 'consent',
        label: 'Consent',
        group: 'consent',
        type: 'text',
        readOnly: true,
        description: '`granted`, `declined` or `unrecorded`, as the site the list is worked as reads it.',
      },
      {
        id: 'consentBasis',
        label: 'Consent basis',
        group: 'consent',
        type: 'text',
        readOnly: true,
        description: '`contact-opt-in` when the person opted in, `operator-attested` when a member of your team stated permission.',
      },
      {
        id: 'consentAt',
        label: 'Consent recorded',
        group: 'consent',
        type: 'datetime',
        readOnly: true,
      },
      {
        id: 'consentReason',
        label: 'Consent note',
        group: 'consent',
        type: 'longText',
        readOnly: true,
      },
      ...LIST_MEMBER_CONTACT_FIELDS.map(
        (field): TransferField => ({
          id: contactFieldId(field.key),
          label: field.label,
          group: 'contact',
          type: field.type,
          aliases: field.aliases,
          maxLength: 120,
        }),
      ),
    ],
  }
}

/** A row finds its member by address, or by the member id an export carries. */
export const LIST_MEMBER_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'email', normalizer: 'email' },
  { fieldId: 'id', normalizer: 'aglynId' },
]

/**
 * Other products' list-export headers. Spellings only — every one of them
 * is read the same way as the platform's own.
 */
export const LIST_MEMBER_ALIASES: readonly TransferAliasDictionary[] = [
  {
    source: 'Mailchimp audience export',
    aliases: {
      email: ['Email Address'],
      [contactFieldId('firstName')]: ['First Name'],
      [contactFieldId('lastName')]: ['Last Name'],
      [contactFieldId('phone')]: ['Phone Number'],
      declaredAt: ['OPTIN_TIME', 'CONFIRM_TIME'],
    },
  },
  {
    source: 'Klaviyo list export',
    aliases: {
      email: ['Email'],
      [contactFieldId('firstName')]: ['First Name'],
      [contactFieldId('lastName')]: ['Last Name'],
      [contactFieldId('phone')]: ['Phone Number'],
      [contactFieldId('companyName')]: ['Organization'],
      [contactFieldId('jobTitle')]: ['Title'],
      declaredSource: ['Source', 'List Source'],
      declaredAt: ['Date Added', 'Consent Timestamp'],
    },
  },
  {
    source: 'Constant Contact export',
    aliases: {
      email: ['Email address'],
      [contactFieldId('firstName')]: ['First name'],
      [contactFieldId('lastName')]: ['Last name'],
      [contactFieldId('companyName')]: ['Company name'],
      [contactFieldId('jobTitle')]: ['Job title'],
      [contactFieldId('mobilePhone')]: ['Phone - mobile'],
      declaredSource: ['Source name'],
      declaredAt: ['Email permission date'],
    },
  },
]

/** Why somebody already on the list keeps their membership as it is. */
export const MEMBERSHIP_KEPT_REASON =
  'Somebody already on this list keeps their membership as it is: an import never re-enrolls them or rewrites what their membership records.'

/** Why a contact detail is never emptied by a file. */
export const CONTACT_NEVER_CLEARED_REASON =
  'An import adds and replaces contact details; a blank cell never empties one.'

/** Why the file holds no say over consent. */
export const CONSENT_FROM_FILE_REASON =
  'A file never says who agreed to hear from you. People with an opt-in on record keep it; anybody else is added only on your statement of permission, which is stored against your account; people who unsubscribed, bounced, complained or said no are never added.'

/** The list-member import's rules, shown locked in the wizard with their reasons. */
export const LIST_MEMBER_LOCKED_RULES: readonly TransferLockedRule[] = [
  {
    fieldId: 'email',
    forced: { mode: 'keepExisting' },
    reason: 'A member is their address: a row matched by its ID never moves the member to another one.',
  },
  ...(['name', 'declaredSource', 'declaredAt'] as const).map(
    (fieldId): TransferLockedRule => ({
      fieldId,
      forced: { mode: 'keepExisting' },
      reason: MEMBERSHIP_KEPT_REASON,
    }),
  ),
  { fieldId: 'consent', refuseValues: true, reason: CONSENT_FROM_FILE_REASON },
  ...LIST_MEMBER_CONTACT_FIELD_IDS.map(
    (fieldId): TransferLockedRule => ({
      fieldId,
      forced: { blank: 'leave' },
      reason: CONTACT_NEVER_CLEARED_REASON,
    }),
  ),
]

/*==========================================
 * SUPPRESSIONS
 *=========================================*/

/** Why an entry already on the list is left alone. */
export const SUPPRESSION_KEPT_REASON =
  'An address already suppressed keeps its entry exactly as it is — the reason and date it was suppressed with are the record of why — and an import never removes one.'

/** A site's suppression list: every field. */
export function suppressionCatalog(): TransferCatalogInput {
  return {
    groups: [{ id: 'suppression', label: 'Suppression' }],
    standard: [
      {
        id: 'email',
        label: 'Email',
        group: 'suppression',
        type: 'email',
        required: true,
        matchKey: true,
        aliases: LIST_IMPORT_EMAIL_COLUMNS,
      },
      {
        id: 'note',
        label: 'Note',
        group: 'suppression',
        type: 'text',
        maxLength: 200,
        aliases: ['note', 'notes', 'comment', 'why'],
        description: 'How the request reached you. Kept on a new entry only.',
      },
      {
        id: 'reason',
        label: 'Reason',
        group: 'suppression',
        type: 'text',
        readOnly: true,
        description: '`unsubscribe`, `bounce`, `complaint` or `manual`. An imported address is `manual`: a person on your team added it.',
      },
      {
        id: 'suppressedAt',
        label: 'Since',
        group: 'suppression',
        type: 'datetime',
        readOnly: true,
      },
      {
        id: 'carriedFromHostId',
        label: 'Copied from site',
        group: 'suppression',
        type: 'text',
        readOnly: true,
      },
    ],
  }
}

/** A suppression is the address. */
export const SUPPRESSION_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'email', normalizer: 'email' },
]

/** The suppression import's rule: nothing already on the list is changed. */
export const SUPPRESSION_LOCKED_RULES: readonly TransferLockedRule[] = [
  { fieldId: 'note', forced: { mode: 'keepExisting', blank: 'leave' }, reason: SUPPRESSION_KEPT_REASON },
]

/** Other products' suppression-export headers. */
export const SUPPRESSION_ALIASES: readonly TransferAliasDictionary[] = [
  {
    source: 'Mailchimp unsubscribed export',
    aliases: { email: ['Email Address'], note: ['UNSUB_REASON', 'UNSUB_REASON_OTHER'] },
  },
  {
    source: 'Klaviyo suppression export',
    aliases: { email: ['Email'], note: ['Suppression Reason'] },
  },
]
