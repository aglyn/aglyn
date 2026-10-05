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
 * THE CRM'S RECORDS AS THE IMPORT AND EXPORT SEE THEM (AGL-3527, AGL-3528).
 *
 * Every field a contact, a company, a lead, a deal and a task hold — the Salesforce standard fields
 * of CRM v4, the picklists, the links to other records, what the platform
 * stamps — as the transfer framework's `TransferField`s. Pure data: the
 * server half (`contacts.ts`, `companies.ts`) reads and writes records by
 * these ids, the AI's column matcher is told the same ids
 * (`model/record-facts.ts`), and the docs list them.
 *
 * ## A link to another record is a lookup
 *
 * A contact's company, the person they report to and their owner name
 * records. A file names them the way a person would — "Acme", `acme.com`,
 * `ana@acme.com` — and the job engine resolves each through the target's
 * own lookup (AGL-3541); an export writes the same words back, so a file
 * re-imports into the records it came from.
 *
 * ## An address is six columns
 *
 * Salesforce, HubSpot and every spreadsheet split an address into its
 * parts, so the file does too: `mailingStreet` … `mailingCountry`. The
 * record keeps one postal address; the server half composes it.
 *=========================================*/

import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ContactFieldDefinition,
  type CrmFieldObject,
  CRM_LEAD_SOURCE_PICKLIST,
  CRM_LEAD_STATUS_PICKLIST,
  CRM_OPPORTUNITY_TYPE_PICKLIST,
  CRM_SALUTATION_PICKLIST,
} from '@aglyn/aglyn/app-utils/crm'
import type {
  TransferCustomFieldDefinition,
  TransferField,
  TransferFieldGroup,
  TransferFieldType,
} from '@aglyn/aglyn/data-transfer'

/** The CRM's resource keys, as `plugins.config.json` declares them. */
export const CRM_CONTACTS_RESOURCE = 'crm.contacts'
export const CRM_COMPANIES_RESOURCE = 'crm.companies'

/**
 * The workspace's members, as an owner column names them: a lookup target
 * the CRM's resources answer themselves (`lookupTargets`), because no
 * resource imports members.
 */
export const CRM_MEMBERS_TARGET = 'crm.members'

/**
 * The lifecycle stages as a picklist the values step can match against: a
 * fixed list the platform defines, which an import maps onto and never adds
 * to.
 */
export const CRM_LIFECYCLE_STAGE_PICKLIST = 'crm.lifecycleStage'

/** The picklist a custom `select` field's options are matched as. */
export function crmCustomPicklistId(object: CrmFieldObject, key: string): string {
  return `custom.${object}.${key}`
}

/** The custom field a {@link crmCustomPicklistId} names, or `null`. */
export function crmCustomPicklistKey(picklistId: string): { object: string; key: string } | null {
  const match = /^custom\.([a-z]+)\.([a-z][a-z0-9_]*)$/.exec(picklistId)
  return match ? { object: match[1] as string, key: match[2] as string } : null
}

/** The stage a label (or an id, or a spelling between them) names, or `null`. */
export function crmLifecycleStageOf(value: unknown): (typeof CONTACT_LIFECYCLE_STAGES)[number] | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  const key = text.replace(/[\s_]+/g, '-')
  for (const stage of CONTACT_LIFECYCLE_STAGES) {
    if (stage === key || CONTACT_LIFECYCLE_STAGE_LABELS[stage].toLowerCase() === text) return stage
  }
  return null
}

/** A stage's place in the funnel, for "never backward"; `-1` for none. */
export function crmLifecycleStageRank(value: unknown): number {
  const stage = crmLifecycleStageOf(value)
  return stage ? (CONTACT_LIFECYCLE_STAGES as readonly string[]).indexOf(stage) : -1
}

/** The six parts of a postal address, as a file's columns name them. */
export const CRM_ADDRESS_PARTS = ['Street', 'Street2', 'City', 'State', 'PostalCode', 'Country'] as const
export type CrmAddressPart = (typeof CRM_ADDRESS_PARTS)[number]

/** The postal-address key each part is stored under. */
export const CRM_ADDRESS_PART_KEYS: Readonly<Record<CrmAddressPart, 'line1' | 'line2' | 'city' | 'state' | 'postalCode' | 'country'>> = {
  Street: 'line1',
  Street2: 'line2',
  City: 'city',
  State: 'state',
  PostalCode: 'postalCode',
  Country: 'country',
}

/** The six fields of one address: `<prefix>Street` … `<prefix>Country`. */
function addressFields(prefix: string, label: string, group: string): TransferField[] {
  const words: Record<CrmAddressPart, string> = {
    Street: 'street',
    Street2: 'street line 2',
    City: 'city',
    State: 'state or region',
    PostalCode: 'postal code',
    Country: 'country',
  }
  return CRM_ADDRESS_PARTS.map((part) => ({
    id: `${prefix}${part}`,
    label: `${label} ${words[part]}`,
    group,
    type: 'text' as const,
    maxLength: part === 'PostalCode' ? 32 : part === 'Country' ? 64 : 200,
    ...(part === 'Country' ? { description: 'A two-letter country code (US, GB, DE).' } : {}),
  }))
}

/** The field ids of one address. */
export function crmAddressFieldIds(prefix: string): string[] {
  return CRM_ADDRESS_PARTS.map((part) => `${prefix}${part}`)
}

/*==========================================
 * CONTACTS
 *=========================================*/

export const CONTACT_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'person', label: 'Person' },
  { id: 'phones', label: 'Phones' },
  { id: 'work', label: 'Work' },
  { id: 'mailing', label: 'Mailing address' },
  { id: 'otherAddress', label: 'Other address' },
  { id: 'crm', label: 'CRM' },
  { id: 'activity', label: 'Activity' },
]

/** A contact's own fields, in the order the picker lists them. */
export const CONTACT_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: 'email',
    label: 'Email',
    group: 'person',
    type: 'email',
    required: true,
    matchKey: true,
    aliases: ['email address', 'e-mail', 'e-mail address', 'contact email', 'primary email', 'work email'],
    description: 'Who the person is: a contact is found and kept by its email.',
  },
  {
    id: 'name',
    label: 'Full name',
    group: 'person',
    type: 'text',
    maxLength: 120,
    aliases: ['name', 'contact name', 'display name'],
    description: 'Built from the first and last names when either is set.',
  },
  {
    id: 'salutation',
    label: 'Salutation',
    group: 'person',
    type: 'picklist',
    picklistId: CRM_SALUTATION_PICKLIST,
    aliases: ['title prefix', 'prefix', 'honorific'],
  },
  { id: 'firstName', label: 'First name', group: 'person', type: 'text', maxLength: 120, aliases: ['given name', 'forename'] },
  { id: 'lastName', label: 'Last name', group: 'person', type: 'text', maxLength: 120, aliases: ['surname', 'family name'] },
  { id: 'birthdate', label: 'Birthdate', group: 'person', type: 'date', aliases: ['birthday', 'date of birth', 'dob'] },
  { id: 'phone', label: 'Phone', group: 'phones', type: 'phone', aliases: ['phone number', 'telephone', 'work phone', 'business phone'] },
  { id: 'mobilePhone', label: 'Mobile phone', group: 'phones', type: 'phone', aliases: ['mobile', 'cell', 'cell phone'] },
  { id: 'homePhone', label: 'Home phone', group: 'phones', type: 'phone' },
  { id: 'otherPhone', label: 'Other phone', group: 'phones', type: 'phone', aliases: ['alternate phone'] },
  { id: 'fax', label: 'Fax', group: 'phones', type: 'phone', aliases: ['fax number', 'business fax'] },
  {
    id: 'doNotCall',
    label: 'Do not call',
    group: 'phones',
    type: 'boolean',
    aliases: ['dnc', 'no calls'],
    description: 'A file can say a person asked not to be called; never that they took it back.',
  },
  { id: 'assistantName', label: 'Assistant', group: 'phones', type: 'text', maxLength: 120, aliases: ['assistant name'] },
  { id: 'assistantPhone', label: 'Assistant phone', group: 'phones', type: 'phone', aliases: ['asst. phone', 'asst phone'] },
  { id: 'jobTitle', label: 'Job title', group: 'work', type: 'text', maxLength: 120, aliases: ['title', 'position', 'role'] },
  { id: 'department', label: 'Department', group: 'work', type: 'text', maxLength: 120, aliases: ['dept'] },
  {
    id: 'company',
    label: 'Company',
    group: 'work',
    type: 'lookup',
    lookup: { resource: CRM_COMPANIES_RESOURCE, by: ['domain', 'name'], creatable: true },
    aliases: ['company name', 'organization', 'account', 'account name'],
    description: 'A company by its domain or name; one the CRM does not hold can be created.',
  },
  {
    id: 'reportsTo',
    label: 'Reports to',
    group: 'work',
    type: 'lookup',
    lookup: { resource: CRM_CONTACTS_RESOURCE, by: ['email'] },
    aliases: ['manager', 'reports to email'],
    description: 'Another contact, by email.',
  },
  ...addressFields('mailing', 'Mailing', 'mailing'),
  ...addressFields('other', 'Other', 'otherAddress'),
  {
    id: 'owner',
    label: 'Owner',
    group: 'crm',
    type: 'lookup',
    lookup: { resource: CRM_MEMBERS_TARGET, by: ['email', 'name'] },
    aliases: ['owner email', 'contact owner', 'assigned to'],
    description: 'A member of the workspace, by email or name.',
  },
  {
    id: 'lifecycleStage',
    label: 'Lifecycle stage',
    group: 'crm',
    type: 'picklist',
    picklistId: CRM_LIFECYCLE_STAGE_PICKLIST,
    aliases: ['stage', 'lifecycle'],
    description: 'Moves forward only.',
  },
  {
    id: 'leadSource',
    label: 'Lead source',
    group: 'crm',
    type: 'picklist',
    picklistId: CRM_LEAD_SOURCE_PICKLIST,
    aliases: ['source', 'original source'],
  },
  { id: 'tags', label: 'Tags', group: 'crm', type: 'tags', aliases: ['tag', 'labels', 'segments'] },
  { id: 'notes', label: 'Notes', group: 'crm', type: 'longText', maxLength: 2000, aliases: ['note', 'description', 'comments'] },
  {
    id: 'marketingConsent',
    label: 'Marketing consent',
    group: 'crm',
    type: 'boolean',
    aliases: ['consent', 'opt in', 'opted in', 'subscribed', 'email consent', 'email opt in'],
    description: 'Exported as it stands; never set from a file.',
  },
]

/** What only the platform writes about a contact: exported, never imported. */
export const CONTACT_TRANSFER_DERIVED: readonly TransferField[] = [
  { id: 'sources', label: 'Captured through', group: 'activity', type: 'tags', readOnly: true },
  { id: 'lastInteractionAt', label: 'Last interaction', group: 'activity', type: 'datetime', readOnly: true },
  { id: 'lastEngagedAt', label: 'Last engaged', group: 'activity', type: 'datetime', readOnly: true },
]

/** When the record was made and last changed. */
export const CRM_TIMESTAMP_FIELDS: readonly TransferField[] = [
  { id: 'createdAt', label: 'Created', type: 'datetime', readOnly: true },
  { id: 'updatedAt', label: 'Last updated', type: 'datetime', readOnly: true },
]

/*==========================================
 * COMPANIES
 *=========================================*/

export const COMPANY_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'company', label: 'Company' },
  { id: 'account', label: 'Account' },
  { id: 'billing', label: 'Billing address' },
  { id: 'shipping', label: 'Shipping address' },
  { id: 'crm', label: 'CRM' },
]

/** A company's own fields, in the order the picker lists them. */
export const COMPANY_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: 'name',
    label: 'Company name',
    group: 'company',
    type: 'text',
    required: true,
    matchKey: true,
    maxLength: 120,
    aliases: ['company', 'name', 'organization', 'account', 'account name'],
  },
  {
    id: 'domain',
    label: 'Domain',
    group: 'company',
    type: 'text',
    matchKey: true,
    maxLength: 253,
    aliases: ['company domain', 'domain name', 'web domain', 'email domain'],
    description: 'The web address without the protocol: acme.com.',
  },
  { id: 'website', label: 'Website', group: 'company', type: 'url', aliases: ['web site', 'url', 'website url', 'homepage'] },
  { id: 'phone', label: 'Phone', group: 'company', type: 'phone', aliases: ['phone number', 'company phone', 'main phone'] },
  { id: 'fax', label: 'Fax', group: 'company', type: 'phone', aliases: ['fax number', 'company fax'] },
  {
    id: 'parentCompany',
    label: 'Parent company',
    group: 'company',
    type: 'lookup',
    lookup: { resource: CRM_COMPANIES_RESOURCE, by: ['domain', 'name'], creatable: true },
    aliases: ['parent', 'parent account', 'parent company name'],
    description: 'Another company, by its domain or name; never this one or one under it.',
  },
  { id: 'type', label: 'Type', group: 'account', type: 'picklist', picklistId: 'accountType', aliases: ['account type', 'company type'] },
  { id: 'industry', label: 'Industry', group: 'account', type: 'picklist', picklistId: 'industry', aliases: ['sector', 'vertical'] },
  { id: 'rating', label: 'Rating', group: 'account', type: 'picklist', picklistId: 'rating', aliases: ['account rating'] },
  { id: 'ownership', label: 'Ownership', group: 'account', type: 'picklist', picklistId: 'ownership' },
  {
    id: 'accountSource',
    label: 'Account source',
    group: 'account',
    type: 'picklist',
    picklistId: CRM_LEAD_SOURCE_PICKLIST,
    aliases: ['lead source', 'source'],
  },
  { id: 'accountNumber', label: 'Account number', group: 'account', type: 'text', maxLength: 40, aliases: ['account no', 'account no.'] },
  { id: 'site', label: 'Account site', group: 'account', type: 'text', maxLength: 80 },
  { id: 'tickerSymbol', label: 'Ticker symbol', group: 'account', type: 'text', maxLength: 20, aliases: ['ticker', 'stock symbol'] },
  { id: 'sicCode', label: 'SIC code', group: 'account', type: 'text', maxLength: 20, aliases: ['sic'] },
  {
    id: 'numberOfEmployees',
    label: 'Employees',
    group: 'account',
    type: 'integer',
    aliases: ['number of employees', 'employee count', 'headcount'],
  },
  { id: 'annualRevenue', label: 'Annual revenue', group: 'account', type: 'currency', aliases: ['revenue'] },
  ...addressFields('billing', 'Billing', 'billing'),
  ...addressFields('shipping', 'Shipping', 'shipping'),
  {
    id: 'owner',
    label: 'Owner',
    group: 'crm',
    type: 'lookup',
    lookup: { resource: CRM_MEMBERS_TARGET, by: ['email', 'name'] },
    aliases: ['owner email', 'company owner', 'account owner', 'assigned to'],
    description: 'A member of the workspace, by email or name.',
  },
  { id: 'tags', label: 'Tags', group: 'crm', type: 'tags', aliases: ['tag', 'labels'] },
  { id: 'notes', label: 'Notes', group: 'crm', type: 'longText', maxLength: 4000, aliases: ['note', 'description', 'comments'] },
]

/** What only the platform writes about a company. */
export const COMPANY_TRANSFER_DERIVED: readonly TransferField[] = [
  { id: 'contactsCount', label: 'Contacts', group: 'crm', type: 'integer', readOnly: true },
]

/*==========================================
 * CUSTOM FIELDS
 *=========================================*/

/** How each custom field type is read from a file. */
const CUSTOM_TYPES: Readonly<Record<string, TransferFieldType>> = {
  text: 'text',
  number: 'number',
  date: 'date',
  select: 'picklist',
  checkbox: 'boolean',
  url: 'url',
}

/**
 * The organization's custom fields for one kind of record, as the catalog
 * takes them (`custom:<key>`): live definitions only, in their order, a
 * `select` matched as a picklist of its options.
 */
export function crmCustomTransferFields(
  definitions: ReadonlyArray<Pick<ContactFieldDefinition, 'key' | 'label' | 'type' | 'retiredAt' | 'order'>>,
  object: CrmFieldObject,
): TransferCustomFieldDefinition[] {
  return [...definitions]
    .filter((definition) => definition.key && !definition.retiredAt)
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || a.key.localeCompare(b.key))
    .map((definition) => ({
      key: definition.key,
      label: definition.label || definition.key,
      type: CUSTOM_TYPES[definition.type] ?? 'text',
      ...(definition.type === 'select' ? { picklistId: crmCustomPicklistId(object, definition.key) } : {}),
    }))
}

/*==========================================
 * LEADS (AGL-3528)
 *=========================================*/

export const CRM_LEADS_RESOURCE = 'crm.leads'
export const CRM_DEALS_RESOURCE = 'crm.deals'
export const CRM_TASKS_RESOURCE = 'crm.tasks'
export const CRM_ACTIVITIES_RESOURCE = 'crm.activities'
export const CRM_PIPELINES_RESOURCE = 'crm.pipelines'
export const CRM_FIELDS_RESOURCE = 'crm.fields'

/** The organization's live campaigns as a list a lead's campaign names are matched onto. */
export const CRM_CAMPAIGNS_PICKLIST = 'crm.campaigns'

/** Salesforce's forecast categories as a fixed list a value is matched onto. */
export const CRM_FORECAST_CATEGORY_PICKLIST = 'crm.forecastCategory'

export const LEAD_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'person', label: 'Person' },
  { id: 'company', label: 'Company' },
  { id: 'address', label: 'Address' },
  { id: 'crm', label: 'CRM' },
  { id: 'activity', label: 'Activity' },
]

/** A lead's own fields, in the order the picker lists them. */
export const LEAD_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: 'email',
    label: 'Email',
    group: 'person',
    type: 'email',
    required: true,
    matchKey: true,
    aliases: ['email address', 'e-mail', 'lead email', 'work email'],
    description: 'Who the person is: a lead is found and kept by its email.',
  },
  {
    id: 'name',
    label: 'Full name',
    group: 'person',
    type: 'text',
    maxLength: 120,
    aliases: ['name', 'lead name'],
    description: 'Built from the first and last names when either is set.',
  },
  { id: 'salutation', label: 'Salutation', group: 'person', type: 'picklist', picklistId: CRM_SALUTATION_PICKLIST, aliases: ['prefix'] },
  { id: 'firstName', label: 'First name', group: 'person', type: 'text', maxLength: 120, aliases: ['given name'] },
  { id: 'lastName', label: 'Last name', group: 'person', type: 'text', maxLength: 120, aliases: ['surname', 'family name'] },
  { id: 'jobTitle', label: 'Job title', group: 'person', type: 'text', maxLength: 120, aliases: ['title', 'position'] },
  { id: 'phone', label: 'Phone', group: 'person', type: 'phone', aliases: ['phone number', 'telephone'] },
  { id: 'mobilePhone', label: 'Mobile phone', group: 'person', type: 'phone', aliases: ['mobile', 'cell'] },
  { id: 'fax', label: 'Fax', group: 'person', type: 'phone' },
  {
    id: 'doNotCall',
    label: 'Do not call',
    group: 'person',
    type: 'boolean',
    description: 'A file can say a person asked not to be called; never that they took it back.',
  },
  {
    id: 'company',
    label: 'Company',
    group: 'company',
    type: 'text',
    maxLength: 120,
    aliases: ['company name', 'organization', 'account'],
    description: 'The company as text; converting the lead links or creates the company.',
  },
  { id: 'website', label: 'Website', group: 'company', type: 'url', aliases: ['url', 'web site'] },
  { id: 'industry', label: 'Industry', group: 'company', type: 'picklist', picklistId: 'industry' },
  { id: 'rating', label: 'Rating', group: 'company', type: 'picklist', picklistId: 'rating' },
  { id: 'numberOfEmployees', label: 'Employees', group: 'company', type: 'integer', aliases: ['number of employees', 'headcount'] },
  { id: 'annualRevenue', label: 'Annual revenue', group: 'company', type: 'currency', aliases: ['revenue'] },
  ...addressFields('address', 'Address', 'address'),
  {
    id: 'status',
    label: 'Status',
    group: 'crm',
    type: 'picklist',
    picklistId: CRM_LEAD_STATUS_PICKLIST,
    aliases: ['lead status'],
    description: 'Any status but Qualified, which converting the lead sets.',
  },
  {
    id: 'owner',
    label: 'Owner',
    group: 'crm',
    type: 'lookup',
    lookup: { resource: CRM_MEMBERS_TARGET, by: ['email', 'name'] },
    aliases: ['owner email', 'lead owner', 'assigned to'],
    description: 'A member of the workspace, by email or name.',
  },
  { id: 'leadSource', label: 'Lead source', group: 'crm', type: 'picklist', picklistId: CRM_LEAD_SOURCE_PICKLIST, aliases: ['source'] },
  {
    id: 'campaigns',
    label: 'Campaigns',
    group: 'crm',
    type: 'multiPicklist',
    picklistId: CRM_CAMPAIGNS_PICKLIST,
    description: 'Campaigns by name; added to the ones the lead is filed under.',
  },
  { id: 'tags', label: 'Tags', group: 'crm', type: 'tags', aliases: ['tag', 'labels'] },
  { id: 'unqualifiedReason', label: 'Unqualified reason', group: 'crm', type: 'text', maxLength: 120 },
  { id: 'notes', label: 'Notes', group: 'crm', type: 'longText', maxLength: 4000, aliases: ['note', 'description'] },
]

/** What only the platform records about a lead. */
export const LEAD_TRANSFER_DERIVED: readonly TransferField[] = [
  { id: 'sources', label: 'Captured through', group: 'activity', type: 'tags', readOnly: true },
  { id: 'firstSeenAt', label: 'First seen', group: 'activity', type: 'datetime', readOnly: true },
  { id: 'lastSeenAt', label: 'Last seen', group: 'activity', type: 'datetime', readOnly: true },
  { id: 'captures', label: 'Captures', group: 'activity', type: 'integer', readOnly: true },
  { id: 'convertedAt', label: 'Converted', group: 'activity', type: 'datetime', readOnly: true },
]

/*==========================================
 * DEALS (AGL-3528)
 *=========================================*/

export const DEAL_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'deal', label: 'Deal' },
  { id: 'people', label: 'People and companies' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'crm', label: 'CRM' },
]

/** A deal's own fields, in the order the picker lists them. */
export const DEAL_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'title', label: 'Deal name', group: 'deal', type: 'text', required: true, maxLength: 200, aliases: ['title', 'deal', 'opportunity', 'opportunity name'] },
  {
    id: 'externalId',
    label: 'External ID',
    group: 'deal',
    type: 'text',
    matchKey: true,
    maxLength: 200,
    aliases: ['external id', 'opportunity id', 'deal id'],
    description: 'The id another product gave the deal: an import finds the deal again by it.',
  },
  { id: 'pipeline', label: 'Pipeline', group: 'deal', type: 'text', description: 'By name; the default pipeline when blank.' },
  { id: 'stage', label: 'Stage', group: 'deal', type: 'text', aliases: ['deal stage'], description: 'By name; the pipeline’s first open stage when blank.' },
  { id: 'amount', label: 'Amount', group: 'deal', type: 'currency', aliases: ['value', 'deal value', 'deal amount'] },
  { id: 'expectedClose', label: 'Expected close', group: 'deal', type: 'date', aliases: ['close date', 'expected close date'] },
  { id: 'type', label: 'Type', group: 'deal', type: 'picklist', picklistId: CRM_OPPORTUNITY_TYPE_PICKLIST, aliases: ['deal type', 'opportunity type'] },
  { id: 'leadSource', label: 'Lead source', group: 'deal', type: 'picklist', picklistId: CRM_LEAD_SOURCE_PICKLIST, aliases: ['source'] },
  { id: 'nextStep', label: 'Next step', group: 'deal', type: 'text', maxLength: 255 },
  { id: 'lostReason', label: 'Lost reason', group: 'deal', type: 'text', maxLength: 500, aliases: ['closed lost reason'] },
  { id: 'notes', label: 'Notes', group: 'deal', type: 'longText', maxLength: 4000, aliases: ['description'] },
  {
    id: 'contact',
    label: 'Contact',
    group: 'people',
    type: 'lookup',
    lookup: { resource: CRM_CONTACTS_RESOURCE, by: ['email'] },
    aliases: ['contact email', 'primary contact', 'person'],
    description: 'The primary contact, by email.',
  },
  {
    id: 'company',
    label: 'Company',
    group: 'people',
    type: 'lookup',
    lookup: { resource: CRM_COMPANIES_RESOURCE, by: ['domain', 'name'], creatable: true },
    aliases: ['company name', 'account name', 'organization'],
    description: 'A company by its domain or name; one the CRM does not hold can be created.',
  },
  {
    id: 'contactRoles',
    label: 'Contact roles',
    group: 'people',
    type: 'text',
    description: 'Each contact by email with their role after them, the primary first: ana@acme.com (Decision Maker); bo@acme.com.',
  },
  {
    id: 'owner',
    label: 'Owner',
    group: 'crm',
    type: 'lookup',
    lookup: { resource: CRM_MEMBERS_TARGET, by: ['email', 'name'] },
    aliases: ['owner email', 'deal owner', 'opportunity owner'],
    description: 'A member of the workspace, by email or name.',
  },
  { id: 'campaign', label: 'Campaign', group: 'crm', type: 'text', aliases: ['primary campaign source'], description: 'A campaign by name.' },
  { id: 'probability', label: 'Probability', group: 'forecast', type: 'percent', aliases: ['probability (%)'] },
  { id: 'forecastCategory', label: 'Forecast category', group: 'forecast', type: 'picklist', picklistId: CRM_FORECAST_CATEGORY_PICKLIST },
]

/** What a deal's stage decides: exported, never written from a file. */
export const DEAL_TRANSFER_DERIVED: readonly TransferField[] = [
  { id: 'status', label: 'Status', group: 'deal', type: 'text', readOnly: true },
  { id: 'closedAt', label: 'Closed', group: 'deal', type: 'datetime', readOnly: true },
]

/*==========================================
 * TASKS (AGL-3528)
 *=========================================*/

export const TASK_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'task', label: 'Task' },
  { id: 'links', label: 'What it is for' },
]

/** A task's own fields, in the order the picker lists them. */
export const TASK_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'title', label: 'Subject', group: 'task', type: 'text', required: true, maxLength: 200, aliases: ['title', 'task', 'task name'] },
  {
    id: 'externalId',
    label: 'External ID',
    group: 'task',
    type: 'text',
    matchKey: true,
    maxLength: 200,
    aliases: ['external id', 'task id', 'activity id'],
    description: 'The id another product gave the task: an import finds the task again by it.',
  },
  { id: 'type', label: 'Type', group: 'task', type: 'picklist', picklistId: 'taskType', aliases: ['task type'] },
  { id: 'priority', label: 'Priority', group: 'task', type: 'picklist', picklistId: 'taskPriority' },
  { id: 'status', label: 'Status', group: 'task', type: 'picklist', picklistId: 'taskStatus', aliases: ['task status'] },
  { id: 'dueAt', label: 'Due', group: 'task', type: 'datetime', aliases: ['due date', 'due by', 'activity date'] },
  {
    id: 'assignee',
    label: 'Assigned to',
    group: 'task',
    type: 'lookup',
    lookup: { resource: CRM_MEMBERS_TARGET, by: ['email', 'name'] },
    aliases: ['assignee', 'owner', 'assigned to email'],
    description: 'A member of the workspace, by email or name.',
  },
  { id: 'notes', label: 'Notes', group: 'task', type: 'longText', maxLength: 4000, aliases: ['comments', 'description'] },
  {
    id: 'contact',
    label: 'Contact',
    group: 'links',
    type: 'lookup',
    lookup: { resource: CRM_CONTACTS_RESOURCE, by: ['email'] },
    aliases: ['contact email'],
    description: 'A contact, by email.',
  },
  {
    id: 'company',
    label: 'Company',
    group: 'links',
    type: 'lookup',
    lookup: { resource: CRM_COMPANIES_RESOURCE, by: ['domain', 'name'] },
    aliases: ['company name', 'account'],
    description: 'A company, by its domain or name.',
  },
  {
    id: 'deal',
    label: 'Deal',
    group: 'links',
    type: 'lookup',
    lookup: { resource: CRM_DEALS_RESOURCE, by: ['externalId', 'title'] },
    aliases: ['deal name', 'opportunity', 'related to'],
    description: 'A deal, by its external id or its name.',
  },
]

/** When a task was done: exported, never written from a file. */
export const TASK_TRANSFER_DERIVED: readonly TransferField[] = [
  { id: 'completedAt', label: 'Completed', group: 'task', type: 'datetime', readOnly: true },
]

/*==========================================
 * ACTIVITIES, PIPELINES AND FIELD DEFINITIONS — exported only (AGL-3528)
 *=========================================*/

export const ACTIVITY_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'links', label: 'What it is about' },
]

/** Everything an export of the team's logged work carries. Read-only: activities are logged, not imported. */
export const ACTIVITY_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'subject', label: 'Subject', group: 'activity', type: 'text', readOnly: true },
  { id: 'kind', label: 'Type', group: 'activity', type: 'text', readOnly: true },
  { id: 'direction', label: 'Direction', group: 'activity', type: 'text', readOnly: true },
  { id: 'at', label: 'When', group: 'activity', type: 'datetime', readOnly: true },
  { id: 'body', label: 'Details', group: 'activity', type: 'longText', readOnly: true },
  { id: 'outcome', label: 'Outcome', group: 'activity', type: 'text', readOnly: true },
  { id: 'durationMinutes', label: 'Minutes', group: 'activity', type: 'integer', readOnly: true },
  { id: 'by', label: 'Logged by', group: 'activity', type: 'text', readOnly: true },
  { id: 'to', label: 'To', group: 'activity', type: 'text', readOnly: true },
  { id: 'from', label: 'From', group: 'activity', type: 'text', readOnly: true },
  { id: 'deliveryState', label: 'Delivery', group: 'activity', type: 'text', readOnly: true },
  { id: 'contact', label: 'Contact', group: 'links', type: 'text', readOnly: true },
  { id: 'company', label: 'Company', group: 'links', type: 'text', readOnly: true },
  { id: 'deal', label: 'Deal', group: 'links', type: 'text', readOnly: true },
  { id: 'lead', label: 'Lead', group: 'links', type: 'text', readOnly: true },
]

export const PIPELINE_TRANSFER_GROUPS: readonly TransferFieldGroup[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'stage', label: 'Stage' },
]

/** One row per stage of every pipeline. Read-only: pipelines are set up on their own page. */
export const PIPELINE_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'pipeline', label: 'Pipeline', group: 'pipeline', type: 'text', readOnly: true },
  { id: 'pipelineId', label: 'Pipeline ID', group: 'pipeline', type: 'text', readOnly: true },
  { id: 'isDefault', label: 'Default pipeline', group: 'pipeline', type: 'boolean', readOnly: true },
  { id: 'archived', label: 'Archived', group: 'pipeline', type: 'boolean', readOnly: true },
  { id: 'stage', label: 'Stage', group: 'stage', type: 'text', readOnly: true },
  { id: 'stageId', label: 'Stage ID', group: 'stage', type: 'text', readOnly: true },
  { id: 'position', label: 'Position', group: 'stage', type: 'integer', readOnly: true },
  { id: 'kind', label: 'Kind', group: 'stage', type: 'text', readOnly: true },
  { id: 'probability', label: 'Probability', group: 'stage', type: 'percent', readOnly: true },
  { id: 'forecastCategory', label: 'Forecast category', group: 'stage', type: 'text', readOnly: true },
]

/** One row per custom field. Read-only: fields are defined on the Fields page. */
export const FIELD_DEFINITION_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'label', label: 'Name', type: 'text', readOnly: true },
  { id: 'key', label: 'Key', type: 'text', readOnly: true },
  { id: 'object', label: 'Record', type: 'text', readOnly: true },
  { id: 'type', label: 'Type', type: 'text', readOnly: true },
  { id: 'options', label: 'Choices', type: 'tags', readOnly: true },
  { id: 'required', label: 'Required', type: 'boolean', readOnly: true },
  { id: 'position', label: 'Position', type: 'integer', readOnly: true },
  { id: 'retired', label: 'Retired', type: 'boolean', readOnly: true },
]
