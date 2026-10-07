/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The plugin surfaces' tab titles (AGL-2184): each surface's name, and the
 * sections on its rail, as the plugins' nav items and section lists name
 * them. Data for the console's server layouts, which cannot load the
 * console registry. Source of truth: the plugins in plugins.config.json.
 */

/** A surface's display name, by its URL slug. */
export const PLUGIN_SURFACE_TITLES: Readonly<Record<string, string>> = {
  'ai-jobs': 'AI jobs',
  automation: 'Automation',
  bookings: 'Bookings',
  crm: 'CRM',
  data: 'Data',
  emails: 'Emails',
  events: 'Events',
  forms: 'Forms',
  inbox: 'Inbox',
  logic: 'Logic',
  marketing: 'Marketing',
  marketplace: 'Marketplace',
  outreach: 'Sequences',
  pos: 'POS',
  products: 'Products',
  redirects: 'Redirects',
}

/** The sections a surface's rail declares, id to display name, by the surface's URL slug. */
export const PLUGIN_SURFACE_SECTIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  automation: {
    workflows: 'Workflows',
    actions: 'Actions',
    webhooks: 'Webhooks',
    automations: 'Org automations',
  },
  crm: {
    contacts: 'Contacts',
    leads: 'Leads',
    companies: 'Companies',
    deals: 'Deals',
    tasks: 'Tasks',
    reports: 'Reports',
    fields: 'Fields',
    settings: 'Settings',
  },
  emails: {
    messages: 'Messages',
    templates: 'Templates',
    audiences: 'Audiences',
    topics: 'Topics',
    sending: 'Sending',
    'consent-groups': 'Consent groups',
    suppressions: 'Suppressions',
  },
  inbox: {
    submissions: 'Submissions',
    contacts: 'Members & leads',
    campaigns: 'Campaigns',
  },
  marketing: {
    overview: 'Overview',
    campaigns: 'Campaigns',
    conversions: 'Conversions',
    overlays: 'Overlays',
    experiments: 'A/B testing',
  },
  outreach: {
    sequences: 'All sequences',
    mailboxes: 'Mailboxes',
    compliance: 'Compliance',
  },
  products: {
    catalog: 'Catalog',
    orders: 'Orders',
    returns: 'Returns',
    promotions: 'Promotions',
    reservations: 'Reservations',
    settings: 'Settings',
    analytics: 'Analytics',
  },
}

/** The noun for one record's page beneath a surface that owns its subtree, by the surface's URL slug. */
export const PLUGIN_SURFACE_RECORD_TITLES: Readonly<Record<string, string>> = {
  'ai-jobs': 'Building your site',
}
