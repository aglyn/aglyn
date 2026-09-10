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
 * The OpenAPI 3.1 description of the customer REST API (AGL-2733).
 *
 * `/api/v1` has been a real API since AGL-617 — fourteen resources, around
 * sixty operations, every response JSON — described only in prose. A person
 * could read `/developers`; a client could not. So every integrator hand-wrote
 * types the server already knew, and learned the field names by trial and
 * error.
 *
 * ## Where the shapes come from
 *
 * The resource schemas below are transcribed from the RESPONSE EXAMPLES in
 * `apps/docs/api/resources/*.md`, which are the customer-facing contract. That
 * is deliberate: the handlers in `api-v1-resources.ts` are 3,800 lines and
 * project their output field by field, so reading them would describe the
 * implementation, while the docs describe the promise. Where the two ever
 * disagree the server is right and the difference is a bug in its own right —
 * `api-v1-openapi.spec.ts` pins the documented paths against the dispatcher so
 * a resource cannot be added to one and forgotten in the other.
 *
 * ## Why it is served WITHOUT a key
 *
 * A description of how to authenticate that itself requires authentication is
 * useless at the only moment it is wanted. It carries no customer data — every
 * word of it is already published at `/developers` — so the gate would protect
 * nothing and cost discovery everything.
 */

/** A JSON Schema / OpenAPI fragment. Same shape the tenant builder uses. */
type Schema = Record<string, unknown>

/** The API's own version. Independent of the platform release. */
export const CUSTOMER_API_VERSION = 'v1'

/** Where the description is served. */
export const CUSTOMER_API_OPENAPI_PATH = '/api/v1/openapi.json'

const ISO = (description: string): Schema => ({
  type: 'string',
  format: 'date-time',
  description,
})

const str = (description: string): Schema => ({ type: 'string', description })
const int = (description: string): Schema => ({ type: 'integer', description })
const bool = (description: string): Schema => ({ type: 'boolean', description })
const strList = (description: string): Schema => ({
  type: 'array',
  items: { type: 'string' },
  description,
})
/**
 * A field the API may answer with `null`.
 *
 * OpenAPI 3.1 is JSON Schema 2020-12, where nullability is a type UNION and
 * not the 3.0 `nullable: true` keyword — a generator reading `nullable` here
 * would silently produce a non-optional field, which is the whole class of bug
 * this document exists to remove.
 */
const nullable = (base: Schema): Schema => ({
  ...base,
  type: [base['type'], 'null'],
})

const objectOf = (description: string): Schema => ({
  type: 'object',
  description,
  additionalProperties: true,
})

interface ResourceOp {
  /** Path relative to the server, e.g. `/v1/contacts/{contactId}`. */
  readonly path: string
  readonly method: 'get' | 'post' | 'patch' | 'delete'
  readonly operationId: string
  readonly summary: string
  readonly description?: string
  /** `true` when the response is the paginated list envelope. */
  readonly list?: boolean
  /** Schema name for the response body, when it is a single record. */
  readonly returns?: string
  /** Schema name for the request body. */
  readonly accepts?: string
  /** Extra query parameters beyond the pagination pair. */
  readonly filters?: readonly Schema[]
  /** Path parameters, in order. */
  readonly pathParams?: readonly { name: string; description: string }[]
  /** `true` when a `204` is the success answer. */
  readonly noContent?: boolean
  /** Entitlement the call needs, named in the 403. */
  readonly entitlement?: string
}

interface ResourceSpec {
  readonly tag: string
  readonly description: string
  readonly schemaName: string
  readonly fields: Record<string, Schema>
  readonly required: readonly string[]
  readonly ops: readonly ResourceOp[]
}

/** Every record carries these two. */
const STAMPS = {
  created: ISO('When the record was created.'),
  updated: ISO('When the record last changed. CRM lists can be walked by it.'),
}

const OBJECT_FIELD = (name: string): Schema => ({
  type: 'string',
  const: name,
  description: `Always \`${name}\`. Lets a client discriminate a mixed array.`,
})

const ADDRESS = (): Schema => ({
  type: 'object',
  description: 'Postal address. Members are optional and free-form.',
  properties: {
    line1: { type: 'string' },
    line2: { type: 'string' },
    city: { type: 'string' },
    region: { type: 'string' },
    postalCode: { type: 'string' },
    country: { type: 'string' },
  },
  additionalProperties: true,
})

/** The pagination pair, on every list. */
const LIMIT_PARAM: Schema = {
  name: 'limit',
  in: 'query',
  required: false,
  description:
    'Records per page. Values outside 1–100 are CLAMPED, not rejected: ' +
    '`limit=5000` gives 100, and `limit=0` or `limit=abc` gives the default.',
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
}

const CURSOR_PARAM: Schema = {
  name: 'cursor',
  in: 'query',
  required: false,
  description:
    'Opaque. Pass the previous response’s `next_cursor` back verbatim. Do ' +
    'not construct or parse one — an undecodable cursor is not an error, it ' +
    'returns an arbitrary page, so `has_more` is the only termination signal.',
  schema: { type: 'string' },
}

const UPDATED_AFTER_PARAM: Schema = {
  name: 'updatedAfter',
  in: 'query',
  required: false,
  description:
    'ISO 8601 instant WITH an offset (`2026-09-01T00:00:00Z`). A bare date ' +
    'is a 400 — midnight in whose zone is not a question this API can ' +
    'answer. Reorders the list by `updated` ascending, and moves every other ' +
    'filter out of the query and onto the page, so pages can come back short.',
  schema: { type: 'string', format: 'date-time' },
}

const q = (name: string, description: string, schema: Schema = { type: 'string' }): Schema => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
})

const RESOURCES: readonly ResourceSpec[] = [
  {
    tag: 'Datasets',
    description: 'Structured collections and the records inside them.',
    schemaName: 'Dataset',
    required: ['id', 'object', 'name'],
    fields: {
      id: str('Dataset id.'),
      object: OBJECT_FIELD('dataset'),
      name: str('Human-readable name.'),
      fields: {
        type: 'array',
        description: 'Field definitions. Shape is the dataset model.',
        items: { type: 'object', additionalProperties: true },
      },
      created: STAMPS.created,
    },
    ops: [
      { path: '/v1/datasets', method: 'get', operationId: 'listDatasets', summary: 'List datasets', list: true, returns: 'Dataset' },
      { path: '/v1/datasets', method: 'post', operationId: 'createDataset', summary: 'Create a dataset', accepts: 'DatasetWrite', returns: 'Dataset' },
      { path: '/v1/datasets/{datasetId}', method: 'get', operationId: 'getDataset', summary: 'Retrieve a dataset', returns: 'Dataset', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
      { path: '/v1/datasets/{datasetId}', method: 'patch', operationId: 'updateDataset', summary: 'Update a dataset', accepts: 'DatasetWrite', returns: 'Dataset', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
      {
        path: '/v1/datasets/{datasetId}', method: 'delete', operationId: 'deleteDataset', summary: 'Delete a dataset', noContent: true,
        description: 'Refuses with `409 conflict` (`code: "dataset_not_empty"`) while the dataset still holds records.',
        pathParams: [{ name: 'datasetId', description: 'Dataset id.' }],
      },
      { path: '/v1/datasets/{datasetId}/records', method: 'get', operationId: 'listDatasetRecords', summary: 'List records', list: true, returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
      { path: '/v1/datasets/{datasetId}/records', method: 'post', operationId: 'createDatasetRecord', summary: 'Create a record', accepts: 'DatasetRecordWrite', returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }] },
      { path: '/v1/datasets/{datasetId}/records/{recordId}', method: 'get', operationId: 'getDatasetRecord', summary: 'Retrieve a record', returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }, { name: 'recordId', description: 'Record id.' }] },
      { path: '/v1/datasets/{datasetId}/records/{recordId}', method: 'patch', operationId: 'updateDatasetRecord', summary: 'Update a record', accepts: 'DatasetRecordWrite', returns: 'DatasetRecord', pathParams: [{ name: 'datasetId', description: 'Dataset id.' }, { name: 'recordId', description: 'Record id.' }] },
      { path: '/v1/datasets/{datasetId}/records/{recordId}', method: 'delete', operationId: 'deleteDatasetRecord', summary: 'Delete a record', noContent: true, pathParams: [{ name: 'datasetId', description: 'Dataset id.' }, { name: 'recordId', description: 'Record id.' }] },
    ],
  },
  {
    tag: 'Sites',
    description: 'The sites an organization publishes.',
    schemaName: 'Site',
    required: ['id', 'object', 'displayName'],
    fields: {
      id: str('Site id.'),
      object: OBJECT_FIELD('site'),
      displayName: str('Name shown in the console.'),
      subdomain: str('Platform subdomain, without the apex.'),
      domain: nullable(str('Custom domain, when one is attached.')),
    },
    ops: [
      { path: '/v1/sites', method: 'get', operationId: 'listSites', summary: 'List sites', list: true, returns: 'Site' },
      { path: '/v1/sites', method: 'post', operationId: 'createSite', summary: 'Create a site', accepts: 'SiteWrite', returns: 'Site', description: 'Limited to 10 per hour per organization, separately from the request budget.' },
      { path: '/v1/sites/{siteId}', method: 'get', operationId: 'getSite', summary: 'Retrieve a site', returns: 'Site', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      {
        path: '/v1/sites/{siteId}/publish', method: 'post', operationId: 'publishSite', summary: 'Publish a site', returns: 'PublishResult',
        description: 'Limited to 10 per site per hour, on top of — not instead of — the per-key limit. Sized to the work: one publish drops up to 250 cached pages, so minting extra keys does not raise it.',
        pathParams: [{ name: 'siteId', description: 'Site id.' }],
      },
    ],
  },
  {
    tag: 'Contacts',
    description: 'People, organization-wide. Not gated on the CRM suite.',
    schemaName: 'Contact',
    required: ['id', 'object', 'email'],
    fields: {
      id: str('Contact id.'),
      object: OBJECT_FIELD('contact'),
      email: str('Primary email. Unique per organization.'),
      name: str('Display name.'),
      tags: strList('Free-form tags.'),
      notes: str('Free-form notes.'),
      marketingConsent: bool('Whether the contact accepted marketing email.'),
      consentSites: strList('Site ids the consent was given on.'),
      sources: strList('Where this contact came from.'),
      phone: str('Telephone number.'),
      jobTitle: str('Job title.'),
      companyId: nullable(str('Primary company.')),
      address: ADDRESS(),
      ownerUid: nullable(str('Owning user. Checked on the page, not the query.')),
      lifecycleStage: nullable(str('CRM lifecycle stage.')),
      companyIds: strList('Every company this contact belongs to.'),
      alternateEmails: strList('Other addresses that resolve to this contact.'),
      ...STAMPS,
    },
    ops: [
      {
        path: '/v1/contacts', method: 'get', operationId: 'listContacts', summary: 'List contacts', list: true, returns: 'Contact',
        description: 'Combining `email` with `tag` narrows on `email` and checks `tag` on the page, so pages can come back short. `lifecycleStage` and `ownerUid` live on a per-site profile and are ALWAYS checked on the page.',
        filters: [
          q('email', 'Exact match, normalized the way the write path normalizes it. An unusable value is a 400.'),
          q('tag', 'Checked on the page when combined with `email`.'),
          q('lifecycleStage', 'Always checked on the page.'),
          q('ownerUid', 'Always checked on the page.'),
        ],
      },
      { path: '/v1/contacts', method: 'post', operationId: 'createContact', summary: 'Create a contact', accepts: 'ContactWrite', returns: 'Contact', description: 'A duplicate email is `409 conflict` (`code: "contact_exists"`), and the message names the existing id.' },
      { path: '/v1/contacts/{contactId}', method: 'get', operationId: 'getContact', summary: 'Retrieve a contact', returns: 'Contact', pathParams: [{ name: 'contactId', description: 'Contact id.' }] },
      { path: '/v1/contacts/{contactId}', method: 'patch', operationId: 'updateContact', summary: 'Update a contact', accepts: 'ContactWrite', returns: 'Contact', pathParams: [{ name: 'contactId', description: 'Contact id.' }] },
      { path: '/v1/contacts/{contactId}', method: 'delete', operationId: 'deleteContact', summary: 'Delete a contact', noContent: true, pathParams: [{ name: 'contactId', description: 'Contact id.' }] },
      { path: '/v1/contacts/{contactId}/merge', method: 'post', operationId: 'mergeContact', summary: 'Merge two contacts', accepts: 'ContactMerge', returns: 'Contact', pathParams: [{ name: 'contactId', description: 'The contact that survives.' }] },
    ],
  },
  {
    tag: 'Companies',
    description: 'Organizations in the CRM.',
    schemaName: 'Company',
    required: ['id', 'object', 'name'],
    fields: {
      id: str('Company id.'),
      object: OBJECT_FIELD('company'),
      name: str('Company name.'),
      domain: nullable(str('Primary domain. Unique per organization.')),
      website: nullable(str('Website URL.')),
      phone: nullable(str('Telephone number.')),
      address: ADDRESS(),
      industry: nullable(str('Industry label.')),
      ownerUid: nullable(str('Owning user.')),
      notes: nullable(str('Free-form notes.')),
      custom: objectOf('Customer-defined fields.'),
      nextTaskAt: nullable(ISO('When the next open task on this company is due.')),
      siteId: nullable(str('Site the record originated on.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/companies', method: 'get', operationId: 'listCompanies', summary: 'List companies', list: true, returns: 'Company', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, q('domain', 'Exact match.'), q('ownerUid', 'Owning user.')] },
      { path: '/v1/companies', method: 'post', operationId: 'createCompany', summary: 'Create a company', accepts: 'CompanyWrite', returns: 'Company', entitlement: 'crm', description: 'A duplicate domain is `409 conflict` (`code: "company_exists"`), naming the existing id.' },
      { path: '/v1/companies/{companyId}', method: 'get', operationId: 'getCompany', summary: 'Retrieve a company', returns: 'Company', entitlement: 'crm', pathParams: [{ name: 'companyId', description: 'Company id.' }] },
      { path: '/v1/companies/{companyId}', method: 'patch', operationId: 'updateCompany', summary: 'Update a company', accepts: 'CompanyWrite', returns: 'Company', entitlement: 'crm', pathParams: [{ name: 'companyId', description: 'Company id.' }] },
      { path: '/v1/companies/{companyId}', method: 'delete', operationId: 'deleteCompany', summary: 'Delete a company', noContent: true, entitlement: 'crm', pathParams: [{ name: 'companyId', description: 'Company id.' }] },
    ],
  },
  {
    tag: 'Pipelines',
    description: 'Deal pipelines and their stages. Read-only over the API.',
    schemaName: 'Pipeline',
    required: ['id', 'object', 'name', 'stages'],
    fields: {
      id: str('Pipeline id.'),
      object: OBJECT_FIELD('pipeline'),
      name: str('Pipeline name.'),
      isDefault: bool('Whether new deals land here when none is named.'),
      archived: bool('Whether the pipeline is archived.'),
      archivedAt: nullable(ISO('When it was archived.')),
      stages: {
        type: 'array',
        description: 'Ordered stages. A deal’s `stageId` names one of these.',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, order: { type: 'integer' } },
          additionalProperties: true,
        },
      },
      siteId: nullable(str('Site the pipeline belongs to, when scoped.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/pipelines', method: 'get', operationId: 'listPipelines', summary: 'List pipelines', list: true, returns: 'Pipeline', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM] },
      { path: '/v1/pipelines/{pipelineId}', method: 'get', operationId: 'getPipeline', summary: 'Retrieve a pipeline', returns: 'Pipeline', entitlement: 'crm', pathParams: [{ name: 'pipelineId', description: 'Pipeline id.' }] },
    ],
  },
  {
    tag: 'Deals',
    description: 'Opportunities moving through a pipeline.',
    schemaName: 'Deal',
    required: ['id', 'object', 'title', 'pipelineId', 'stageId'],
    fields: {
      id: str('Deal id.'),
      object: OBJECT_FIELD('deal'),
      title: str('Deal title.'),
      pipelineId: str('Pipeline the deal sits in.'),
      stageId: str('Stage within that pipeline.'),
      status: str('`open`, `won` or `lost`.'),
      amountCents: int('Value in the smallest unit of `currency`.'),
      currency: str('ISO 4217 code.'),
      lineItems: { type: 'array', description: 'Line items, when the deal carries them.', items: { type: 'object', additionalProperties: true } },
      expectedCloseAt: nullable(ISO('Forecast close date.')),
      closedAt: nullable(ISO('When it was actually closed.')),
      stageChangedAt: nullable(ISO('When the stage last moved.')),
      ownerUid: nullable(str('Owning user.')),
      contactId: nullable(str('Associated contact.')),
      companyId: nullable(str('Associated company.')),
      lostReason: nullable(str('Why it was lost.')),
      notes: nullable(str('Free-form notes.')),
      custom: objectOf('Customer-defined fields.'),
      nextTaskAt: nullable(ISO('When the next open task on this deal is due.')),
      siteId: nullable(str('Site the record originated on.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/deals', method: 'get', operationId: 'listDeals', summary: 'List deals', list: true, returns: 'Deal', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, q('pipelineId', 'Pipeline.'), q('stageId', 'Stage.'), q('status', 'Deal status.'), q('ownerUid', 'Owning user.')] },
      { path: '/v1/deals', method: 'post', operationId: 'createDeal', summary: 'Create a deal', accepts: 'DealWrite', returns: 'Deal', entitlement: 'crm' },
      { path: '/v1/deals/{dealId}', method: 'get', operationId: 'getDeal', summary: 'Retrieve a deal', returns: 'Deal', entitlement: 'crm', pathParams: [{ name: 'dealId', description: 'Deal id.' }] },
      { path: '/v1/deals/{dealId}', method: 'patch', operationId: 'updateDeal', summary: 'Update a deal', accepts: 'DealWrite', returns: 'Deal', entitlement: 'crm', pathParams: [{ name: 'dealId', description: 'Deal id.' }] },
      { path: '/v1/deals/{dealId}', method: 'delete', operationId: 'deleteDeal', summary: 'Delete a deal', noContent: true, entitlement: 'crm', pathParams: [{ name: 'dealId', description: 'Deal id.' }] },
    ],
  },
  {
    tag: 'Tasks',
    description: 'Follow-ups attached to CRM records.',
    schemaName: 'Task',
    required: ['id', 'object', 'title'],
    fields: {
      id: str('Task id.'),
      object: OBJECT_FIELD('task'),
      title: str('Task title.'),
      notes: nullable(str('Free-form notes.')),
      kind: str('Task kind, e.g. `call` or `email`.'),
      priority: str('Priority label.'),
      status: str('`open` or `completed`.'),
      dueAt: nullable(ISO('When the task is due.')),
      remindAt: nullable(ISO('When a reminder is scheduled.')),
      reminderSentAt: nullable(ISO('When the reminder was sent.')),
      completedAt: nullable(ISO('When it was completed.')),
      assigneeUid: nullable(str('Assigned user.')),
      contactId: nullable(str('Associated contact.')),
      companyId: nullable(str('Associated company.')),
      dealId: nullable(str('Associated deal.')),
      siteId: nullable(str('Site the record originated on.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/tasks', method: 'get', operationId: 'listTasks', summary: 'List tasks', list: true, returns: 'Task', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, q('status', 'Task status.'), q('assigneeUid', 'Assigned user.'), q('contactId', 'Associated contact.'), q('dealId', 'Associated deal.')] },
      { path: '/v1/tasks', method: 'post', operationId: 'createTask', summary: 'Create a task', accepts: 'TaskWrite', returns: 'Task', entitlement: 'crm' },
      { path: '/v1/tasks/{taskId}', method: 'get', operationId: 'getTask', summary: 'Retrieve a task', returns: 'Task', entitlement: 'crm', pathParams: [{ name: 'taskId', description: 'Task id.' }] },
      { path: '/v1/tasks/{taskId}', method: 'patch', operationId: 'updateTask', summary: 'Update a task', accepts: 'TaskWrite', returns: 'Task', entitlement: 'crm', pathParams: [{ name: 'taskId', description: 'Task id.' }] },
      { path: '/v1/tasks/{taskId}', method: 'delete', operationId: 'deleteTask', summary: 'Delete a task', noContent: true, entitlement: 'crm', pathParams: [{ name: 'taskId', description: 'Task id.' }] },
    ],
  },
  {
    tag: 'Activities',
    description: 'Logged interactions. Append-only: no PATCH.',
    schemaName: 'Activity',
    required: ['id', 'object', 'kind', 'at'],
    fields: {
      id: str('Activity id.'),
      object: OBJECT_FIELD('activity'),
      kind: str('What happened, e.g. `call`, `email`, `note`.'),
      body: str('Free-form body.'),
      at: ISO('When the interaction happened — not when it was logged.'),
      byUid: nullable(str('User who logged it.')),
      contactId: nullable(str('Associated contact.')),
      companyId: nullable(str('Associated company.')),
      dealId: nullable(str('Associated deal.')),
      outcome: nullable(str('Outcome label.')),
      durationMinutes: nullable(int('Duration, for calls and meetings.')),
      siteId: nullable(str('Site the record originated on.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/activities', method: 'get', operationId: 'listActivities', summary: 'List activities', list: true, returns: 'Activity', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, q('kind', 'Activity kind.'), q('contactId', 'Associated contact.'), q('dealId', 'Associated deal.')] },
      { path: '/v1/activities', method: 'post', operationId: 'createActivity', summary: 'Log an activity', accepts: 'ActivityWrite', returns: 'Activity', entitlement: 'crm' },
      { path: '/v1/activities/{activityId}', method: 'get', operationId: 'getActivity', summary: 'Retrieve an activity', returns: 'Activity', entitlement: 'crm', pathParams: [{ name: 'activityId', description: 'Activity id.' }] },
      { path: '/v1/activities/{activityId}', method: 'delete', operationId: 'deleteActivity', summary: 'Delete an activity', noContent: true, entitlement: 'crm', pathParams: [{ name: 'activityId', description: 'Activity id.' }] },
    ],
  },
  {
    tag: 'Leads',
    description: 'Unqualified interest, before it becomes a contact.',
    schemaName: 'Lead',
    required: ['id', 'object', 'siteId'],
    fields: {
      id: str('Lead id.'),
      object: OBJECT_FIELD('lead'),
      siteId: str('Site the lead arrived on.'),
      email: nullable(str('Email, when supplied.')),
      name: nullable(str('Name, when supplied.')),
      status: str('Lead status.'),
      ownerUid: nullable(str('Owning user.')),
      notes: nullable(str('Free-form notes.')),
      unqualifiedReason: nullable(str('Why the lead was disqualified.')),
      sources: strList('Where the lead came from.'),
      submissionCount: int('How many form submissions this lead has made.'),
      firstSeen: ISO('First interaction.'),
      lastSeen: ISO('Most recent interaction.'),
      marketingConsent: bool('Whether marketing consent was given.'),
      marketingConsentAt: nullable(ISO('When consent was given.')),
      convertedContactId: nullable(str('Contact created by conversion.')),
      convertedAt: nullable(ISO('When it was converted.')),
      companyId: nullable(str('Company created or matched by conversion.')),
      dealId: nullable(str('Deal created by conversion.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/leads', method: 'get', operationId: 'listLeads', summary: 'List leads', list: true, returns: 'Lead', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, q('siteId', 'Site the lead arrived on.'), q('status', 'Lead status.'), q('ownerUid', 'Owning user.')] },
      { path: '/v1/leads/{leadId}', method: 'get', operationId: 'getLead', summary: 'Retrieve a lead', returns: 'Lead', entitlement: 'crm', pathParams: [{ name: 'leadId', description: 'Lead id.' }] },
      { path: '/v1/leads/{leadId}', method: 'patch', operationId: 'updateLead', summary: 'Update a lead', accepts: 'LeadWrite', returns: 'Lead', entitlement: 'crm', pathParams: [{ name: 'leadId', description: 'Lead id.' }] },
      { path: '/v1/leads/{leadId}/convert', method: 'post', operationId: 'convertLead', summary: 'Convert a lead', returns: 'LeadConversion', entitlement: 'crm', description: 'Creates a contact, and optionally a company and a deal. Idempotent on the lead: converting an already-converted lead returns the existing ids.', pathParams: [{ name: 'leadId', description: 'Lead id.' }] },
    ],
  },
  {
    tag: 'Email templates',
    description: 'Reusable email bodies.',
    schemaName: 'EmailTemplate',
    required: ['id', 'object', 'name'],
    fields: {
      id: str('Template id.'),
      object: OBJECT_FIELD('email_template'),
      name: str('Template name.'),
      kind: str('Template kind.'),
      visibility: str('`org` or `private`.'),
      ownerUid: nullable(str('Owner, for a private template.')),
      subject: str('Subject line.'),
      body: str('Body. May contain merge tokens.'),
      siteId: nullable(str('Site the template belongs to, when scoped.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/email-templates', method: 'get', operationId: 'listEmailTemplates', summary: 'List email templates', list: true, returns: 'EmailTemplate', entitlement: 'crm', filters: [UPDATED_AFTER_PARAM, q('kind', 'Template kind.'), q('visibility', 'Visibility.')] },
      { path: '/v1/email-templates', method: 'post', operationId: 'createEmailTemplate', summary: 'Create a template', accepts: 'EmailTemplateWrite', returns: 'EmailTemplate', entitlement: 'crm' },
      { path: '/v1/email-templates/{templateId}', method: 'get', operationId: 'getEmailTemplate', summary: 'Retrieve a template', returns: 'EmailTemplate', entitlement: 'crm', pathParams: [{ name: 'templateId', description: 'Template id.' }] },
      { path: '/v1/email-templates/{templateId}', method: 'patch', operationId: 'updateEmailTemplate', summary: 'Update a template', accepts: 'EmailTemplateWrite', returns: 'EmailTemplate', entitlement: 'crm', pathParams: [{ name: 'templateId', description: 'Template id.' }] },
      { path: '/v1/email-templates/{templateId}', method: 'delete', operationId: 'deleteEmailTemplate', summary: 'Delete a template', noContent: true, entitlement: 'crm', pathParams: [{ name: 'templateId', description: 'Template id.' }] },
    ],
  },
  {
    tag: 'Media',
    description: 'The organization library, and a site’s own files.',
    schemaName: 'MediaAsset',
    required: ['id', 'object', 'fileName', 'url'],
    fields: {
      id: str('Asset id.'),
      object: OBJECT_FIELD('media'),
      fileName: str('Original file name.'),
      contentType: str('MIME type.'),
      sizeBytes: int('Size in bytes.'),
      width: nullable(int('Pixel width, for images.')),
      height: nullable(int('Pixel height, for images.')),
      alt: nullable(str('Alt text.')),
      description: nullable(str('Long description.')),
      tags: strList('Free-form tags.'),
      folderId: nullable(str('Folder the asset sits in.')),
      url: str('Canonical URL.'),
      cdnUrl: str('CDN URL. Prefer this for delivery.'),
      private: bool('Whether the asset requires a signed URL.'),
      created: STAMPS.created,
    },
    ops: [
      { path: '/v1/media', method: 'get', operationId: 'listOrgMedia', summary: 'List organization media', list: true, returns: 'MediaAsset', description: 'Rows deleted since they were written are dropped after the read, so pages can come back short.' },
      { path: '/v1/media', method: 'post', operationId: 'uploadOrgMedia', summary: 'Upload to the organization library', accepts: 'MediaUpload', returns: 'MediaAsset' },
      { path: '/v1/media/{mediaId}', method: 'get', operationId: 'getOrgMedia', summary: 'Retrieve an asset', returns: 'MediaAsset', pathParams: [{ name: 'mediaId', description: 'Asset id.' }] },
      { path: '/v1/sites/{siteId}/media', method: 'get', operationId: 'listSiteMedia', summary: 'List a site’s media', list: true, returns: 'MediaAsset', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      { path: '/v1/sites/{siteId}/media', method: 'post', operationId: 'uploadSiteMedia', summary: 'Upload to a site', accepts: 'MediaUpload', returns: 'MediaAsset', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
    ],
  },
  {
    tag: 'Products',
    description: 'A site’s catalog. Read-only over the API.',
    schemaName: 'Product',
    required: ['id', 'object', 'name'],
    fields: {
      id: str('Product id.'),
      object: OBJECT_FIELD('product'),
      name: str('Product name.'),
      slug: str('URL slug.'),
      description: nullable(str('Description.')),
      type: str('Product type.'),
      status: str('Publication status.'),
      tags: strList('Free-form tags.'),
      categoryIds: strList('Categories this product belongs to.'),
      mediaUrls: strList('Image URLs.'),
      options: { type: 'array', description: 'Option definitions, e.g. size.', items: { type: 'object', additionalProperties: true } },
      variants: { type: 'array', description: 'Purchasable variants.', items: { type: 'object', additionalProperties: true } },
      inventory: nullable(int('Stock on hand, when tracked.')),
      subscription: nullable(objectOf('Subscription terms, when the product is one.')),
      ...STAMPS,
    },
    ops: [
      { path: '/v1/sites/{siteId}/products', method: 'get', operationId: 'listProducts', summary: 'List products', list: true, returns: 'Product', description: 'Rows deleted since they were written are dropped after the read, so pages can come back short.', pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      { path: '/v1/sites/{siteId}/products/{productId}', method: 'get', operationId: 'getProduct', summary: 'Retrieve a product', returns: 'Product', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'productId', description: 'Product id.' }] },
    ],
  },
  {
    tag: 'Orders',
    description: 'A site’s orders. Status moves are constrained.',
    schemaName: 'Order',
    required: ['id', 'object', 'number', 'status'],
    fields: {
      id: str('Order id.'),
      object: OBJECT_FIELD('order'),
      number: int('Human-facing order number.'),
      status: str('Order status.'),
      channel: str('`online` by default. Older orders carry no stored value, so `?channel=online` drops them after the read.'),
      currency: str('ISO 4217 code.'),
      customerEmail: nullable(str('Customer email.')),
      customerName: nullable(str('Customer name.')),
      lineItems: { type: 'array', description: 'What was bought.', items: { type: 'object', additionalProperties: true } },
      totals: objectOf('Money totals, in the smallest unit of `currency`.'),
      refundedCents: int('Amount refunded so far.'),
      disputed: bool('Whether a chargeback is open.'),
      shippingAddress: ADDRESS(),
      couponCode: nullable(str('Coupon applied.')),
      fulfillments: { type: 'array', description: 'Shipments and deliveries.', items: { type: 'object', additionalProperties: true } },
      created: STAMPS.created,
    },
    ops: [
      { path: '/v1/sites/{siteId}/orders', method: 'get', operationId: 'listOrders', summary: 'List orders', list: true, returns: 'Order', filters: [q('channel', '`online` is a default rather than a stored value, so filtering on it drops older orders after the read.'), q('status', 'Order status.')], pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      { path: '/v1/sites/{siteId}/orders/{orderId}', method: 'get', operationId: 'getOrder', summary: 'Retrieve an order', returns: 'Order', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'orderId', description: 'Order id.' }] },
      { path: '/v1/sites/{siteId}/orders/{orderId}', method: 'patch', operationId: 'updateOrder', summary: 'Move an order’s status', accepts: 'OrderWrite', returns: 'Order', description: 'An illegal transition is `409 conflict` (`code: "order_transition"`), and the message names the status it is in.', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'orderId', description: 'Order id.' }] },
    ],
  },
  {
    tag: 'Form submissions',
    description: 'What visitors sent through a site’s forms.',
    schemaName: 'FormSubmission',
    required: ['id', 'object', 'form_id', 'fields'],
    fields: {
      id: str('Submission id.'),
      object: OBJECT_FIELD('form_submission'),
      form_id: str('Form id.'),
      form: str('Form name.'),
      path: str('Page path the form was submitted from.'),
      fields: objectOf('The submitted values, keyed by field name.'),
      read: bool('Whether the submission has been marked read.'),
      routing: objectOf('Where the submission was routed.'),
      created: STAMPS.created,
    },
    ops: [
      { path: '/v1/sites/{siteId}/form-submissions', method: 'get', operationId: 'listFormSubmissions', summary: 'List submissions', list: true, returns: 'FormSubmission', description: 'Combining `form`/`formId` with `read` narrows on the form and checks `read` on the page, so pages can come back short.', filters: [q('form', 'Form name.'), q('formId', 'Form id.'), q('read', 'Either `true` or `false`. Anything else is a 400.', { type: 'string', enum: ['true', 'false'] })], pathParams: [{ name: 'siteId', description: 'Site id.' }] },
      { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'get', operationId: 'getFormSubmission', summary: 'Retrieve a submission', returns: 'FormSubmission', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'submissionId', description: 'Submission id.' }] },
      { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'patch', operationId: 'updateFormSubmission', summary: 'Mark a submission read', accepts: 'FormSubmissionWrite', returns: 'FormSubmission', pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'submissionId', description: 'Submission id.' }] },
      { path: '/v1/sites/{siteId}/form-submissions/{submissionId}', method: 'delete', operationId: 'deleteFormSubmission', summary: 'Delete a submission', noContent: true, pathParams: [{ name: 'siteId', description: 'Site id.' }, { name: 'submissionId', description: 'Submission id.' }] },
    ],
  },
]

/**
 * Fields the SERVER owns. A write body that accepted them would invite a
 * client to send an `id` or a `created` and quietly have it ignored, which is
 * the kind of silent no-op an integrator debugs for an afternoon.
 */
const SERVER_OWNED = new Set(['id', 'object', 'created', 'updated'])

/** The write shape for a resource: its own fields, minus the server's. */
function writeSchema(resource: ResourceSpec): Schema {
  const properties: Record<string, Schema> = {}
  for (const [name, schema] of Object.entries(resource.fields)) {
    if (SERVER_OWNED.has(name)) continue
    properties[name] = schema
  }
  return {
    type: 'object',
    description:
      `Writable fields of a ${resource.schemaName}. Server-owned fields ` +
      '(`id`, `object`, `created`, `updated`) are rejected rather than ' +
      'silently ignored.',
    properties,
    additionalProperties: false,
  }
}

/** `{ object: "list", data: [...], next_cursor, has_more }`. */
function listSchema(itemRef: string): Schema {
  return {
    type: 'object',
    required: ['object', 'data', 'has_more'],
    properties: {
      object: { type: 'string', const: 'list' },
      data: { type: 'array', items: { $ref: `#/components/schemas/${itemRef}` } },
      next_cursor: {
        type: ['string', 'null'],
        description:
          'Pass back verbatim for the next page. `null` when `has_more` is false.',
      },
      has_more: {
        type: 'boolean',
        description:
          'The ONLY termination signal. `data.length < limit` never means the ' +
          'end — several lists filter rows out after the read, so a page of ' +
          '100 can return 60 rows, or none, with `has_more: true`.',
      },
    },
  }
}

const ERROR_SCHEMA: Schema = {
  type: 'object',
  required: ['error'],
  description: 'Every failure, in one shape.',
  properties: {
    error: {
      type: 'object',
      required: ['type', 'message'],
      properties: {
        type: {
          type: 'string',
          description:
            'The stable, machine-readable field. Branch on this, never on ' +
            '`message`.',
          enum: [
            'bad_request',
            'unauthorized',
            'plan_required',
            'insufficient_scope',
            'not_found',
            'method_not_allowed',
            'conflict',
            'rate_limited',
          ],
        },
        message: { type: 'string', description: 'Human-readable. May change.' },
        code: {
          type: 'string',
          description:
            'The specific detail, when there is one — `validation_failed`, ' +
            '`dataset_not_empty`, `contact_exists`, `company_exists`, ' +
            '`order_transition`, `idempotency_in_progress`, or the missing ' +
            'scope or entitlement.',
        },
      },
    },
  },
}

/** Options the caller supplies; nothing here is guessed from the environment. */
export interface CustomerApiOpenApiOptions {
  /** Origin the API is served from, e.g. `https://app.aglyn.com`. */
  readonly origin: string
  /** Where the prose documentation lives. */
  readonly documentationUrl: string
  /** The operator's brand name — self-hosters are not "Aglyn". */
  readonly brandName: string
}

/**
 * Build the OpenAPI 3.1 description of `/api/v1`.
 *
 * Per-operation `security` is deliberately absent: every operation uses the
 * document-level requirement, and repeating it would be one more place for a
 * new endpoint to be added without it.
 */
export function buildCustomerApiOpenApi(
  options: CustomerApiOpenApiOptions,
): Schema {
  const origin = options.origin.replace(/\/+$/, '')
  const schemas: Record<string, Schema> = { Error: ERROR_SCHEMA }
  const paths: Record<string, Schema> = {}
  const tags: Schema[] = []
  const listItems = new Set<string>()

  for (const resource of RESOURCES) {
    tags.push({ name: resource.tag, description: resource.description })
    schemas[resource.schemaName] = {
      type: 'object',
      description: resource.description,
      required: [...resource.required],
      properties: resource.fields,
    }

    for (const op of resource.ops) {
      if (op.accepts && !(op.accepts in schemas)) {
        // Named write shapes that are not simply "the record minus the
        // server's fields" are declared below; everything else is derived, so
        // a field added to a resource cannot be forgotten on its write body.
        schemas[op.accepts] = writeSchema(resource)
      }
      if (op.list && op.returns) listItems.add(op.returns)

      const parameters: Schema[] = [
        ...(op.pathParams ?? []).map((p) => ({
          name: p.name,
          in: 'path',
          required: true,
          description: p.description,
          schema: { type: 'string' },
        })),
        ...(op.list ? [LIMIT_PARAM, CURSOR_PARAM] : []),
        ...(op.filters ?? []),
      ]

      const success: Schema = op.noContent
        ? { description: 'Deleted. No body.' }
        : {
            description: op.list ? 'One page of the list.' : 'The record.',
            content: {
              'application/json': {
                schema: op.list
                  ? { $ref: `#/components/schemas/${op.returns}List` }
                  : { $ref: `#/components/schemas/${op.returns}` },
              },
            },
          }

      const responses: Record<string, Schema> = {
        [op.noContent ? '204' : '200']: success,
        '400': errorResponse('Validation failed. No data was read.'),
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
        '404': errorResponse('No such record — or no such endpoint.'),
        '429': errorResponse('Rate limit exceeded. `Retry-After` says how long.'),
      }
      if (op.entitlement) {
        responses['403'] = errorResponse(
          `The organization's plan does not include \`${op.entitlement}\`. ` +
            '`code` names it.',
        )
      }

      const item = (paths[op.path] ??= {})
      ;(item as Record<string, unknown>)[op.method] = {
        operationId: op.operationId,
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        tags: [resource.tag],
        ...(parameters.length ? { parameters } : {}),
        ...(op.accepts
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${op.accepts}` },
                  },
                },
              },
            }
          : {}),
        responses,
      }
    }
  }

  for (const item of listItems) schemas[`${item}List`] = listSchema(item)

  // The service paths. Not resources: no ids, no collection, no scope.
  paths['/v1'] = {
    get: {
      operationId: 'getApiRoot',
      summary: 'API root',
      description:
        'Names the API, its version, the documentation URL and the top-level ' +
        'resources. Sub-resources are deliberately absent — advertising a ' +
        'path that 404s is worse than not advertising it.',
      tags: ['Service'],
      responses: {
        '200': {
          description: 'The service description.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiRoot' } },
          },
        },
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
        '405': errorResponse('This path answers GET only; `Allow` says so.'),
      },
    },
  }
  paths['/v1/me'] = {
    get: {
      operationId: 'getKeyIdentity',
      summary: 'Introspect the calling key',
      description: 'Says which organization and scopes this key carries. Never returns the key.',
      tags: ['Service'],
      responses: {
        '200': {
          description: 'The key’s identity.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/KeyIdentity' } } },
        },
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
      },
    },
  }
  paths['/v1/usage'] = {
    get: {
      operationId: 'getUsage',
      summary: 'This month’s billed requests',
      description: 'Every authenticated call is billed, including one that fails validation.',
      tags: ['Service'],
      responses: {
        '200': {
          description: 'The current billing period’s usage.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Usage' } } },
        },
        '401': errorResponse('Missing, malformed, revoked or expired key.'),
      },
    },
  }
  paths[CUSTOMER_API_OPENAPI_PATH.replace('/api', '')] = {
    get: {
      operationId: 'getApiDescription',
      summary: 'This document',
      description:
        'Served WITHOUT a key. A description of how to authenticate that ' +
        'requires authentication is useless at the only moment it is wanted, ' +
        'and it carries nothing the public documentation does not.',
      tags: ['Service'],
      security: [],
      responses: {
        '200': {
          description: 'The OpenAPI 3.1 description of this API.',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
  }

  Object.assign(schemas, {
    DatasetRecord: {
      type: 'object',
      description:
        'A row in a dataset. Its fields are whatever that dataset’s model ' +
        'defines, so they cannot be enumerated here — `id`, `object` and the ' +
        'stamps are the only members every record shares.',
      required: ['id', 'object'],
      properties: {
        id: { type: 'string', description: 'Record id.' },
        object: { type: 'string', const: 'record', description: 'Always `record`.' },
        created: { type: 'string', format: 'date-time' },
        updated: { type: 'string', format: 'date-time' },
      },
      additionalProperties: true,
    },
    DatasetRecordWrite: {
      type: 'object',
      description:
        'The record’s own fields, per its dataset’s model.\n\n' +
        '⚠️ This is the ONE write body that is open. Every other one closes ' +
        'with `additionalProperties: false`, because its fields are fixed by ' +
        'this API. A record’s are fixed by the CUSTOMER, in the dataset ' +
        'model, so closing this would reject the very fields they defined. ' +
        'Server-owned members are still refused.',
      not: {
        anyOf: [
          { required: ['id'] },
          { required: ['object'] },
          { required: ['created'] },
          { required: ['updated'] },
        ],
      },
      additionalProperties: true,
    },
    ApiRoot: {
      type: 'object',
      required: ['object', 'name', 'version', 'resources'],
      properties: {
        object: { type: 'string', const: 'api' },
        name: { type: 'string' },
        version: { type: 'string', const: CUSTOMER_API_VERSION },
        documentation: { type: 'string', description: 'Where the prose documentation lives.' },
        resources: { type: 'array', items: { type: 'string' }, description: 'Top-level resource names.' },
      },
    },
    KeyIdentity: {
      type: 'object',
      required: ['object'],
      properties: {
        object: { type: 'string', const: 'api_key' },
        orgId: { type: 'string', description: 'Organization this key belongs to.' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'What the key may do.' },
      },
      additionalProperties: true,
    },
    Usage: {
      type: 'object',
      properties: {
        object: { type: 'string', const: 'usage' },
        requests: { type: 'integer', description: 'Billed requests this period.' },
        periodStart: { type: 'string', format: 'date-time' },
        periodEnd: { type: 'string', format: 'date-time' },
      },
      additionalProperties: true,
    },
    PublishResult: {
      type: 'object',
      description: 'The outcome of a publish.',
      properties: {
        object: { type: 'string', const: 'publish' },
        siteId: { type: 'string' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: true,
    },
    LeadConversion: {
      type: 'object',
      description:
        'What the conversion produced. Idempotent on the lead: converting an ' +
        'already-converted lead returns the existing ids rather than creating ' +
        'a second set.',
      properties: {
        object: { type: 'string', const: 'lead_conversion' },
        contactId: { type: 'string' },
        companyId: { type: ['string', 'null'] },
        dealId: { type: ['string', 'null'] },
      },
      additionalProperties: true,
    },
    ContactMerge: {
      type: 'object',
      required: ['sourceId'],
      description: 'Merge another contact into this one. The source is removed.',
      properties: {
        sourceId: { type: 'string', description: 'The contact to merge FROM. It does not survive.' },
      },
      additionalProperties: false,
    },
    MediaUpload: {
      type: 'object',
      description: 'An upload. See the media documentation for the multipart form.',
      properties: {
        fileName: { type: 'string' },
        contentType: { type: 'string' },
        alt: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        folderId: { type: 'string' },
      },
      additionalProperties: true,
    },
  })

  /*
    Rate-limit headers on every response, attached by a walk. Written into
    each operation by hand they would be sixty places for a new endpoint to
    quietly omit them — and the headers are the whole reason a client can pace
    itself, so an endpoint missing them is one a careful client throttles
    against nothing.
  */
  const rateHeaders: Schema = {
    'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
    'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
    'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
    'X-RateLimit-Limit': { $ref: '#/components/headers/XRateLimitLimit' },
    'X-RateLimit-Remaining': { $ref: '#/components/headers/XRateLimitRemaining' },
    'X-RateLimit-Reset': { $ref: '#/components/headers/XRateLimitReset' },
  }
  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (pathName === '/v1/openapi.json') continue
    for (const operation of Object.values(pathItem as Record<string, Schema>)) {
      const responses = (operation as Schema)['responses'] as
        | Record<string, Schema>
        | undefined
      if (!responses) continue
      for (const [status, response] of Object.entries(responses)) {
        response['headers'] = {
          ...rateHeaders,
          ...(status === '429'
            ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } }
            : {}),
          ...((response['headers'] as Schema) ?? {}),
        }
      }
    }
  }

  return {
    openapi: '3.1.0',
    // Stated rather than assumed: it is what tells a consumer these schemas
    // are JSON Schema 2020-12, where nullability is a type UNION and not
    // OpenAPI 3.0's `nullable` keyword.
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: `${options.brandName} REST API`,
      version: CUSTOMER_API_VERSION,
      summary: `Programmatic access to an organization's data on ${options.brandName}.`,
      description:
        `The customer REST API. Authenticate with an API key as a bearer ` +
        'token; every response is JSON.\n\n' +
        '## Pagination\n\n' +
        'Every list returns `{ object: "list", data, next_cursor, has_more }` ' +
        'and pages with an opaque cursor. **`has_more` is the only ' +
        'termination signal.** Several lists filter rows out after the read, ' +
        'so a page of 100 can come back with 60 rows — or none — and ' +
        '`has_more: true`. A loop written as `while (data.length === limit)` ' +
        'stops early on those, and it looks like it worked.\n\n' +
        '## Ordering\n\n' +
        'Every list is ordered by record id, ascending — **not** by created ' +
        'or updated time. Page 1 is not "the 25 newest", and there is no ' +
        '`sort` param. The CRM lists are the exception: pass `updatedAfter` ' +
        'and they reorder by `updated` ascending, which is what a ' +
        'sync should walk.\n\n' +
        '## Rate limits\n\n' +
        'Both the RFC 9331 `RateLimit-*` headers and the older ' +
        '`X-RateLimit-*` are sent, from the same reading so they cannot ' +
        'disagree. The RFC `Reset` is SECONDS REMAINING; the legacy one is a ' +
        'Unix timestamp. On a `401` they describe the per-address lookup ' +
        'budget rather than a key\'s, because the key was never identified.\n\n' +
        `Full documentation: ${options.documentationUrl}`,
      contact: { name: options.brandName, url: options.documentationUrl },
    },
    servers: [{ url: origin, description: options.brandName }],
    security: [{ apiKey: [] }],
    tags: [
      ...tags,
      { name: 'Service', description: 'The API’s description of itself.' },
    ],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An API key, sent as `Authorization: Bearer aglyn_sk_…`. Keys are ' +
            'organization credentials, not user ones — there is no user ' +
            'scope to evaluate. Mint and revoke them in the console.',
        },
      },
      headers: {
        RateLimitLimit: { description: 'Requests allowed per window, per RFC 9331.', schema: { type: 'integer' } },
        RateLimitRemaining: { description: 'Requests left in the current window.', schema: { type: 'integer' } },
        RateLimitReset: { description: 'SECONDS until the window resets — a duration, so it is read against your clock rather than ours.', schema: { type: 'integer' } },
        XRateLimitLimit: { description: 'Same number as `RateLimit-Limit`. The older spelling, not deprecated.', schema: { type: 'integer' } },
        XRateLimitRemaining: { description: 'Same number as `RateLimit-Remaining`.', schema: { type: 'integer' } },
        XRateLimitReset: { description: 'When the window resets, as a Unix TIMESTAMP in seconds — not a duration. Not interchangeable with `RateLimit-Reset`.', schema: { type: 'integer' } },
        RetryAfter: { description: 'Seconds to wait. Sent with a 429.', schema: { type: 'integer' } },
      },
      schemas,
    },
  }
}

/** One error response, in the shared envelope. */
function errorResponse(description: string): Schema {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Error' } },
    },
  }
}
