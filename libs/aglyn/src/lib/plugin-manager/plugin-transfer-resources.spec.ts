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

import type { ResolvedTransferResourceDeclaration } from './plugin-transfer-resources'

let mockDeclared: ResolvedTransferResourceDeclaration[] | undefined

jest.mock('./first-party-plugins.generated', () => {
  const actual = jest.requireActual('./first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_TRANSFER_RESOURCES_DECLARED() {
      return mockDeclared === undefined ? actual.PLUGIN_TRANSFER_RESOURCES_DECLARED : mockDeclared
    },
  }
})

import { transferPlanFeature } from '../data-transfer/access'
import { transferResourceProblems } from '../data-transfer/resource'
import type { PlannedTransferRow } from '../data-transfer/plan'
import { createTransferPolicy } from '../data-transfer/policy'
import { FIRST_PARTY_PLUGINS } from './enabled-plugins'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import {
  declaredTransferResource,
  listDeclaredTransferResources,
  listPluginTransferResourceUis,
  listTransferResourcesFor,
  matchTransferResourceRows,
  planTransferResourceRows,
  pluginTransferResourceProblems,
  pluginTransferResourceUi,
  registerPluginTransferResource,
  registerPluginTransferResourceUi,
  resetTransferResourcesForTests,
  resetTransferResourceUisForTests,
  resolveTransferResource,
  resolveTransferResources,
  transferInvariantFailures,
  transferPackageHooks,
  transferRecordsHooks,
  transferResourceCatalog,
  transferResourceMatchKeys,
  transferResourcePolicyDefaults,
  TransferResourceUnavailableError,
  transferPlanRefusal,
  transferPlanRequired,
  transferWizardSteps,
  type PluginTransferResource,
  type TransferPlanSubject,
  type TransferResourceContext,
} from './plugin-transfer-resources'

/**
 * The transfer-resource extension point (AGL-3523), read the way the job
 * engine and the wizard read it: the compiled declarations, joined to what
 * the plugins registered. The property that matters is the refusal — a
 * resource declared and missing must fail the job, never read as empty.
 */

const RECORDS: PluginTransferResource = {
  fields: () => ({
    standard: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'email', label: 'Email', type: 'email', matchKey: true },
    ],
  }),
  matchKeys: [{ fieldId: 'email', normalizer: 'email' }],
  readPage: async () => ({ rows: [], next: null }),
  lookup: async () => ({ lookup: new Map(), records: new Map() }),
  apply: async () => ({ results: [], undo: [] }),
  revert: async () => ({ done: [], conflicts: [] }),
}

const PACKAGE: PluginTransferResource = {
  items: async () => [],
  dependencies: () => [],
  remapIds: (item) => item,
  readItems: async () => [],
  writeItems: async () => ({ results: [], undo: [] }),
  revertItems: async () => ({ done: [], refused: [] }),
}

const BOTTLES: ResolvedTransferResourceDeclaration = {
  pluginId: 'cellar',
  key: 'bottles',
  label: 'Bottles',
  scope: 'org',
  kinds: ['records'],
  formats: ['csv', 'json'],
  limits: { maxRows: 5000 },
}

const SHELVES: ResolvedTransferResourceDeclaration = {
  pluginId: 'cellar',
  key: 'shelves',
  label: 'Shelves',
  scope: 'host',
  kinds: ['package'],
  formats: ['json'],
}

const TASTINGS: ResolvedTransferResourceDeclaration = {
  pluginId: 'tasting',
  key: 'tastings',
  label: 'Tastings',
  scope: 'org',
  kinds: ['records'],
  formats: ['csv'],
}

const CTX: TransferResourceContext = { resource: 'bottles', orgId: 'o1', hostId: null, actorUid: 'u1' }

beforeEach(() => {
  mockDeclared = [BOTTLES, SHELVES, TASTINGS]
})

afterEach(() => {
  mockDeclared = undefined
  resetTransferResourcesForTests()
  resetTransferResourceUisForTests()
  resetPluginDeclarationsRepairForTests()
})

describe('the compiled declarations', () => {
  it('every first-party declaration passes the core check, with one owner per key', () => {
    mockDeclared = undefined
    const declared = listDeclaredTransferResources()
    for (const one of declared) expect([one.key, transferResourceProblems(one)]).toEqual([one.key, []])
    const keys = declared.map((one) => one.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('finds a declaration by key, trimmed, or answers null', () => {
    expect(declaredTransferResource(' bottles ')?.pluginId).toBe('cellar')
    expect(declaredTransferResource('corks')).toBeNull()
  })
})

describe('listing what a workspace or a site can move', () => {
  it('lists the scope asked for, from plugins the workspace runs, in config order', () => {
    const org = { enabledPlugins: ['cellar', 'tasting'] }
    expect(listTransferResourcesFor({ scope: 'org', org }).map((one) => one.key)).toEqual([
      'bottles',
      'tastings',
    ])
    expect(listTransferResourcesFor({ scope: 'host', org, host: {} }).map((one) => one.key)).toEqual([
      'shelves',
    ])
  })

  it('leaves out a plugin the workspace or the site switched off', () => {
    expect(
      listTransferResourcesFor({ scope: 'org', org: { enabledPlugins: ['tasting'] } }).map((one) => one.key),
    ).toEqual(['tastings'])
    expect(
      listTransferResourcesFor({
        scope: 'host',
        org: { enabledPlugins: ['cellar'] },
        host: { disabledPlugins: ['cellar'] },
      }),
    ).toEqual([])
  })

  it('leaves out a plugin whose release flag is off, unless staff preview it', () => {
    const flagged = FIRST_PARTY_PLUGINS.find((plugin) => plugin.releaseFlag && !plugin.alwaysOn)
    if (!flagged) return
    mockDeclared = [{ ...BOTTLES, pluginId: flagged.id }]
    const org = { enabledPlugins: [flagged.id] }
    expect(listTransferResourcesFor({ scope: 'org', org, isFlagOn: () => false })).toEqual([])
    expect(listTransferResourcesFor({ scope: 'org', org, isFlagOn: () => true })).toHaveLength(1)
    expect(
      listTransferResourcesFor({ scope: 'org', org, isFlagOn: () => false, staffBypass: true }),
    ).toHaveLength(1)
  })
})

describe('registering the server half', () => {
  it('is refused with no owner', () => {
    expect(() => registerPluginTransferResource('bottles', RECORDS)).toThrow(/no owner/)
  })

  it('is refused for a key nobody declared', () => {
    expect(() => registerPluginTransferResource('corks', RECORDS, { pluginId: 'cellar' })).toThrow(
      /not declared/,
    )
  })

  it('is refused for a key another plugin declared', () => {
    expect(() =>
      registerPluginTransferResource('bottles', RECORDS, { pluginId: 'tasting' }),
    ).toThrow(/declared by "cellar"/)
  })

  it('is refused for a declaration the core rejects', () => {
    mockDeclared = [{ ...BOTTLES, formats: [] }]
    expect(() => registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })).toThrow(
      /declares no format/,
    )
  })

  it('is refused naming every hook a declared kind lacks', () => {
    const partial: PluginTransferResource = { ...RECORDS, lookup: undefined, revert: undefined }
    expect(() => registerPluginTransferResource('bottles', partial, { pluginId: 'cellar' })).toThrow(
      /registers no "lookup".*registers no "revert"/,
    )
    expect(() => registerPluginTransferResource('shelves', RECORDS, { pluginId: 'cellar' })).toThrow(
      /registers no "items"/,
    )
    expect(() =>
      registerPluginTransferResource('shelves', { ...PACKAGE, revertItems: undefined }, { pluginId: 'cellar' }),
    ).toThrow(/registers no "revertItems"/)
  })

  it('asks no writes of a resource that is only exported (AGL-3528)', () => {
    const reads: Record<string, unknown> = { ...RECORDS }
    delete reads['apply']
    delete reads['revert']
    expect(pluginTransferResourceProblems({ ...BOTTLES, exportOnly: true }, reads)).toEqual([])
    expect(pluginTransferResourceProblems(BOTTLES, reads)).toEqual([
      'bottles declares records and registers no "apply".',
      'bottles declares records and registers no "revert".',
    ])
  })

  it('is refused for a records resource with no match key', () => {
    expect(
      pluginTransferResourceProblems(BOTTLES, { ...RECORDS, matchKeys: [] }),
    ).toEqual(['bottles names no match key, so no row could find its record.'])
  })

  it("is refused for a preset that takes a built-in preset's id, repeats one, or names nothing", () => {
    expect(
      pluginTransferResourceProblems(BOTTLES, {
        ...RECORDS,
        presets: [
          { id: 'everything', label: 'Mine', fieldIds: ['name'] },
          { id: 'layout', label: 'Layout', fieldIds: ['name'] },
          { id: 'layout', label: '', fieldIds: [] },
        ],
      }),
    ).toEqual([
      'bottles lists preset "everything" twice, or under a built-in preset\'s id.',
      'bottles lists preset "layout" twice, or under a built-in preset\'s id.',
      'bottles lists preset "layout" with no label or no fields.',
    ])
  })

  it('replaces the answers when the same plugin registers again', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    const again = { ...RECORDS }
    registerPluginTransferResource('bottles', again, { pluginId: 'cellar' })
    expect((await resolveTransferResource('bottles')).impl).toBe(again)
  })
})

describe('resolving a resource', () => {
  it('refuses a key nobody declared as undeclared', async () => {
    await expect(resolveTransferResource('corks')).rejects.toMatchObject({
      reason: 'undeclared',
      key: 'corks',
    })
  })

  it('THROWS naming a resource declared and never registered', async () => {
    const error = await resolveTransferResource('bottles').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TransferResourceUnavailableError)
    expect(error).toMatchObject({ reason: 'unregistered', key: 'bottles' })
    await expect(resolveTransferResources()).rejects.toThrow(/"bottles" \(cellar\).*"shelves" \(cellar\).*"tastings" \(tasting\)/)
  })

  it('runs the app’s declarations step once before refusing, and answers if that registers it', async () => {
    const repair = jest.fn(async () => {
      registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
      registerPluginTransferResource('shelves', PACKAGE, { pluginId: 'cellar' })
      registerPluginTransferResource('tastings', RECORDS, { pluginId: 'tasting' })
    })
    registerPluginDeclarationsRepair(repair)

    const resolved = await resolveTransferResources()

    expect(repair).toHaveBeenCalledTimes(1)
    expect(resolved.map((one) => one.key)).toEqual(['bottles', 'shelves', 'tastings'])
    expect(resolved[0].impl).toBe(RECORDS)
  })

  it('narrows to the hooks of a declared kind, and refuses the other', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    registerPluginTransferResource('shelves', PACKAGE, { pluginId: 'cellar' })
    const bottles = await resolveTransferResource('bottles')
    const shelves = await resolveTransferResource('shelves')
    expect(transferRecordsHooks(bottles).matchKeys).toEqual(RECORDS.matchKeys)
    expect(() => transferPackageHooks(bottles)).toThrow(/does not move a package/)
    expect(typeof transferPackageHooks(shelves).writeItems).toBe('function')
    expect(() => transferRecordsHooks(shelves)).toThrow(/does not move records/)
  })
})

describe('a resource moved one instance at a time', () => {
  const CASKS: ResolvedTransferResourceDeclaration = {
    pluginId: 'cellar',
    key: 'casks',
    label: 'Cask contents',
    scope: 'org',
    kinds: ['records'],
    formats: ['csv'],
    instances: true,
  }

  beforeEach(() => {
    mockDeclared = [BOTTLES, CASKS]
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    registerPluginTransferResource('casks', RECORDS, { pluginId: 'cellar' })
  })

  it('resolves under the whole key, naming the instance', async () => {
    const cask = await resolveTransferResource('casks:c-42')
    expect(cask).toMatchObject({ key: 'casks:c-42', instance: 'c-42', label: 'Cask contents', impl: RECORDS })
    // Nothing about a resource without instances moves.
    expect(await resolveTransferResource('bottles')).not.toHaveProperty('instance')
  })

  it('refuses a key that names no instance of it, and an instance of one that has none', async () => {
    await expect(resolveTransferResource('casks')).rejects.toMatchObject({ reason: 'undeclared' })
    await expect(resolveTransferResource('casks')).rejects.toThrow(/one instance at a time/)
    await expect(resolveTransferResource('bottles:b1')).rejects.toMatchObject({ reason: 'undeclared' })
    await expect(resolveTransferResource('bottles:b1')).rejects.toThrow(/has no instances/)
  })

  it('finds the client half under the declared key', () => {
    registerPluginTransferResourceUi('casks', { label: 'Cask contents' }, { pluginId: 'cellar' })
    expect(pluginTransferResourceUi('casks:c-42')).toMatchObject({ label: 'Cask contents', pluginId: 'cellar' })
  })
})

/*
 * A RESOURCE ON A PLAN (AGL-3555): the declaration decides which intents
 * ask for its `featureFlag`; the route asks after the member, with the
 * plugin's own refusal when it registers a `planGate`, else the core's.
 */
describe('a resource moved only on a plan that carries it', () => {
  const VINTAGES: ResolvedTransferResourceDeclaration = {
    pluginId: 'cellar',
    key: 'vintages',
    label: 'Vintages',
    scope: 'org',
    kinds: ['records'],
    formats: ['csv'],
    featureFlag: 'crm',
  }
  const LABELS: ResolvedTransferResourceDeclaration = { ...VINTAGES, key: 'labels', label: 'Labels', featureFlagExempt: ['export'] }
  const FREE = { plan: 'free' }
  const STARTER = { plan: 'starter' }
  const subject = (resource: string, org: Record<string, unknown>): TransferPlanSubject => ({ resource, orgId: 'o1', hostId: null, org })

  beforeEach(() => {
    mockDeclared = [BOTTLES, VINTAGES, LABELS]
  })

  it('names the feature an intent needs, but an exempt one', () => {
    expect(transferPlanFeature('import', VINTAGES)).toBe('crm')
    expect(transferPlanFeature('export', VINTAGES)).toBe('crm')
    expect(transferPlanFeature('import', LABELS)).toBe('crm')
    expect(transferPlanFeature('export', LABELS)).toBeNull()
    expect(transferPlanFeature('import', BOTTLES)).toBeNull()
  })

  it('checks the declaration: a feature named, an exemption only of one, of import or export', () => {
    expect(transferResourceProblems({ ...VINTAGES, featureFlag: ' ' })).toEqual(['vintages names an empty plan feature.'])
    expect(transferResourceProblems({ ...BOTTLES, featureFlagExempt: ['export'] })).toEqual([
      'bottles exempts intents from a plan feature it does not name.',
    ])
    expect(transferResourceProblems({ ...VINTAGES, featureFlagExempt: ['delete' as never] })).toEqual([
      'vintages exempts something other than import or export from its plan feature.',
    ])
  })

  it('refuses a plan gate on a resource that names no feature, which nothing would ask', () => {
    expect(() => registerPluginTransferResource('bottles', { ...RECORDS, planGate: () => null }, { pluginId: 'cellar' })).toThrow(
      /registers a "planGate" and declares no "featureFlag"/,
    )
  })

  it('answers the core’s refusal without a plan gate: 403, plan_required, the feature as code', async () => {
    registerPluginTransferResource('vintages', RECORDS, { pluginId: 'cellar' })
    expect(await transferPlanRefusal(subject('vintages', FREE), 'export')).toEqual({
      status: 403,
      body: {
        error: 'Exporting vintages is not included in your current plan. Manage your plan and add-ons from Billing. Included from Starter.',
        reason: 'plan_required',
        code: 'crm',
      },
    })
    expect(await transferPlanRefusal(subject('vintages', STARTER), 'import')).toBeNull()
    expect(transferPlanRequired('crm', 'CRM records', 'import').body.error).toMatch(/^Importing CRM records is not included/)
  })

  it('names an add-on no plan carries as an add-on, never as an upgrade (AGL-3548)', () => {
    expect(transferPlanRequired('eventCalendar', 'Events', 'import').body).toEqual({
      error: "Importing events isn't included in any plan — it's a paid add-on. Manage your plan and add-ons from Billing.",
      reason: 'plan_required',
      code: 'eventCalendar',
    })
  })

  it('answers the plugin’s own refusal when it registers one, and only for an intent that asks', async () => {
    const asked: string[] = []
    const refusal = { status: 403 as const, body: { error: 'Labels are the cellar’s.', reason: 'plan_required' as const, code: 'crm' } }
    registerPluginTransferResource(
      'labels',
      {
        ...RECORDS,
        planGate: async (_subject, intent) => {
          asked.push(intent)
          return refusal
        },
      },
      { pluginId: 'cellar' },
    )
    expect(await transferPlanRefusal(subject('labels', FREE), 'import')).toBe(refusal)
    expect(await transferPlanRefusal(subject('labels', FREE), 'export')).toBeNull()
    expect(asked).toEqual(['import'])
  })

  it('asks nothing of a resource with no feature, or a key nobody declared', async () => {
    expect(await transferPlanRefusal(subject('bottles', FREE), 'import')).toBeNull()
    expect(await transferPlanRefusal(subject('nobody', FREE), 'import')).toBeNull()
  })

  it('still asks the plan when the server half cannot be reached', async () => {
    expect(await transferPlanRefusal(subject('vintages', FREE), 'import')).toMatchObject({ status: 403, body: { code: 'crm' } })
  })
})

describe('match keys read for the context', () => {
  it('offers a fixed list, every key a default', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    expect(await transferResourceMatchKeys(await resolveTransferResource('bottles'), CTX)).toEqual({
      keys: [{ fieldId: 'email', normalizer: 'email' }],
      defaults: ['email'],
    })
  })

  it('asks the resource, keeping only defaults it offers', async () => {
    const matchKeys = jest.fn(async (ctx: TransferResourceContext) => ({
      keys: [
        { fieldId: 'id', normalizer: 'aglynId' as const },
        { fieldId: `${ctx.orgId}-sku`, normalizer: 'trim' as const },
      ],
      defaults: ['id', 'gone'],
    }))
    registerPluginTransferResource('bottles', { ...RECORDS, matchKeys }, { pluginId: 'cellar' })
    const offer = await transferResourceMatchKeys(await resolveTransferResource('bottles'), CTX)
    expect(matchKeys).toHaveBeenCalledWith(CTX)
    expect(offer.keys.map((key) => key.fieldId)).toEqual(['id', 'o1-sku'])
    expect(offer.defaults).toEqual(['id'])
  })

  it('refuses a context that offers no key', async () => {
    registerPluginTransferResource('bottles', { ...RECORDS, matchKeys: () => ({ keys: [] }) }, { pluginId: 'cellar' })
    await expect(transferResourceMatchKeys(await resolveTransferResource('bottles'), CTX)).rejects.toThrow(
      /offers no match key/,
    )
  })
})

describe('what the engine asks of a resolved resource', () => {
  it('builds the field catalog, adding the Aglyn ID', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    const catalog = await transferResourceCatalog(await resolveTransferResource('bottles'), CTX)
    expect(catalog.fields.map((field) => field.id)).toEqual(expect.arrayContaining(['id', 'name', 'email']))
  })

  it('refuses a catalog the core finds problems in', async () => {
    registerPluginTransferResource(
      'bottles',
      {
        ...RECORDS,
        fields: () => ({ standard: [{ id: 'grape', label: 'Grape', type: 'picklist' }] }),
      },
      { pluginId: 'cellar' },
    )
    await expect(
      transferResourceCatalog(await resolveTransferResource('bottles'), CTX),
    ).rejects.toThrow(/picklist with no picklistId/)
  })

  it('plans with the core unless the resource plans for itself', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    const input = {
      fields: [{ id: 'name', label: 'Name', type: 'text' as const }],
      rows: [{ index: 0, values: { name: 'Malbec' } }],
      matches: [{ kind: 'new' as const }],
      existing: new Map(),
      policy: createTransferPolicy(),
    }
    const core = await planTransferResourceRows(await resolveTransferResource('bottles'), CTX, input)
    expect(core.summary.create).toBe(1)

    const own = { ...core, summary: { ...core.summary, create: 0, skip: 1 } }
    registerPluginTransferResource('bottles', { ...RECORDS, plan: () => own }, { pluginId: 'cellar' })
    expect(await planTransferResourceRows(await resolveTransferResource('bottles'), CTX, input)).toBe(own)
  })

  it('starts from the resource’s defaults, kept to the fields the context has (AGL-3548)', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    const fields = (await transferResourceCatalog(await resolveTransferResource('bottles'), CTX)).fields
    expect(await transferResourcePolicyDefaults(await resolveTransferResource('bottles'), CTX, fields)).toEqual({})

    registerPluginTransferResource(
      'bottles',
      {
        ...RECORDS,
        defaultPolicy: async (ctx) => ({
          fieldDefault: { mode: 'overwrite' },
          fields: { name: { blank: 'clear' }, vintage: { mode: 'overwrite' } },
          note: `For ${ctx.orgId}`,
        }),
      },
      { pluginId: 'cellar' },
    )
    expect(await transferResourcePolicyDefaults(await resolveTransferResource('bottles'), CTX, fields)).toEqual({
      fieldDefault: { mode: 'overwrite' },
      fields: { name: { blank: 'clear' } },
      note: 'For o1',
    })
  })

  it('matches with the core, then the resource’s own matching over it (AGL-3548)', async () => {
    registerPluginTransferResource('bottles', RECORDS, { pluginId: 'cellar' })
    const input = {
      rows: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
      keys: [{ fieldId: 'email', normalizer: 'email' as const }],
      lookup: new Map([['email\u0000a@x.com', ['r1', 'r2']]]),
      records: new Map([['r1', { email: 'a@x.com' }]]),
    }
    const core = await matchTransferResourceRows(await resolveTransferResource('bottles'), CTX, input)
    expect(core.outcomes.map((outcome) => outcome.kind)).toEqual(['ambiguous', 'new'])
    expect(core.records).toBe(input.records)

    // The resource narrows the ambiguous row to one record, which it read itself.
    registerPluginTransferResource(
      'bottles',
      {
        ...RECORDS,
        match: (_ctx, given) => ({
          outcomes: given.outcomes.map((outcome) =>
            outcome.kind === 'ambiguous' ? { kind: 'matched', recordId: 'r2', via: outcome.via } : outcome,
          ),
          records: new Map([['r2', { email: 'a@x.com', name: 'Second' }]]),
        }),
      },
      { pluginId: 'cellar' },
    )
    const own = await matchTransferResourceRows(await resolveTransferResource('bottles'), CTX, input)
    expect(own.outcomes[0]).toMatchObject({ kind: 'matched', recordId: 'r2' })
    expect([...own.records.keys()]).toEqual(['r1', 'r2'])

    registerPluginTransferResource('bottles', { ...RECORDS, match: () => ({ outcomes: [] }) }, { pluginId: 'cellar' })
    await expect(matchTransferResourceRows(await resolveTransferResource('bottles'), CTX, input)).rejects.toThrow(
      /matched 0 of 2 rows/,
    )
  })

  it('hands the core plan the resource’s comparator (AGL-3548)', async () => {
    registerPluginTransferResource(
      'bottles',
      {
        ...RECORDS,
        valuesEqual: (field, a, b) => (field.id === 'name' ? String(a).toLowerCase() === String(b).toLowerCase() : undefined),
      },
      { pluginId: 'cellar' },
    )
    const plan = await planTransferResourceRows(await resolveTransferResource('bottles'), CTX, {
      fields: [{ id: 'name', label: 'Name', type: 'text' as const }],
      rows: [{ index: 0, values: { name: 'MALBEC' } }],
      matches: [{ kind: 'matched' as const, recordId: 'r1', via: { fieldId: 'id', value: 'r1' } }],
      existing: new Map([['r1', { name: 'Malbec' }]]),
      policy: createTransferPolicy({ fieldDefault: { mode: 'overwrite', blank: 'leave' } }),
    })
    expect(plan.rows[0]?.verdict).toBe('unchanged')
  })

  it('reports each writing row that breaks an invariant, and checks no other', () => {
    const row = (index: number, verdict: PlannedTransferRow['verdict'], recordId: string | null) =>
      ({ index, verdict, recordId, diff: [], heldBack: [], warnings: [], match: { kind: 'new' } }) as unknown as PlannedTransferRow
    const failures = transferInvariantFailures(
      [
        {
          id: 'forward',
          label: 'A level only rises',
          check: (_row, before) => (before?.['level'] === 3 ? 'Level 3 cannot drop' : null),
        },
      ],
      [row(0, 'update', 'r1'), row(1, 'skip', 'r1'), row(2, 'create', null)],
      new Map([['r1', { level: 3 }]]),
    )
    expect(failures).toEqual([{ row: 0, invariant: 'forward', message: 'Level 3 cannot drop' }])
  })
})

describe('the client half', () => {
  const Step = (): null => null

  it('is refused on the same terms as the server half', () => {
    expect(() => registerPluginTransferResourceUi('bottles', { label: 'Bottles' })).toThrow(/no owner/)
    expect(() =>
      registerPluginTransferResourceUi('corks', { label: 'Corks' }, { pluginId: 'cellar' }),
    ).toThrow(/not declared/)
    expect(() =>
      registerPluginTransferResourceUi('bottles', { label: 'Bottles' }, { pluginId: 'tasting' }),
    ).toThrow(/declared by "cellar"/)
  })

  it('refuses a step that follows no wizard step, or repeats an id', () => {
    expect(() =>
      registerPluginTransferResourceUi(
        'bottles',
        { label: 'Bottles', extraSteps: [{ id: 'cellar', label: 'Cellar', after: 'nowhere' as never, component: Step }] },
        { pluginId: 'cellar' },
      ),
    ).toThrow(/follows no wizard step/)
    expect(() =>
      registerPluginTransferResourceUi(
        'bottles',
        {
          label: 'Bottles',
          extraSteps: [
            { id: 'cellar', label: 'Cellar', after: 'values', component: Step },
            { id: 'cellar', label: 'Cellar again', after: 'matching', component: Step },
          ],
        },
        { pluginId: 'cellar' },
      ),
    ).toThrow(/listed twice/)
  })

  it('answers what was registered, and slots its steps after the step each names', () => {
    registerPluginTransferResourceUi(
      'bottles',
      {
        label: 'Bottles',
        extraSteps: [{ id: 'vintages', label: 'Vintages', after: 'values', component: Step }],
      },
      { pluginId: 'cellar' },
    )
    expect(pluginTransferResourceUi('bottles')).toMatchObject({ label: 'Bottles', pluginId: 'cellar' })
    expect(pluginTransferResourceUi('tastings')).toBeNull()
    expect(listPluginTransferResourceUis()).toEqual([{ key: 'bottles', pluginId: 'cellar' }])
    expect(transferWizardSteps('bottles').map((step) => step.id)).toEqual([
      'upload',
      'mapping',
      'values',
      'vintages',
      'matching',
      'conflicts',
      'dryRun',
      'apply',
    ])
  })
})
