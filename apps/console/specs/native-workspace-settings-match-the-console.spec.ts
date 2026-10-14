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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONSOLE_WIDGET_SLOTS, PERSON_ERASURE_NOT_REACHED, PERSON_ERASURE_REMOVES, PERSON_ERASURE_RETAINS, resolveOrgEntitlements } from '@aglyn/aglyn'
import { RISK_OWNER_ACTIONS } from '@aglyn/shared-util-email/risk-notice-catalog'

/**
 * The native Workspace settings screens say what the console's cards say and
 * ask the routes the console's cards ask (AGL-3671): the API key scopes, the
 * privacy card's exports and its erasure lists, the holds a workspace can have
 * and what to do about each, the single sign-on steps and the plan each of
 * these needs.
 */
const ROOT = join(__dirname, '../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
/** Source with its string concatenations joined and its white space collapsed, to compare sentences. */
const flat = (text: string) => text.replace(/['"`]\s*\+\s*['"`]/g, '').replace(/\s+/g, ' ')

interface Block {
  type: string
  id?: string
  title?: string
  when?: string
  text?: string
  rows?: Array<{ label: string; value: string }>
  items?: Array<Record<string, unknown>> | string
  badges?: Array<{ text: string; when?: string }>
  fields?: Array<Record<string, unknown>>
  submit?: Record<string, unknown>
  [key: string]: unknown
}
interface Screen {
  id: string
  actions?: Array<Record<string, unknown>>
  blocks: Block[]
  load?: Record<string, unknown>
}
const screens = (JSON.parse(read('libs/native/screens/workspace.screens.json')) as { screens: Screen[] }).screens
const screen = (id: string): Screen => {
  const found = screens.find((one) => one.id === id)
  if (!found) throw new Error(`no screen ${id}`)
  return found
}
const nativeText = (id: string) => flat(JSON.stringify(screen(id)))
const sentences = (consoleSource: string, native: string, wanted: string[]) => {
  const console_ = flat(consoleSource)
  for (const sentence of wanted) {
    expect([sentence, console_.includes(sentence)]).toEqual([sentence, true])
    expect([sentence, native.includes(sentence)]).toEqual([sentence, true])
  }
}

describe('native workspace settings', () => {
  describe('API keys', () => {
    const card = read('apps/console/components/org-api-keys-card.component.tsx')
    const consoleScopes = [...card.matchAll(/\{ scope: '([a-z]+:[a-z]+)', label: '([^']*)', description: '((?:[^'\\]|\\.)*)' \}/g)].map((match) => ({
      scope: match[1],
      label: match[2],
      description: match[3].replace(/\\'/g, "'"),
    }))

    it('offers every scope the console offers, with its words, and the server knows each', () => {
      expect(consoleScopes.length).toBeGreaterThan(15)
      const create = screen('core.settings.apiKeys').actions?.find((action) => action['id'] === 'create') as {
        prompt: Array<{ key: string; label: string; kind: string; help?: string; initial?: string }>
        body: { scopes: { $pick: Record<string, string> } }
      }
      const toggles = create.prompt.filter((field) => field.kind === 'toggle')
      expect(toggles.map((field) => [field.label, field.help])).toEqual(consoleScopes.map((one) => [one.label, one.description]))
      const picked = create.body.scopes.$pick
      expect(Object.keys(picked)).toEqual(consoleScopes.map((one) => one.scope))
      for (const [scope, template] of Object.entries(picked)) {
        const field = toggles.find((one) => `{form.${one.key}}` === template)
        expect([scope, Boolean(field)]).toEqual([scope, true])
      }
      // The console starts a new key with datasets:read ticked, and no other.
      expect(toggles.filter((field) => field.initial === 'true').map((field) => picked && Object.entries(picked).find(([, value]) => value === `{form.${field.key}}`)?.[0])).toEqual(['datasets:read'])
      const server = read('libs/tenant/data/admin/src/lib/server/api-keys.ts')
      const serverScopes = [...(/export const API_SCOPES = \[([\s\S]*?)\] as const/.exec(server)?.[1] ?? '').matchAll(/'([a-z]+:[a-z]+)'/g)].map((match) => match[1])
      expect([...serverScopes].sort()).toEqual(consoleScopes.map((one) => one.scope).sort())
    })

    it('says what the console says, and asks for the plan the console asks for', () => {
      sentences(card, nativeText('core.settings.apiKeys'), [
        'A key is shown once at creation — store it somewhere safe. Each key is scoped to exactly what it needs.',
        'will stop working immediately. This cannot be undone.',
        'This is the only time the key is shown. Copy it now and store it securely — you can’t retrieve it later.',
        'No API keys yet.',
      ])
      expect(nativeText('core.settings.apiKeys')).toContain('The REST API and API keys are included on the Business plan — see Billing to upgrade.')
      expect(card).toContain("checkEntitlement(org, 'apiAccess')")
      expect(Object.keys(resolveOrgEntitlements(null).features)).toContain('apiAccess')
      expect(nativeText('core.settings.apiKeys')).toContain('data.ent.features.apiAccess')
    })
  })

  describe('Branding', () => {
    const card = read('apps/console/components/org-branding-card.component.tsx')
    it('needs the plan the console needs, and says what the console says', () => {
      expect(card).toContain("checkEntitlement(org, 'whiteLabel')")
      expect(Object.keys(resolveOrgEntitlements(null).features)).toContain('whiteLabel')
      const native = nativeText('core.settings.branding')
      expect(native).toContain('data.ent.features.whiteLabel')
      sentences(card, native, [
        'Shown in the console chrome, site badge, and emails.',
        'Display name on transactional email (the verified sending address is unchanged).',
        'CSS hex color used for the console primary and site badge.',
        'Saved now; domain routing to it ships in a later phase.',
        'Leave a field blank to keep the',
      ])
    })
  })

  describe('Profile', () => {
    const card = read('apps/console/components/settings/org-profile-card.component.tsx')
    it('shows the billing address and where it is edited, in the console words', () => {
      const native = nativeText('core.settings.profile')
      sentences(card, native, [
        'No billing address on file.',
        'Where Aglyn bills this organization, and the tax input on what you pay us.',
        'Invoices use a different address',
        'The last change did not reach Stripe, so invoices and tax still use the previous address.',
        'Shown in place of the logo above when the console is in dark mode. Leave it blank to use the same logo in both.',
        'Edit in Billing settings',
      ])
      for (const key of ['line1', 'line2', 'city', 'state', 'postalCode', 'country']) expect(native).toContain(`data.org.contact.address.${key}`)
      expect(native).toContain('data.org.billing.addressDivergedFromStripe')
      expect(native).toContain('data.org.billing.addressDivergedReason')
      expect(card).toContain('addressDivergedFromStripe')
      expect(native).toContain('core.billing.settings')
    })
  })

  describe('Privacy', () => {
    const card = read('apps/console/components/settings/org-privacy-card.component.tsx')
    it('exports the files the console exports, titled as it titles them', () => {
      const files = [...card.matchAll(/\{ resource: '([a-z.]+)', label: '([^']*)', title: '([^']*)' \}/g)].map((match) => ({ resource: match[1], label: match[2], title: match[3] }))
      expect(files.map((file) => file.resource)).toEqual(['crm.contacts', 'crm.leads'])
      const actions = (screen('core.settings.privacy').blocks.find((block) => block.title === 'Export the people you hold')?.items ?? []) as Array<{
        label: string
        export: { resource: string; title: string }
      }>
      expect(actions.map((action) => [action.label, action.export.resource, action.export.title])).toEqual(files.map((file) => [file.label, file.resource, file.title]))
    })

    it('lists what an erasure removes, keeps and cannot reach, as the console does', () => {
      const bullets = (heading: string, lines: readonly string[]) => `${heading}\n${lines.map((line) => `• ${line}`).join('\n')}`
      const texts = screen('core.settings.privacy').blocks.filter((block) => block.type === 'notice').map((block) => block.text)
      expect(texts).toContain(bullets('Removed across the workspace', PERSON_ERASURE_REMOVES))
      expect(texts).toContain(bullets('Kept, with the person taken off', PERSON_ERASURE_RETAINS))
      expect(texts).toContain(bullets('Not reached — finish these by hand', PERSON_ERASURE_NOT_REACHED))
      sentences(card, nativeText('core.settings.privacy'), [
        'A privacy erasure, not a delete: the person is removed from every site in this workspace, whether or not a page shows them.',
        'Erasure requested — it runs with the nightly job',
        'An erasure was already pending for this person',
        'Available on every plan, whether or not it includes the CRM.',
      ])
    })
  })

  describe('Holds and reviews', () => {
    const card = read('apps/console/components/settings/org-holds-card.component.tsx')
    const dialog = read('apps/console/components/settings/request-review-dialog.component.tsx')

    it('names each status as the console does', () => {
      const labels = [...card.matchAll(/'?([a-z-]+)'?: \{ label: '([^']*)', color: '([a-z]+)' \}/g)].map((match) => [match[1], match[2]])
      expect(labels).toEqual([
        ['held', 'Held'],
        ['in-review', 'In review'],
        ['released', 'Released'],
        ['rejected', 'Not approved'],
        ['closed', 'Closed'],
      ])
      const badges = (screen('core.settings.holds').blocks[0].badges ?? []).map((badge) => [badge.when, badge.text])
      for (const [status, label] of labels) expect(badges).toContainEqual([`item.status == ${status}`, label])
      expect(badges).toContainEqual(['item.severity == urgent', 'Needs attention'])
      expect(card).toContain('Needs attention')
    })

    it('offers each owner action the console links to, labeled as the catalog labels it', () => {
      const detail = screen('core.settings.holds.notice')
      const actions = (detail.blocks.find((block) => block.title === 'Next')?.items ?? []) as Array<{ id: string; label: string; route?: string }>
      const routed = actions.filter((action) => action.route)
      const wanted = ['view-details', 'edit-and-resubmit', 'refund-order', 'keep-order', 'answer-dispute', 'update-payment-method', 'view-billing', 'release-gift-cards', 'view-marketplace-sales', 'contact-support']
      expect(routed.map((action) => action.id)).toEqual(wanted)
      for (const action of routed) {
        expect([action.id, action.label]).toEqual([action.id, RISK_OWNER_ACTIONS[action.id as keyof typeof RISK_OWNER_ACTIONS].label])
        expect(action.route).toContain(`actions[id='${action.id}'].href`)
      }
      // Request a review has its own dialog, and the help link opens the page the route names.
      expect(actions.map((action) => action.label)).toEqual(expect.arrayContaining(['Request a review', 'Why was this held?']))
    })

    it('says what the console says', () => {
      sentences(card, nativeText('core.settings.holds'), [
        'Anything on this workspace that was held, flagged or locked, and what to do about it',
        'Nothing on this workspace is held or under review.',
      ])
      sentences(card, nativeText('core.settings.holds.notice'), ['What to do next'])
      sentences(dialog, nativeText('core.settings.holds'), [
        'Tell us what this is for and why it is genuine. A person reads every request, on the same case our team already has open. Requesting a review does not release anything by itself.',
        'Your note',
      ])
    })
  })

  describe('Single sign-on', () => {
    const card = read('apps/console/components/org-sso-card.component.tsx')
    const route = read('apps/console/app/api/orgs/sso/route.ts')
    const native = [screen('core.settings.sso'), screen('core.settings.sso.enforcement')].map((one) => JSON.stringify(one)).join('')

    it('calls every action the card calls, and the route knows each', () => {
      const actions = [...card.matchAll(/action: '([a-z-]+)'/g)].map((match) => match[1])
      expect([...new Set(actions)].sort()).toEqual(
        ['activate', 'add-domain', 'disable', 'enforce-apply', 'enforce-off', 'enforce-preview', 'remove-domain', 'save-idp', 'set-break-glass', 'status', 'verify-domain'].sort(),
      )
      for (const action of new Set(actions)) {
        expect([action, native.includes(`"action":"${action}"`)]).toEqual([action, true])
        expect([action, route.includes(`'${action}'`)]).toEqual([action, true])
      }
    })

    it('needs the plan the console needs, and says what the console says', () => {
      expect(card).toContain("checkEntitlement(org, 'ssoEnabled')")
      expect(Object.keys(resolveOrgEntitlements(null).features)).toContain('ssoEnabled')
      expect(native).toContain('data.ent.features.ssoEnabled')
      sentences(card, flat(native), [
        'Single sign-on is part of Enterprise.',
        'Add each email domain your team signs in with.',
        'We found a record but the value did not match. Seen:',
        'No matching TXT record yet — DNS can take a few minutes.',
        'Verify at least one domain before turning single sign-on on.',
        'Second signing certificate (optional)',
        'The public certificate from your IdP, PEM or base64',
        'Enforcing removes every other way into an account in your identity pool',
        'Rehearse it first: the rehearsal changes nothing and shows you exactly which accounts are affected.',
        'Before you can enforce, your organization needs one way in that survives your identity provider failing',
        'No account in your identity pool can serve as break-glass',
        'We could not finish checking whether your organization has an owner outside the identity pool',
        'Passwords and linked social logins will be removed from every account in your identity pool, except the break-glass accounts you designated.',
        'Break-glass accounts saved',
      ])
    })
  })

  describe('General', () => {
    const card = read('apps/console/components/settings/org-general-card.component.tsx')
    it('says what the console says', () => {
      sentences(card, nativeText('core.settings.general'), [
        'Changing these settings requires the admin role.',
        'Every site in this workspace dates its posts and pages in this zone, unless the site sets its own under Admin',
        'The old URL keeps redirecting, but share the new one going forward.',
        'Only the organization owner can change the URL.',
        'Plan, billing and suspension are managed under',
      ])
    })
  })
  describe('Ownership', () => {
    const card = read('apps/console/components/settings/org-ownership-card.component.tsx')
    it('offers every other member, and says what the console says', () => {
      const native = nativeText('core.settings.ownership')
      sentences(card, native, [
        'Hand the organization to another member. They gain billing, workspace-URL and transfer powers; you step down to admin.',
        'becomes the organization owner (billing, workspace URL, and ownership transfers). You step down to admin. This cannot be undone by you afterwards.',
        'Ownership transferred — you are now an admin',
        'Invite a member from the Team page first.',
      ])
      // The console lists every member but the owner themselves, not only the admins.
      expect(native).toContain('"filter":"item.$id != @user.uid"')
      expect(native).not.toContain('item.role == admin')
    })
  })
  describe('Delete', () => {
    const card = read('apps/console/components/settings/org-delete-card.component.tsx')
    const exportCard = read('apps/console/components/data-export-card.component.tsx')
    it('says what the console says', () => {
      const native = nativeText('core.settings.delete')
      sentences(card, native, [
        'Permanently delete this organization and everything in it — sites, files, datasets, and members. Nothing is removed for 7 days and you can cancel, then erasure is irreversible and we keep no copy of it. Export anything you want to keep first.',
        'This organization is scheduled for deletion. After a 7-day hold, all of its sites, files, and data are permanently erased. Cancel now to keep it.',
        'Deletion canceled — your organization is safe.',
      ])
      sentences(exportCard, native, [
        'A machine-readable JSON copy of everything this workspace holds — its sites and their content, datasets, contacts, orders, form submissions, members, support threads and billing identifiers. Owners and admins only.',
        'Your data is downloading.',
      ])
    })
  })
  describe('Plugin pages', () => {
    const consoleList = read('apps/console/app/(app)/[orgSlug]/plugins/page.tsx')
    const consolePage = read('apps/console/app/(app)/[orgSlug]/plugins/[pluginRef]/page.tsx')

    it('hands the marketplace the two slots the console hands it, and keeps a built-in plugin\'s blocks to the built-in plugins', () => {
      expect(consoleList).toContain('slot="orgPluginInstalls"')
      expect(consolePage).toContain('slot="pluginInstallStatus"')
      expect(consolePage).toContain('slot="pluginSiteSet"')
      const list = screen('core.plugins')
      expect(list.blocks.map((block) => [block.type, block['name']])).toContainEqual(['zone', 'orgPluginInstalls'])
      expect((list.actions ?? []).map((action) => [action['id'], action['route']])).toEqual([['install', '/{org.slug}/marketplace']])
      const page = screen('core.plugin')
      const zone = page.blocks.find((block) => block.type === 'zone' && block['name'] === 'pluginInstallation')
      expect(zone?.when).toBe('!data.plugins.rows[id=params.pluginId]')
      expect(zone?.['params']).toEqual({ pluginId: '{params.pluginId}' })
      expect((page.actions ?? []).map((action) => [action['id'], action['route']])).toEqual([['viewListing', '/{org.slug}/marketplace/{params.pluginId}']])
      // Every block that speaks of the plugin as a built-in one is gated on it being one.
      const row = 'data.plugins.rows[id=params.pluginId]'
      for (const block of page.blocks.filter((one) => one.type !== 'zone' && one.type !== 'links')) {
        expect([block.title ?? block.type, String(block.when ?? '').includes(row)]).toEqual([block.title ?? block.type, true])
      }
    })

    it('says what the console says about a plugin that is not installed, is behind, or may do what', () => {
      const status = read('libs/plugins/marketplace/src/lib/components/plugin-install-status.component.tsx')
      expect(flat(consolePage)).toContain('This plugin is not installed in this organization. Install it from its marketplace listing.')
      expect(flat(consolePage)).toContain('None declared — it cannot reach host data directly.')
      expect(flat(consolePage)).toContain('No network origins declared; its CSP blocks outbound requests.')
      expect(status).toContain('updateStateLabel(status)')
      expect(read('libs/plugins/marketplace/src/lib/components/org-plugin-installs-card.component.tsx')).toContain('Nothing installed from the marketplace yet — browse it to add one.')
      const native = flat(read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/PluginPages.swift') + read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/PluginPages.kt'))
      for (const sentence of [
        'Nothing installed from the marketplace yet — browse it to add one.',
        'This plugin is not installed in this organization. Install it from its marketplace listing.',
        'None declared — it cannot reach host data directly.',
        'No network origins declared; its CSP blocks outbound requests.',
        'Add to more sites',
        'Add to selected',
        'Install for the whole organization',
        'Split into per-site installs',
        'Pins each site separately so you can update them one at a time. Sites you add later will not get this plugin automatically.',
        'Uninstall org-wide',
      ]) {
        expect([sentence, native.includes(sentence)]).toEqual([sentence, true])
      }
    })
  })
  describe('Integrations', () => {
    it('fills the slot the console fills, in the console\'s words', () => {
      const page = read('apps/console/app/(app)/[orgSlug]/settings/(sections)/integrations/page.tsx')
      expect(CONSOLE_WIDGET_SLOTS.orgSettings).toBe('orgSettings')
      expect(page).toContain('CONSOLE_WIDGET_SLOTS.orgSettings')
      const native = screen('core.settings.integrations')
      expect(native.blocks.filter((block) => block.type === 'zone').map((block) => block['name'])).toEqual([CONSOLE_WIDGET_SLOTS.orgSettings])
      sentences(page, nativeText('core.settings.integrations'), ['Integrations appear here when a plugin that offers one is turned on.'])
    })
  })
})
