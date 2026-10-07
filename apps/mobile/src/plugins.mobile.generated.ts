/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The mobile apps' plugin manifest (AGL-3620), from each plugin's `mobile`
 * block in plugins.config.json. Only the mobile apps import it; each entry
 * loads the plugin's `./mobile` entry and nothing else.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { MobilePluginManifest } from '@aglyn/mobile-plugin-host'

export const MOBILE_PLUGIN_MANIFEST: MobilePluginManifest = [
  {
    id: 'forms',
    register: 'registerFormsMobile',
    contributes: {"screens":["forms.form","forms.list"],"quickActions":["forms.submissions"],"deepLinks":["forms.page","forms.record"]},
    load: () => import('@aglyn/plugins-forms/mobile'),
  },
  {
    id: 'crm',
    register: 'registerCrmMobile',
    contributes: {"screens":["crm.companies","crm.company","crm.contact","crm.contacts","crm.deal","crm.deals","crm.home","crm.lead","crm.leads"],"tabs":["crm.tab"],"widgets":["crm.openLeads"],"quickActions":["crm.dealsAction","crm.leadsAction"],"deepLinks":["crm.companiesPage","crm.companyPage","crm.contactPage","crm.contactsPage","crm.dealPage","crm.dealsPage","crm.leadPage","crm.leadsPage","crm.page"]},
    load: () => import('@aglyn/plugins-crm/mobile'),
  },
  {
    id: 'inbox',
    register: 'registerInboxMobile',
    contributes: {"screens":["inbox.submission","inbox.submissions"],"tabs":["inbox.tab"],"deepLinks":["inbox.page","inbox.submissionsPage"]},
    load: () => import('@aglyn/plugins-inbox/mobile'),
  },
  {
    id: 'marketing',
    register: 'registerMarketingMobile',
    contributes: {"screens":["marketing.campaign","marketing.campaigns"],"quickActions":["marketing.open"],"deepLinks":["marketing.campaignPage","marketing.campaignsPage","marketing.message","marketing.messages"]},
    load: () => import('@aglyn/plugins-marketing/mobile'),
  },
  {
    id: 'redirects',
    register: 'registerRedirectsMobile',
    contributes: {"screens":["redirects.list"],"widgets":["redirects.summary"],"quickActions":["redirects.open"],"deepLinks":["redirects.page"]},
    load: () => import('@aglyn/plugins-redirects/mobile'),
  },
]
