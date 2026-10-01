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
  activityActionLabel,
  activityActorLabel,
  activityHref,
  activityPrimaryText,
  activityTargetLabel,
  activityTypeLabel,
  activityEntryGroupId,
  runTriggeredByLabel,
} from './activity-presenter'
import { PLATFORM_BRAND_NAME } from './platform-brand'
import { registerPluginActivityActions } from '../plugin-manager/plugin-activity-actions'

// The AI codes the feed shows, as the AI plugin declares them (AGL-2940):
// the presenter reads the registry, and this is the registration.
registerPluginActivityActions({
  pluginId: 'ai',
  group: { id: 'ai', label: 'AI' },
  actions: [
    { key: 'ai.job.output', label: 'AI generated', scope: ['org', 'host'] },
    { key: 'ai.edit.applied', label: 'Applied AI edits', scope: ['org', 'host'] },
    { key: 'ai.overage.cap', label: 'AI overage ceiling', scope: 'org' },
    { key: 'ai.addon.purchased', label: 'Added the AI add-on', scope: 'org' },
  ],
  // The plugin's un-namespaced target type, with its noun (AGL-3080).
  targetTypes: { aiJob: 'AI generation' },
})

describe('activityTypeLabel', () => {
  it('maps known types to human nouns', () => {
    expect(activityTypeLabel('screen')).toBe('Page')
    expect(activityTypeLabel('org')).toBe('Organization')
    expect(activityTypeLabel('invite')).toBe('Invitation')
  })

  it('title-cases an unknown type instead of failing', () => {
    expect(activityTypeLabel('gizmo')).toBe('Gizmo')
  })

  it('has a fallback for a missing type', () => {
    expect(activityTypeLabel(undefined)).toBe('Item')
  })

  it('names a plugin’s namespaced resource by its noun (AGL-2978)', () => {
    expect(activityTypeLabel('widgets:gadget')).toBe('Gadget')
    expect(activityTargetLabel({ type: 'widgets:gadget', id: 'g1' })).toBe('Gadget')
    expect(activityTargetLabel({ type: 'widgets:gadget', name: 'Front desk' })).toBe('Front desk')
    // No link is invented for a resource core has no address for.
    expect(activityHref({ target: { type: 'widgets:gadget', id: 'g1' } }, { orgSlug: 'acme' })).toBeUndefined()
  })
})

describe('activityTargetLabel', () => {
  it('prefers the recorded name', () => {
    expect(activityTargetLabel({ type: 'screen', id: 'abc', name: 'Home' })).toBe(
      'Home',
    )
  })

  it('degrades to the type label, NEVER the raw id', () => {
    const label = activityTargetLabel({ type: 'screen', id: 'x7Il1O0abc' })
    expect(label).toBe('Page')
    expect(label).not.toContain('x7Il1O0abc')
  })
})

describe('activityPrimaryText', () => {
  it('suffixes the action with the target name', () => {
    expect(
      activityPrimaryText({
        action: 'Saved the screen',
        target: { type: 'screen', id: 'abc', name: 'Home' },
      }),
    ).toBe('Saved the screen — Home')
  })

  it('keeps the bare action when no name was recorded', () => {
    expect(
      activityPrimaryText({
        action: 'Saved the screen',
        target: { type: 'screen', id: 'abc' },
      }),
    ).toBe('Saved the screen')
  })

  it('falls back to the target label when there is no action', () => {
    expect(activityPrimaryText({ target: { type: 'theme' } })).toBe('Theme')
  })

  it('renders an AI code by its label, never as the dotted path (AGL-2929)', () => {
    expect(
      activityPrimaryText({
        action: 'ai.job.output',
        target: { type: 'screen', id: 'abc', name: 'Home', versionId: 'v1' },
      }),
    ).toBe('AI generated — Home')
    expect(activityPrimaryText({ action: 'ai.overage.cap', target: { type: 'org', name: '$25' } })).toBe(
      'AI overage ceiling — $25',
    )
  })
})

describe('activityActionLabel and activityEntryGroupId (AGL-2929)', () => {
  it('translates every catalog code and passes a stored sentence through', () => {
    expect(activityActionLabel('ai.addon.purchased')).toBe('Added the AI add-on')
    expect(activityActionLabel('Saved the screen')).toBe('Saved the screen')
    expect(activityActionLabel(undefined)).toBe('')
  })

  it('tells an AI row from any other', () => {
    expect(activityEntryGroupId({ action: 'ai.edit.applied' })).toBe('ai')
    expect(activityEntryGroupId({ action: 'Saved the screen' })).toBeUndefined()
    expect(activityEntryGroupId({})).toBeUndefined()
  })

  it('labels a target type a plugin declared, and core’s own', () => {
    // Core names no plugin's type; the noun comes from the registration.
    expect(activityTypeLabel('aiJob')).toBe('AI generation')
    expect(activityTypeLabel('subscription')).toBe('Subscription')
    expect(activityTypeLabel('role')).toBe('Role')
  })
})

describe('activityActorLabel', () => {
  it('names a person by the address the entry recorded', () => {
    expect(activityActorLabel({ actorEmail: 'person@example.test' })).toBe(
      'person@example.test',
    )
  })

  it('names an API key by its name, never as Someone (AGL-2632)', () => {
    expect(activityActorLabel({ actorEmail: null, apiKeyName: 'Zapier' })).toBe(
      'API key Zapier',
    )
  })

  it('names a workflow run by its workflow, never Someone', () => {
    expect(
      activityActorLabel({
        actorId: null,
        actorEmail: null,
        action: 'Workflow ran on contactCreated',
        target: { type: 'workflow', id: 'w1', name: 'Welcome' },
      }),
    ).toBe('Workflow Welcome')
    expect(
      activityActorLabel({ actorId: null, target: { type: 'workflow' } }),
    ).toBe('Workflow')
  })

  it('names the platform on a subscription event no console act signed', () => {
    expect(
      activityActorLabel({
        actorId: null,
        actorEmail: null,
        action: 'Canceled the subscription',
        target: { type: 'subscription', id: 'sub_1', name: 'pro' },
      }),
    ).toBe(PLATFORM_BRAND_NAME)
  })

  it('names a uid recorded without an address by the address it holds now', () => {
    expect(
      activityActorLabel({
        actorId: 'uid-1',
        actorEmail: null,
        actorEmailNow: 'owner@example.test',
        target: { type: 'subscription', name: 'pro' },
      }),
    ).toBe('owner@example.test')
  })

  it('prefers the address recorded then over the one looked up now', () => {
    expect(
      activityActorLabel({
        actorId: 'uid-1',
        actorEmail: 'then@example.test',
        actorEmailNow: 'now@example.test',
      }),
    ).toBe('then@example.test')
  })

  it('names the uid of an account that no longer resolves', () => {
    expect(activityActorLabel({ actorId: 'uid-1', actorEmail: null })).toBe(
      'Account uid-1',
    )
  })

  it('names a key written before its name was carried as an API key', () => {
    expect(activityActorLabel({ actorId: 'api', actorEmail: null })).toBe(
      'API key',
    )
  })

  it('tells a staff reader which staff member acted for the platform', () => {
    expect(
      activityActorLabel({
        actorId: null,
        staffActorEmail: 'staff@example.test',
        target: { type: 'subscription' },
      }),
    ).toBe(`${PLATFORM_BRAND_NAME} staff (staff@example.test)`)
  })

  it('names the platform for any other entry no person wrote', () => {
    expect(activityActorLabel({})).toBe(PLATFORM_BRAND_NAME)
    expect(activityActorLabel({ actorId: null, actorEmail: null })).toBe(
      PLATFORM_BRAND_NAME,
    )
    expect(activityActorLabel({ actorId: 'system:stripe-webhook' })).toBe(
      PLATFORM_BRAND_NAME,
    )
  })
})

describe('activityHref', () => {
  const orgSlug = 'acme'
  const host = 'shop'

  it('returns undefined without an orgSlug (no dead links)', () => {
    expect(
      activityHref(
        { target: { type: 'screen', id: 'abc' } },
        { host },
      ),
    ).toBeUndefined()
  })

  it('links a screen with a version to its detail view', () => {
    expect(
      activityHref(
        { target: { type: 'screen', id: 'scr1', versionId: 'v1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/screens/scr1/versions/v1/view')
  })

  it('links a version-less screen to the list', () => {
    expect(
      activityHref(
        { target: { type: 'screen', id: 'scr1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/screens')
  })

  it('links components, templates and layouts to their detail pages', () => {
    expect(
      activityHref(
        { target: { type: 'component', id: 'c1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/components/c1')
    expect(
      activityHref(
        { target: { type: 'template', id: 't1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/templates/t1')
    expect(
      activityHref(
        { target: { type: 'layout', id: 'l1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/layouts/l1')
  })

  it('links type-level host targets to their section', () => {
    // The Theme section lives under Setup; `/hosts/{host}/theme` is caught
    // by the plugin page route and names no page.
    expect(
      activityHref({ target: { type: 'theme' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/setup/theme')
    expect(
      activityHref({ target: { type: 'media' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/media')
  })

  it('routes org entries by scope (no hostId)', () => {
    expect(activityHref({ target: { type: 'org' } }, { orgSlug })).toBe(
      '/acme/settings',
    )
    expect(
      activityHref({ target: { type: 'member', id: 'uid9' } }, { orgSlug }),
    ).toBe('/acme/team/uid9')
    expect(
      activityHref({ target: { type: 'invite', id: 'inv1' } }, { orgSlug }),
    ).toBe('/acme/team')
  })

  it('routes org-level CRM entries into the org hub (AGL-2634)', () => {
    expect(
      activityHref({ target: { type: 'deal', id: 'd1' } }, { orgSlug }),
    ).toBe('/acme/crm/deals/d1')
    expect(
      activityHref({ target: { type: 'contact', id: 'c 1' } }, { orgSlug }),
    ).toBe('/acme/crm/contacts/c%201')
    // A bulk line names a kind and no record; a lead's org address needs
    // its site; a task has no page: each lands on the section.
    expect(activityHref({ target: { type: 'company' } }, { orgSlug })).toBe(
      '/acme/crm/companies',
    )
    expect(
      activityHref({ target: { type: 'lead', id: 'k1' } }, { orgSlug }),
    ).toBe('/acme/crm/leads')
    expect(
      activityHref({ target: { type: 'task', id: 't1' } }, { orgSlug }),
    ).toBe('/acme/crm/tasks')
  })

  it('tolerates legacy top-level type/targetId fields', () => {
    expect(
      activityHref({ type: 'org', targetId: 'o1' }, { orgSlug }),
    ).toBe('/acme/settings')
  })

  it('returns undefined for a type with nowhere to go', () => {
    expect(
      activityHref({ target: { type: 'mystery' } }, { orgSlug, host }),
    ).toBeUndefined()
  })

  /**
   * CRM work in Setup → Activity opens the record it names (AGL-2622), and
   * a deleted record's entry still lands on its list rather than on a 404.
   */
  it('links CRM entries into the hub, by record or by section', () => {
    expect(
      activityHref({ target: { type: 'contact', id: 'c1' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/crm/contacts/c1')
    expect(
      activityHref({ target: { type: 'lead', id: 'l1' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/crm/leads/l1')
    expect(
      activityHref({ target: { type: 'company', id: 'co1' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/crm/companies/co1')
    expect(
      activityHref({ target: { type: 'deal' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/crm/deals')
    expect(activityTypeLabel('deal')).toBe('Deal')
    expect(activityTypeLabel('lead')).toBe('Lead')
  })
})

describe('runTriggeredByLabel (AGL-3376)', () => {
  it('names whoever set the run off, never the automation itself', () => {
    expect(
      runTriggeredByLabel({
        triggeredBy: { kind: 'member', uid: 'u1', email: 'rep@example.test' },
      }),
    ).toBe('rep@example.test')
    expect(runTriggeredByLabel({ triggeredBy: { kind: 'member', uid: 'u1' } })).toBe(
      'Account u1',
    )
    expect(
      runTriggeredByLabel({ triggeredBy: { kind: 'apiKey', apiKeyName: 'Zapier' } }),
    ).toBe('API key Zapier')
    expect(
      runTriggeredByLabel({
        triggeredBy: { kind: 'visitor', email: 'guest@example.test' },
      }),
    ).toBe('Site visitor (guest@example.test)')
    expect(runTriggeredByLabel({ triggeredBy: { kind: 'visitor' } })).toBe(
      'Site visitor',
    )
    expect(
      runTriggeredByLabel({ triggeredBy: { kind: 'webhook', name: 'Stripe sync' } }),
    ).toBe('Inbound webhook Stripe sync')
    expect(runTriggeredByLabel({ triggeredBy: { kind: 'platform' } })).toBe(
      PLATFORM_BRAND_NAME,
    )
  })

  it('says a run written before its trigger was recorded is not recorded', () => {
    expect(runTriggeredByLabel({})).toBe('Not recorded')
    expect(runTriggeredByLabel({ triggeredBy: null })).toBe('Not recorded')
  })
})
