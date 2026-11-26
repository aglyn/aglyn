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
  type ApiV1ResourceDescription,
  booleanField,
  integerField,
  isoField,
  nullableField,
  objectKindField,
  openObjectField,
  postalAddressField,
  queryParam,
  requiredQueryParam,
  RECORD_STAMPS,
  stringField,
  stringListField,
  UPDATED_AFTER_PARAM,
} from '@aglyn/tenant-data-admin/server/api-v1-description'

/**
 * The CRM's resources as the customer API's OpenAPI document describes them
 * (AGL-2733), keyed by the resource each describes — what the console's
 * builder turns into their paths, tags and schemas, and the MCP tools derive
 * from.
 *
 * Transcribed from the response examples in `apps/docs/api/resources/*.md`,
 * the customer-facing contract, as the platform's own resources are; each
 * write body lists its handler's own writable set. `api-v1-openapi.spec.ts`
 * holds the document to every endpoint the documentation promises.
 */
/** How a company picklist field reads in the description (AGL-3514). */
function companyPicklistNote(label: string, plural: string): string {
  return (
    `${label}: one of the organization's active ${plural} (CRM › Fields › Companies), matched ` +
    'without regard to case. Any other value is refused with a 400 naming the values allowed; ' +
    'the value a company already holds is kept even after it is deactivated.'
  )
}


/**
 * The site a lead belongs to (AGL-4225). A lead is a site's record and its id
 * is unique only within the site, so the handler refuses every lead request
 * without one — and until this was declared, a client reading the document
 * could not know to send it.
 */
const LEAD_SITE_PARAM = requiredQueryParam(
  'siteId',
  'Required. The site the lead belongs to — the `id` of a site from `listSites`.',
)

export const CRM_API_V1_DESCRIPTIONS: Readonly<Record<string, ApiV1ResourceDescription>> = {
  contacts: {
    tag: 'Contacts',
    docsPage: 'contacts',
    description: 'People, organization-wide. Part of the CRM, which is included from Starter.',
    schemaName: 'Contact',
    required: ['id', 'object', 'email'],
    writable: [
      'email', 'name', 'tags', 'notes', 'marketingConsent', 'consentSiteId', 'consentGroupId', 'custom',
      'phone', 'jobTitle', 'companyId', 'address', 'ownerUid', 'lifecycleStage', 'mediaIds',
      'leadSource',
      // Salesforce's standard contact fields (AGL-3515).
      'salutation', 'firstName', 'lastName', 'department', 'mobilePhone', 'homePhone', 'otherPhone',
      'fax', 'birthdate', 'assistantName', 'assistantPhone', 'reportsToContactId', 'otherAddress', 'doNotCall',
    ],
    writeOnly: {
      consentSiteId: stringField('The site this write is made on behalf of: where the person opted in, and whose profile the profile fields land on.'),
      consentGroupId: stringField('With `marketingConsent: true`: the consent group the person was shown when they opted in. The opt-in then covers every site of that group; without it, or when the site is no longer in that group, it covers `consentSiteId` alone.'),
      custom: openObjectField('Contact custom fields, keyed by field key.'),
      mediaIds: stringListField('Media library files attached by the named site, by id, at most 20. An empty array clears them.'),
    },
    writeNote: 'A create needs an `email`, a `name`, a `phone`, a `mobilePhone`, or a `firstName` or `lastName`. `email` is accepted on create only — a `PATCH` that names it is a `400`, because a contact is identified by its email.',
    fields: {
      id: stringField('Contact id.'),
      object: objectKindField('contact'),
      email: nullableField(
        stringField('Primary email, unique per organization, or `null` for a contact with no address yet.'),
      ),
      name: stringField('Display name.'),
      tags: stringListField('Free-form tags.'),
      notes: stringField('Free-form notes.'),
      marketingConsent: booleanField('Whether the contact accepted marketing email.'),
      consentSites: stringListField('Site ids the consent was given on.'),
      sources: stringListField('Where this contact came from.'),
      phone: stringField('Telephone number.'),
      jobTitle: stringField('Job title.'),
      companyId: nullableField(stringField('Primary company.')),
      address: postalAddressField(),
      ownerUid: nullableField(stringField('Owning user. Checked on the page, not the query.')),
      lifecycleStage: nullableField(stringField('CRM lifecycle stage.')),
      leadSource: nullableField(stringField('Lead source: one of the organization’s Lead source values (CRM › Fields › Leads), stored on the named site’s profile. A value the list does not hold is a `400` naming the values it allows.')),
      // Salesforce's standard contact fields (AGL-3515).
      salutation: nullableField(stringField("One of the organization's salutation values (Mr., Ms., Mrs., Dr., Prof. and its own).")),
      firstName: nullableField(stringField('First name. With `lastName`, it makes the name the named site shows.')),
      lastName: nullableField(stringField('Last name.')),
      department: nullableField(stringField('Department.')),
      mobilePhone: nullableField(stringField('Mobile phone, E.164.')),
      homePhone: nullableField(stringField('Home phone, E.164.')),
      otherPhone: nullableField(stringField('Other phone, E.164.')),
      fax: nullableField(stringField('Fax, E.164.')),
      birthdate: nullableField(stringField('Birthdate, `YYYY-MM-DD`, never in the future.')),
      assistantName: nullableField(stringField("Assistant's name.")),
      assistantPhone: nullableField(stringField("Assistant's phone, E.164.")),
      reportsToContactId: nullableField(stringField('The contact this person reports to. Never the contact itself, and never one that already reports to it.')),
      otherAddress: nullableField(postalAddressField()),
      doNotCall: booleanField('The person asked not to be phoned.'),
      companyIds: stringListField('Every company this contact belongs to.'),
      alternateEmails: stringListField('Other addresses that resolve to this contact.'),
      ...RECORD_STAMPS,
    },
    ops: [
      {
        path: '/v1/contacts', method: 'get', operationId: 'listContacts', summary: 'List contacts', list: true, returns: 'Contact', entitlement: 'crm',
        description: 'Lists the workspace’s contacts: one record per person, with email, name, phone, tags and per-site profile. Filter by exact `email` to find one person.',
        filters: [
          queryParam('email', 'The contact with this email address. Letter case is ignored; an address that cannot be read is refused.'),
          queryParam('tag', 'Contacts with this tag.'),
          queryParam('lifecycleStage', 'Contacts at this lifecycle stage.'),
          queryParam('ownerUid', 'Contacts owned by this workspace member.'),
        ],
      },
      // openWorld: after saving, the address’s mail domain is looked up (DNS) to flag addresses that would bounce.
      { path: '/v1/contacts', method: 'post', operationId: 'createContact', summary: 'Add a contact', accepts: 'ContactWrite', returns: 'Contact', entitlement: 'crm', creates: true, description: 'Adds a person to the workspace’s contacts. An email address is a contact’s identity: one that already belongs to a contact is refused, naming the existing contact’s id. Returns the new contact.', openWorld: true },
      { path: '/v1/contacts/{contactId}', method: 'get', operationId: 'getContact', summary: 'Get a contact', description: 'Returns one contact. Needs `contactId` from List contacts.', returns: 'Contact', entitlement: 'crm', pathParams: [{ name: 'contactId', description: 'Contact id.' }] },
      { path: '/v1/contacts/{contactId}', method: 'patch', operationId: 'updateContact', summary: 'Update a contact', description: 'Changes a contact’s details; fields not sent stay as they are. The email address cannot be changed. Needs `contactId` from List contacts. Returns the updated contact.', accepts: 'ContactWrite', returns: 'Contact', entitlement: 'crm', pathParams: [{ name: 'contactId', description: 'Contact id.' }] },
      { path: '/v1/contacts/{contactId}', method: 'delete', operationId: 'deleteContact', summary: 'Delete a contact', description: 'Removes a person from the workspace’s contacts, with the tags, notes, timeline and consent the workspace’s sites hold for them. Permanent. Needs `contactId` from List contacts.', returns: 'Deleted', entitlement: 'crm', pathParams: [{ name: 'contactId', description: 'Contact id.' }] },
      { path: '/v1/contacts/{contactId}/merge', method: 'post', operationId: 'mergeContact', summary: 'Merge two contacts', description: 'Folds one contact into another: the contact in `contactId` survives and keeps its email, and the contact named in `sourceContactId` is merged into it and deleted. Permanent. Returns the surviving contact.', accepts: 'ContactMerge', returns: 'Contact', entitlement: 'crm', destructive: true, pathParams: [{ name: 'contactId', description: 'The contact that survives.' }], idempotent: true },
    ],
    components: {
      ContactMerge: {
        type: 'object',
        required: ['sourceContactId'],
        description:
          'Merge another contact into this one. The source is removed. Any other ' +
          'member is a `400`.',
        properties: {
          sourceContactId: {
            type: 'string',
            description:
              'The contact to merge FROM. It does not survive, and it must not be ' +
              'the contact in the path.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  companies: {
    tag: 'Companies',
    docsPage: 'companies',
    description: 'Organizations in the CRM.',
    schemaName: 'Company',
    required: ['id', 'object', 'name'],
    writable: [
      'name', 'domain', 'website', 'phone', 'address', 'industry', 'ownerUid', 'notes', 'custom', 'mediaIds', 'consentSiteId',
      // Salesforce's Account fields (AGL-3514).
      'type', 'rating', 'ownership', 'accountSource', 'annualRevenueCents', 'currency', 'numberOfEmployees', 'fax',
      'accountNumber', 'site', 'tickerSymbol', 'sicCode', 'shippingAddress', 'parentCompanyId',
    ],
    writeOnly: {
      mediaIds: stringListField('Media library files attached to this company, by id, at most 20. An empty array clears them.'),
      consentSiteId: stringField('The site the company is created on behalf of.'),
    },
    writeNote: 'A create needs `name` and `consentSiteId`; a `PATCH` that names `consentSiteId` is a `400`.',
    fields: {
      id: stringField('Company id.'),
      object: objectKindField('company'),
      name: stringField('Company name.'),
      domain: nullableField(stringField('Primary domain. Unique per organization.')),
      website: nullableField(stringField('Website URL.')),
      phone: nullableField(stringField('Telephone number.')),
      address: { ...postalAddressField(), description: 'Billing address. Members are optional and free-form.' },
      industry: nullableField(stringField(companyPicklistNote('Industry', 'industries'))),
      // Salesforce's Account fields (AGL-3514).
      type: nullableField(stringField(companyPicklistNote('Account type', 'types'))),
      rating: nullableField(stringField(companyPicklistNote('Rating', 'ratings'))),
      ownership: nullableField(stringField(companyPicklistNote('Ownership', 'ownership values'))),
      accountSource: nullableField(
        stringField(
          "Where the account came from: one of the organization's active lead source values " +
            '(CRM › Fields › Leads), matched without regard to case. Any other value is refused ' +
            'with a 400 naming the values allowed; the value a company already holds is kept.',
        ),
      ),
      annualRevenueCents: nullableField(integerField('Annual revenue in the minor unit of `currency`, 0 or more.')),
      currency: stringField('Lowercase ISO 4217 code of the annual revenue. `usd` when unset.'),
      numberOfEmployees: nullableField(integerField('Number of employees, 0 to 99,999,999.')),
      fax: nullableField(stringField('E.164 fax number.')),
      accountNumber: nullableField(stringField('Account number, at most 40 characters.')),
      site: nullableField(stringField('Which of the company’s locations this record is, at most 80 characters.')),
      tickerSymbol: nullableField(stringField('Stock ticker symbol, at most 20 characters.')),
      sicCode: nullableField(stringField('Standard Industrial Classification code, at most 20 characters.')),
      shippingAddress: { ...postalAddressField(), description: 'Shipping address. Members are optional and free-form.' },
      parentCompanyId: nullableField(
        stringField('The company this one sits under. Never itself or a company below it; deleting the parent clears it.'),
      ),
      ownerUid: nullableField(stringField('Owning user.')),
      notes: nullableField(stringField('Free-form notes.')),
      custom: openObjectField('Customer-defined fields.'),
      nextTaskAt: nullableField(isoField('When the next open task on this company is due.')),
      siteId: nullableField(stringField('Site the record originated on.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/companies', method: 'get', operationId: 'listCompanies', summary: 'List companies', description: 'Lists the companies in the workspace’s CRM. Filter by exact `domain` to find one.', list: true, returns: 'Company', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, queryParam('domain', 'Exact match.'), queryParam('ownerUid', 'Owning user.')] },
      { path: '/v1/companies', method: 'post', operationId: 'createCompany', summary: 'Add a company', accepts: 'CompanyWrite', returns: 'Company', entitlement: 'crm', creates: true, description: 'Adds a company to the CRM. Needs a `name`. A company whose domain is already in the CRM is refused, naming the existing id. Returns the new company.', bodyRequires: ['name'] },
      { path: '/v1/companies/{companyId}', method: 'get', operationId: 'getCompany', summary: 'Get a company', description: 'Returns one company. Needs `companyId` from List companies.', returns: 'Company', entitlement: 'crm', pathParams: [{ name: 'companyId', description: 'Company id.' }] },
      { path: '/v1/companies/{companyId}', method: 'patch', operationId: 'updateCompany', summary: 'Update a company', description: 'Changes a company’s details; fields not sent stay as they are. Needs `companyId` from List companies. Returns the updated company.', accepts: 'CompanyWrite', returns: 'Company', entitlement: 'crm', pathParams: [{ name: 'companyId', description: 'Company id.' }] },
      { path: '/v1/companies/{companyId}', method: 'delete', operationId: 'deleteCompany', summary: 'Delete a company', description: 'Deletes a company permanently. Needs `companyId` from List companies.', returns: 'Deleted', entitlement: 'crm', pathParams: [{ name: 'companyId', description: 'Company id.' }] },
    ],
  },
  pipelines: {
    tag: 'Pipelines',
    docsPage: 'pipelines',
    description: 'Deal pipelines and their stages. Read-only over the API.',
    schemaName: 'Pipeline',
    required: ['id', 'object', 'name', 'stages'],
    fields: {
      id: stringField('Pipeline id.'),
      object: objectKindField('pipeline'),
      name: stringField('Pipeline name.'),
      isDefault: booleanField('Whether new deals land here when none is named.'),
      archived: booleanField('Whether the pipeline is archived.'),
      archivedAt: nullableField(isoField('When it was archived.')),
      stages: {
        type: 'array',
        description: 'Ordered stages. A deal’s `stageId` names one of these.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            order: { type: 'integer' },
            probability: { type: 'integer', description: 'Chance of closing from this stage, 0–100.' },
            kind: { type: 'string', enum: ['open', 'won', 'lost'] },
            forecastCategory: {
              type: 'string',
              enum: ['omitted', 'pipeline', 'bestCase', 'commit', 'closed'],
              description: 'The forecast category a deal takes on landing in this stage.',
            },
          },
          additionalProperties: true,
        },
      },
      siteId: nullableField(stringField('Site the pipeline belongs to, when scoped.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/pipelines', method: 'get', operationId: 'listPipelines', summary: 'List deal pipelines', description: 'Lists the workspace’s sales pipelines and their stages. A stage’s id is the `stageId` a deal takes.', list: true, returns: 'Pipeline', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM] },
      { path: '/v1/pipelines/{pipelineId}', method: 'get', operationId: 'getPipeline', summary: 'Get a deal pipeline', description: 'Returns one pipeline and its stages. Needs `pipelineId` from List deal pipelines.', returns: 'Pipeline', entitlement: 'crm', pathParams: [{ name: 'pipelineId', description: 'Pipeline id.' }] },
    ],
  },
  deals: {
    tag: 'Deals',
    docsPage: 'deals',
    description: 'Opportunities moving through a pipeline.',
    schemaName: 'Deal',
    required: ['id', 'object', 'title', 'pipelineId', 'stageId'],
    writable: ['title', 'pipelineId', 'stageId', 'status', 'amountCents', 'currency', 'lineItems', 'expectedCloseAt', 'ownerUid', 'contactId', 'companyId', 'lostReason', 'notes', 'custom', 'mediaIds', 'consentSiteId', 'type', 'leadSource', 'nextStep', 'probability', 'forecastCategory', 'campaignId', 'contactRoles'],
    writeOnly: {
      mediaIds: stringListField('Media library files attached to this deal, by id, at most 20. An empty array clears them.'),
      consentSiteId: stringField('The site the deal is created on behalf of.'),
    },
    writeNote:
      '`pipelineId` and `consentSiteId` are accepted on create only; a `PATCH` that names either is a `400`. ' +
      '`type` and `leadSource` must be active values of the organization’s lists (a deal keeps the value it holds). ' +
      'A stage move sets `forecastCategory` from the new stage and clears `probability`, unless the same body sets them. ' +
      '`contactRoles` replaces the whole list: each contact once, at most 50, at most one `primary`, each `role` an active value of the organization’s contact roles. ' +
      'The Primary is `contactId`: a body sending both must agree, and `contactId` alone makes that contact Primary.',
    fields: {
      id: stringField('Deal id.'),
      object: objectKindField('deal'),
      title: stringField('Deal title.'),
      pipelineId: stringField('Pipeline the deal sits in.'),
      stageId: stringField('Stage within that pipeline.'),
      status: stringField('`open`, `won` or `lost`.'),
      amountCents: integerField('Value in the smallest unit of `currency`.'),
      currency: stringField('ISO 4217 code.'),
      lineItems: { type: 'array', description: 'Line items, when the deal carries them.', items: { type: 'object', additionalProperties: true } },
      expectedCloseAt: nullableField(isoField('Forecast close date.')),
      closedAt: nullableField(isoField('When it was actually closed.')),
      stageChangedAt: nullableField(isoField('When the stage last moved.')),
      ownerUid: nullableField(stringField('Owning user.')),
      contactId: nullableField(stringField('Associated contact — the Primary of `contactRoles`.')),
      contactRoles: {
        type: 'array',
        description:
          'Every contact on the deal and the part each plays (Salesforce’s Opportunity Contact Roles). At most one is `primary`, and it is `contactId`.',
        items: {
          type: 'object',
          required: ['contactId', 'primary'],
          properties: {
            contactId: stringField('The contact.'),
            role: nullableField(stringField('One of the organization’s contact roles (Decision Maker, Evaluator, …), or `null` for none.')),
            primary: booleanField('Whether this is the deal’s Primary contact.'),
          },
        },
      },
      companyId: nullableField(stringField('Associated company.')),
      lostReason: nullableField(stringField('Why it was lost.')),
      notes: nullableField(stringField('Free-form notes.')),
      type: nullableField(stringField('Type — one of the organization’s deal types (New Business, Existing Business, …).')),
      leadSource: nullableField(stringField('Lead source — one of the organization’s lead sources.')),
      nextStep: nullableField(stringField('What happens next. At most 255 characters.')),
      probability: nullableField(integerField('This deal’s own chance of closing, 0–100; `null` uses its stage’s. A stage move clears it.')),
      forecastCategory: nullableField(stringField('`omitted`, `pipeline`, `bestCase`, `commit` or `closed`. Every stage move sets it from the new stage.')),
      campaignId: nullableField(stringField('The campaign the deal is attributed to.')),
      custom: openObjectField('Customer-defined fields.'),
      nextTaskAt: nullableField(isoField('When the next open task on this deal is due.')),
      siteId: nullableField(stringField('Site the record originated on.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/deals', method: 'get', operationId: 'listDeals', summary: 'List deals', description: 'Lists the workspace’s deals with their pipeline, stage, amount and status. Filter by pipeline, stage, status or owner.', list: true, returns: 'Deal', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, queryParam('pipelineId', 'Pipeline.'), queryParam('stageId', 'Stage.'), queryParam('status', 'Deal status.'), queryParam('ownerUid', 'Owning user.'), queryParam('type', 'Type, exactly as stored.'), queryParam('leadSource', 'Lead source, exactly as stored.'), queryParam('forecastCategory', 'Forecast category.'), queryParam('campaignId', 'Campaign.')] },
      { path: '/v1/deals', method: 'post', operationId: 'createDeal', summary: 'Add a deal', description: 'Opens a deal. Needs a `title`; `pipelineId` and `stageId` come from List deal pipelines. Returns the new deal.', accepts: 'DealWrite', returns: 'Deal', entitlement: 'crm', creates: true, bodyRequires: ['title'] },
      { path: '/v1/deals/{dealId}', method: 'get', operationId: 'getDeal', summary: 'Get a deal', description: 'Returns one deal. Needs `dealId` from List deals.', returns: 'Deal', entitlement: 'crm', pathParams: [{ name: 'dealId', description: 'Deal id.' }] },
      { path: '/v1/deals/{dealId}', method: 'patch', operationId: 'updateDeal', summary: 'Update a deal', description: 'Changes a deal, including moving it to another stage or marking it won or lost; fields not sent stay as they are. Needs `dealId` from List deals. Returns the updated deal.', accepts: 'DealWrite', returns: 'Deal', entitlement: 'crm', pathParams: [{ name: 'dealId', description: 'Deal id.' }] },
      { path: '/v1/deals/{dealId}', method: 'delete', operationId: 'deleteDeal', summary: 'Delete a deal', description: 'Deletes a deal permanently. Needs `dealId` from List deals.', returns: 'Deleted', entitlement: 'crm', pathParams: [{ name: 'dealId', description: 'Deal id.' }] },
    ],
  },
  tasks: {
    tag: 'Tasks',
    docsPage: 'tasks',
    description: 'Follow-ups attached to CRM records.',
    schemaName: 'Task',
    required: ['id', 'object', 'title'],
    writable: ['title', 'notes', 'kind', 'priority', 'status', 'dueAt', 'remindAt', 'assigneeUid', 'contactId', 'companyId', 'dealId', 'consentSiteId'],
    writeOnly: {
      consentSiteId: stringField('The site the task is created on behalf of.'),
    },
    writeNote: 'A create needs `title` and `consentSiteId`; a `PATCH` that names `consentSiteId` is a `400`.',
    fields: {
      id: stringField('Task id.'),
      object: objectKindField('task'),
      title: stringField('Task title.'),
      notes: nullableField(stringField('Free-form notes.')),
      kind: stringField('Task type as its meaning: `call`, `email`, `meeting` or `todo`. A write takes the meaning or a label of the Type picklist.'),
      typeLabel: stringField('The organization’s Type picklist label, e.g. `Call`. Read-only; set through `kind`.'),
      priority: stringField('`low`, `normal` or `high`. A write takes the meaning or a label of the Priority picklist.'),
      priorityLabel: stringField('The organization’s Priority picklist label, e.g. `High`. Read-only; set through `priority`.'),
      status: stringField('`open` or `done`. A write takes the meaning or a label of the Status picklist, e.g. `In Progress`.'),
      statusLabel: stringField('The organization’s Status picklist label, e.g. `Not Started`. Read-only; set through `status`.'),
      dueAt: nullableField(isoField('When the task is due.')),
      remindAt: nullableField(isoField('When a reminder is scheduled.')),
      reminderSentAt: nullableField(isoField('When the reminder was sent.')),
      completedAt: nullableField(isoField('When it was completed.')),
      assigneeUid: nullableField(stringField('Assigned user.')),
      contactId: nullableField(stringField('Associated contact.')),
      companyId: nullableField(stringField('Associated company.')),
      dealId: nullableField(stringField('Associated deal.')),
      siteId: nullableField(stringField('Site the record originated on.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/tasks', method: 'get', operationId: 'listTasks', summary: 'List tasks', description: 'Lists the workspace’s CRM tasks. Filter by status, assignee, contact or deal.', list: true, returns: 'Task', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, queryParam('status', 'Task status.'), queryParam('assigneeUid', 'Assigned user.'), queryParam('contactId', 'Associated contact.'), queryParam('dealId', 'Associated deal.')] },
      { path: '/v1/tasks', method: 'post', operationId: 'createTask', summary: 'Add a task', description: 'Creates a task, such as a follow-up, with a `title` and optionally a due date, a reminder and the contact, company or deal it is about. Returns the new task.', accepts: 'TaskWrite', returns: 'Task', entitlement: 'crm', creates: true, bodyRequires: ['title'] },
      { path: '/v1/tasks/{taskId}', method: 'get', operationId: 'getTask', summary: 'Get a task', description: 'Returns one task. Needs `taskId` from List tasks.', returns: 'Task', entitlement: 'crm', pathParams: [{ name: 'taskId', description: 'Task id.' }] },
      { path: '/v1/tasks/{taskId}', method: 'patch', operationId: 'updateTask', summary: 'Update a task', description: 'Changes a task, including marking it done; fields not sent stay as they are. Needs `taskId` from List tasks. Returns the updated task.', accepts: 'TaskWrite', returns: 'Task', entitlement: 'crm', pathParams: [{ name: 'taskId', description: 'Task id.' }] },
      { path: '/v1/tasks/{taskId}', method: 'delete', operationId: 'deleteTask', summary: 'Delete a task', description: 'Deletes a task permanently. Needs `taskId` from List tasks.', returns: 'Deleted', entitlement: 'crm', pathParams: [{ name: 'taskId', description: 'Task id.' }] },
    ],
  },
  activities: {
    tag: 'Activities',
    docsPage: 'activities',
    description: 'Logged interactions. Append-only, except that a call or a meeting takes its recording and transcript afterwards (PATCH).',
    schemaName: 'Activity',
    required: ['id', 'object', 'kind', 'at'],
    writable: ['kind', 'body', 'at', 'byUid', 'contactId', 'companyId', 'dealId', 'outcome', 'durationMinutes', 'direction', 'mediaIds', 'transcript', 'consentSiteId'],
    writeOnly: {
      consentSiteId: stringField('The site the activity is logged on behalf of.'),
    },
    writeRequired: ['body', 'consentSiteId'],
    fields: {
      id: stringField('Activity id.'),
      object: objectKindField('activity'),
      kind: stringField('What happened, e.g. `call`, `email`, `note`.'),
      body: stringField('Free-form body.'),
      at: isoField('When the interaction happened — not when it was logged.'),
      byUid: nullableField(stringField('User who logged it.')),
      contactId: nullableField(stringField('Associated contact.')),
      companyId: nullableField(stringField('Associated company. When none is sent, the company of the deal, else of the contact.')),
      dealId: nullableField(stringField('Associated deal.')),
      outcome: nullableField(stringField('Outcome label.')),
      durationMinutes: nullableField(integerField('Duration, for calls and meetings.')),
      direction: nullableField(stringField('Which way it went: `inbound`, `outbound` or `internal` for a call, `inbound` or `outbound` for an email.')),
      mediaIds: stringListField('A call’s or a meeting’s recordings: media library files by id, at most 5. Upload the audio first with Upload a file to the media library (`private: true`, `purpose: "callRecording"`).'),
      transcript: nullableField(stringField('What was said, as text, for a call or a meeting; at most 200,000 characters. Searchable with the body.')),
      siteId: nullableField(stringField('Site the record originated on.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/activities', method: 'get', operationId: 'listActivities', summary: 'List activities', description: 'Lists the calls, emails, meetings and notes logged in the CRM. Filter by kind, contact or deal.', list: true, returns: 'Activity', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, queryParam('kind', 'Activity kind.'), queryParam('contactId', 'Associated contact.'), queryParam('dealId', 'Associated deal.')] },
      { path: '/v1/activities', method: 'post', operationId: 'createActivity', summary: 'Log an activity', description: 'Records a call, email, meeting or note against a contact, company or deal. Needs the activity’s text in `body`. Returns the logged activity. Logging an email records it; it does not send one.', accepts: 'ActivityWrite', returns: 'Activity', entitlement: 'crm', creates: true },
      { path: '/v1/activities/{activityId}', method: 'get', operationId: 'getActivity', summary: 'Get an activity', description: 'Returns one logged activity. Needs `activityId` from List activities.', returns: 'Activity', entitlement: 'crm', pathParams: [{ name: 'activityId', description: 'Activity id.' }] },
      { path: '/v1/activities/{activityId}', method: 'patch', operationId: 'updateActivity', summary: 'Attach a recording or transcript to an activity', description: 'Attaches a call’s or a meeting’s recording (`mediaIds`) and its `transcript` after it was logged; nothing else about the activity changes, and `null` or `[]` removes them. Needs `activityId` from List activities. Upload the audio first with Upload a file to the media library. Returns the activity.', accepts: 'ActivityRecordingWrite', returns: 'Activity', entitlement: 'crm', pathParams: [{ name: 'activityId', description: 'Activity id.' }] },
      { path: '/v1/activities/{activityId}', method: 'delete', operationId: 'deleteActivity', summary: 'Delete an activity', description: 'Deletes a logged activity permanently. Needs `activityId` from List activities.', returns: 'Deleted', entitlement: 'crm', pathParams: [{ name: 'activityId', description: 'Activity id.' }] },
    ],
    components: {
      ActivityRecordingWrite: {
        type: 'object',
        description:
          'What a call or a meeting takes after it was logged. Any other member is a `400`.',
        properties: {
          mediaIds: {
            type: ['array', 'null'],
            items: { type: 'string' },
            maxItems: 5,
            description: 'Media library files by id, at most 5. `null` or `[]` removes them.',
          },
          transcript: {
            type: ['string', 'null'],
            maxLength: 200000,
            description: 'What was said, as text. `null` or an empty string removes it.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  leads: {
    tag: 'Leads',
    docsPage: 'leads',
    description: 'Unqualified interest, before it becomes a contact. A lead is a record of its own: the person and their company as text, until converting makes the contact and the company.',
    schemaName: 'Lead',
    required: ['id', 'object', 'siteId'],
    writable: [
      'siteId', 'email', 'name', 'status', 'ownerUid', 'ownerEmail', 'notes', 'unqualifiedReason', 'company', 'jobTitle', 'phone', 'website', 'address', 'tags', 'leadSource',
      // Salesforce's standard lead fields (AGL-3513).
      'salutation', 'firstName', 'lastName', 'mobilePhone', 'fax', 'doNotCall', 'industry', 'rating', 'annualRevenueCents', 'currency', 'numberOfEmployees',
    ],
    writeNote: '`email` and `name` are taken on a create only; a `PATCH` cannot change the address, which is the lead’s identity within its site. While `firstName` or `lastName` is set, `name` is their composition, "First Last", and follows them.',
    writeRequired: ['email'],
    writeOnly: {
      siteId: stringField('The site the lead belongs to, instead of the `siteId` query parameter.'),
      status: stringField('One of the organization’s active lead status values by its label (CRM › Fields › Leads), or a meaning — `new`, `nurturing`, `working` or `unqualified` (`nurturing` and `unqualified` on a `PATCH` only). Stored as the meaning and the label together. A lead becomes `qualified` by being converted.'),
      ownerEmail: stringField('A member’s address, resolved against the organization’s roster. Not with `ownerUid` in the same request.'),
    },
    fields: {
      id: stringField('Lead id.'),
      object: objectKindField('lead'),
      siteId: stringField('Site the lead arrived on.'),
      email: nullableField(stringField('Email — the lead’s identity within its site.')),
      name: nullableField(stringField('Name, when supplied.')),
      status: stringField('What the lead status means: `new`, `nurturing`, `working`, `qualified` or `unqualified`. What every filter and automation reads.'),
      statusLabel: stringField('The organization’s label for the lead status value the lead holds — one of `status`’s meaning. Read-only; set it through `status`.'),
      ownerUid: nullableField(stringField('Owning user.')),
      notes: nullableField(stringField('Free-form notes.')),
      unqualifiedReason: nullableField(stringField('Why the lead was disqualified.')),
      company: nullableField(stringField('The company’s name, as text. Converting the lead is what links or creates the company record.')),
      jobTitle: nullableField(stringField('Job title.')),
      phone: nullableField(stringField('E.164 phone number.')),
      website: nullableField(stringField('An http(s) URL.')),
      address: nullableField(postalAddressField()),
      tags: stringListField('Lower-cased tags.'),
      leadSource: nullableField(
        stringField(
          "Where the lead came from: one of the organization's active lead source values " +
            '(CRM › Fields › Leads), matched without regard to case. Any other value is refused ' +
            'with a 400 naming the values allowed; the value a lead already holds is kept even ' +
            "after it is deactivated. A create that names none starts from the list's default.",
        ),
      ),
      // Salesforce's standard lead fields (AGL-3513).
      salutation: nullableField(stringField('Salutation: one of the organization’s active Salutation values (CRM › Fields › Contacts), matched without regard to case. Any other value is a `400` naming the values allowed; the value a lead already holds is kept.')),
      firstName: nullableField(stringField('First name, at most 59 characters. While it or `lastName` is set, `name` is "First Last".')),
      lastName: nullableField(stringField('Last name, at most 59 characters.')),
      mobilePhone: nullableField(stringField('E.164 mobile phone number.')),
      fax: nullableField(stringField('E.164 fax number.')),
      doNotCall: booleanField('The person asked not to be phoned. A hint on every call control, never a block. `false` clears it.'),
      industry: nullableField(stringField('Industry: one of the organization’s active Industry values (CRM › Fields › Companies) — the list companies keep, so converting carries it. Any other value is a `400` naming the values allowed; the value a lead already holds is kept.')),
      rating: nullableField(stringField('Rating: one of the organization’s active Rating values (CRM › Fields › Companies). Any other value is a `400` naming the values allowed.')),
      annualRevenueCents: nullableField(integerField('Annual revenue in the minor unit of `currency`, 0 or more.')),
      currency: stringField('Lowercase ISO 4217 code of the annual revenue. `usd` when unset.'),
      numberOfEmployees: nullableField(integerField('Number of employees, 0 to 99,999,999.')),
      sources: stringListField('The surfaces that captured the lead: `signup`, `booking`, `form:{formId}`, `import`, `manual`, `api`.'),
      submissionCount: integerField('How many form submissions this lead has made.'),
      firstSeen: isoField('First interaction.'),
      lastSeen: isoField('Most recent interaction.'),
      marketingConsent: booleanField('Whether marketing consent was given.'),
      marketingConsentAt: nullableField(isoField('When consent was given.')),
      convertedContactId: nullableField(stringField('Contact created by conversion.')),
      convertedAt: nullableField(isoField('When it was converted.')),
      companyId: nullableField(stringField('Company created or matched by conversion.')),
      dealId: nullableField(stringField('Deal created by conversion.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/leads', method: 'get', operationId: 'listLeads', summary: 'List a site’s leads', description: 'Lists the leads one site has captured, not yet converted into contacts. Needs `siteId` from List sites. Filter by status or owner.', list: true, returns: 'Lead', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, LEAD_SITE_PARAM, queryParam('status', 'Lead status.'), queryParam('ownerUid', 'Owning user.')] },
      // openWorld: after saving, the address’s mail domain is looked up (DNS) to flag addresses that would bounce.
      // destructive: adding an address the site already holds updates that lead, so it can overwrite what was there.
      { path: '/v1/leads', method: 'post', operationId: 'createLead', summary: 'Add a lead to a site', accepts: 'LeadWrite', returns: 'Lead', entitlement: 'crm', creates: true, description: 'Adds a lead to one site. Needs `siteId` from List sites and the lead’s `email`. One email is one lead per site: adding an address the site already holds updates that lead. No contact is created until the lead is converted. Returns the lead.', idempotent: true, openWorld: true, destructive: true, bodyRequires: ['siteId', 'email'] },
      { path: '/v1/leads/{leadId}', method: 'get', operationId: 'getLead', summary: 'Get a lead', description: 'Returns one lead. Needs `siteId` from List sites and `leadId` from List a site’s leads.', returns: 'Lead', entitlement: 'crm', pathParams: [{ name: 'leadId', description: 'Lead id.' }], filters: [LEAD_SITE_PARAM] },
      { path: '/v1/leads/{leadId}', method: 'patch', operationId: 'updateLead', summary: 'Update a lead', description: 'Changes a lead, including its status; fields not sent stay as they are. Needs `siteId` from List sites and `leadId` from List a site’s leads. Returns the updated lead.', accepts: 'LeadWrite', returns: 'Lead', entitlement: 'crm', pathParams: [{ name: 'leadId', description: 'Lead id.' }], filters: [LEAD_SITE_PARAM] },
      // openWorld: the contact it creates has its mail domain looked up (DNS) to flag addresses that would bounce.
      { path: '/v1/leads/{leadId}/convert', method: 'post', operationId: 'convertLead', summary: 'Convert a lead into a contact', accepts: 'LeadConvertRequest', bodyOptional: true, returns: 'LeadConversion', entitlement: 'crm', description: 'Turns a lead into a contact, joining an existing contact with the same email, and can also link or create a company and open a deal. Needs `siteId` from List sites and `leadId` from List a site’s leads. Converting a lead again returns the same ids.', pathParams: [{ name: 'leadId', description: 'Lead id.' }], idempotent: true, openWorld: true, filters: [LEAD_SITE_PARAM] },
    ],
    components: {
      LeadConvertRequest: {
        type: 'object',
        description:
          'Optional. What else the conversion does besides creating the contact. ' +
          'Leave it out to convert the lead into a contact alone.',
        properties: {
          company: {
            type: ['object', 'null'],
            description:
              'A company for the contact: `{ "link": "<companyId>" }` to link one from List companies, ' +
              '`{ "create": { "name": "…", "domain": "…" } }` to add one (an existing company with that ' +
              'name or domain is reused), or null for none.',
          },
          deal: {
            type: ['object', 'null'],
            description:
              'A deal to open in the default pipeline: `{ "title": "…", "amountCents": 12500, "currency": ' +
              '"usd", "stageId": "…", "type": "…" }`. `title` is required; the rest is optional. Null for none.',
          },
          ownerUid: { type: 'string', description: 'Workspace member who owns the contact and the deal. Defaults to the lead’s owner.' },
          ownerEmail: { type: 'string', description: 'The owner by email address, instead of `ownerUid`.' },
        },
        additionalProperties: false,
      },
      LeadConversion: {
        type: 'object',
        description:
          'What the conversion produced: the contact, and the company and deal ' +
          'when it made or linked them. Converting the same lead again returns ' +
          'the same ids.',
        properties: {
          object: { type: 'string', const: 'lead_conversion' },
          contactId: { type: 'string' },
          companyId: { type: ['string', 'null'] },
          dealId: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
    },
  },
  'email-templates': {
    tag: 'Email templates',
    docsPage: 'email-templates',
    description: 'Reusable email bodies.',
    schemaName: 'EmailTemplate',
    required: ['id', 'object', 'name'],
    writable: ['name', 'kind', 'visibility', 'ownerUid', 'subject', 'body', 'consentSiteId'],
    writeOnly: {
      consentSiteId: stringField('The site the template is created on behalf of.'),
    },
    writeNote: 'A create needs `name`, `body` and `consentSiteId`; a `PATCH` that names `consentSiteId` is a `400`.',
    fields: {
      id: stringField('Template id.'),
      object: objectKindField('email_template'),
      name: stringField('Template name.'),
      kind: stringField('Template kind.'),
      visibility: stringField('`org` or `private`.'),
      ownerUid: nullableField(stringField('Owner, for a private template.')),
      subject: stringField('Subject line.'),
      body: stringField('Body. May contain merge tokens.'),
      siteId: nullableField(stringField('Site the template belongs to, when scoped.')),
      ...RECORD_STAMPS,
    },
    ops: [
      { path: '/v1/email-templates', method: 'get', operationId: 'listEmailTemplates', summary: 'List email templates', description: 'Lists the workspace’s saved email templates with their name, subject and kind.', list: true, returns: 'EmailTemplate', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, queryParam('kind', 'Template kind.'), queryParam('visibility', 'Visibility.')] },
      { path: '/v1/email-templates', method: 'post', operationId: 'createEmailTemplate', summary: 'Add an email template', description: 'Saves a reusable email with a `name`, a subject and the message in `body`. Saving a template sends nothing. Returns the new template.', accepts: 'EmailTemplateWrite', returns: 'EmailTemplate', entitlement: 'crm', creates: true, bodyRequires: ['name', 'body'] },
      { path: '/v1/email-templates/{templateId}', method: 'get', operationId: 'getEmailTemplate', summary: 'Get an email template', description: 'Returns one email template. Needs `templateId` from List email templates.', returns: 'EmailTemplate', entitlement: 'crm', pathParams: [{ name: 'templateId', description: 'Template id.' }] },
      { path: '/v1/email-templates/{templateId}', method: 'patch', operationId: 'updateEmailTemplate', summary: 'Update an email template', description: 'Changes a template; fields not sent stay as they are. Needs `templateId` from List email templates. Returns the updated template.', accepts: 'EmailTemplateWrite', returns: 'EmailTemplate', entitlement: 'crm', pathParams: [{ name: 'templateId', description: 'Template id.' }] },
      { path: '/v1/email-templates/{templateId}', method: 'delete', operationId: 'deleteEmailTemplate', summary: 'Delete an email template', description: 'Deletes a template permanently. Needs `templateId` from List email templates.', returns: 'Deleted', entitlement: 'crm', pathParams: [{ name: 'templateId', description: 'Template id.' }] },
    ],
  },
}
