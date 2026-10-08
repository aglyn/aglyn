// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

import AglynPluginHost
import AglynBookingsPlugin
import AglynCommercePlugin
import AglynCrmPlugin
import AglynEmailPlugin
import AglynEventsCalendarPlugin
import AglynFormsPlugin
import AglynFunnelsPlugin
import AglynInboxPlugin
import AglynMarketingPlugin
import AglynOutreachPlugin
import AglynRedirectsPlugin
import AglynSmsPlugin
import AglynWorkflowsPlugin

public enum NativePluginManifest {
  public static let entries: [NativePluginManifestEntry] = [
    NativePluginManifestEntry(
      id: "bookings",
      contributes: ["screens": ["bookings.booking", "bookings.calendar", "bookings.counter", "bookings.services"], "widgets": ["bookings.today"], "quickActions": ["bookings.open"], "deepLinks": ["bookings.page"]],
      register: AglynBookingsPlugin.registerBookingsNative
    ),
    NativePluginManifestEntry(
      id: "commerce",
      contributes: ["screens": ["commerce.card-readers", "commerce.order", "commerce.orders", "commerce.product", "commerce.products", "commerce.register", "commerce.sales", "commerce.scan"], "tabs": ["commerce.orders-tab", "commerce.products-tab"], "widgets": ["commerce.sales-trend", "commerce.to-ship", "commerce.today"], "quickActions": ["commerce.new-product", "commerce.orders-to-ship", "commerce.scan"], "deepLinks": ["commerce.orders-page", "commerce.products-page"]],
      register: AglynCommercePlugin.registerCommerceNative
    ),
    NativePluginManifestEntry(
      id: "crm",
      contributes: ["screens": ["crm.companies", "crm.company", "crm.contact", "crm.contacts", "crm.deal", "crm.deals", "crm.fields", "crm.lead", "crm.leads", "crm.reports", "crm.settings", "crm.tasks"], "widgets": ["crm.glance", "crm.tasks-due"], "quickActions": ["crm.deals-action", "crm.open", "crm.tasks-action"], "deepLinks": ["crm.companies-page", "crm.company-page", "crm.contact-page", "crm.contacts-page", "crm.deal-page", "crm.deals-page", "crm.fields-page", "crm.lead-page", "crm.leads-page", "crm.legacy-contacts", "crm.page", "crm.reports-page", "crm.settings-page", "crm.tasks-page"]],
      register: AglynCrmPlugin.registerCrmNative
    ),
    NativePluginManifestEntry(
      id: "email",
      contributes: ["screens": ["email.audiences", "email.messages", "email.sending", "email.suppressions", "email.templates", "email.topics"], "quickActions": ["email.open"], "deepLinks": ["email.audiences-page", "email.list-page", "email.message-page", "email.messages-page", "email.page", "email.sending-page", "email.suppressions-page", "email.templates-page", "email.topics-page"]],
      register: AglynEmailPlugin.registerEmailNative
    ),
    NativePluginManifestEntry(
      id: "events-calendar",
      contributes: ["screens": ["events-calendar.events"], "quickActions": ["events-calendar.open"], "deepLinks": ["events-calendar.page"]],
      register: AglynEventsCalendarPlugin.registerEventsCalendarNative
    ),
    NativePluginManifestEntry(
      id: "forms",
      contributes: ["screens": ["forms.form", "forms.list"], "quickActions": ["forms.open"], "deepLinks": ["forms.page", "forms.record"]],
      register: AglynFormsPlugin.registerFormsNative
    ),
    NativePluginManifestEntry(
      id: "funnels",
      contributes: ["screens": ["funnels.list"], "quickActions": ["funnels.open"], "deepLinks": ["funnels.page"]],
      register: AglynFunnelsPlugin.registerFunnelsNative
    ),
    NativePluginManifestEntry(
      id: "inbox",
      contributes: ["screens": ["inbox.people", "inbox.submission", "inbox.submissions"], "widgets": ["inbox.glance"], "quickActions": ["inbox.open", "inbox.people"], "deepLinks": ["inbox.page", "inbox.people-page", "inbox.submissions-page"]],
      register: AglynInboxPlugin.registerInboxNative
    ),
    NativePluginManifestEntry(
      id: "marketing",
      contributes: ["screens": ["marketing.campaigns", "marketing.conversions", "marketing.experiments", "marketing.overlays", "marketing.overview"], "quickActions": ["marketing.open"], "deepLinks": ["marketing.campaign-page", "marketing.campaigns-page", "marketing.conversions-page", "marketing.experiments-page", "marketing.inbox-campaigns-page", "marketing.overlays-page", "marketing.overview-page", "marketing.page"]],
      register: AglynMarketingPlugin.registerMarketingNative
    ),
    NativePluginManifestEntry(
      id: "outreach",
      contributes: ["screens": ["outreach.compliance", "outreach.mailboxes", "outreach.sequences"], "widgets": ["outreach.glance"], "deepLinks": ["outreach.compliance-page", "outreach.mailboxes-page", "outreach.page", "outreach.sequence-page", "outreach.sequences-page"]],
      register: AglynOutreachPlugin.registerOutreachNative
    ),
    NativePluginManifestEntry(
      id: "redirects",
      contributes: ["screens": ["redirects.list"], "widgets": ["redirects.summary"], "quickActions": ["redirects.open"], "deepLinks": ["redirects.page"]],
      register: AglynRedirectsPlugin.registerRedirectsNative
    ),
    NativePluginManifestEntry(
      id: "sms",
      contributes: ["screens": ["sms.texts"], "quickActions": ["sms.open"]],
      register: AglynSmsPlugin.registerSmsNative
    ),
    NativePluginManifestEntry(
      id: "workflows",
      contributes: ["screens": ["workflows.action", "workflows.automation", "workflows.org-automation", "workflows.runs", "workflows.webhook", "workflows.workflow"], "quickActions": ["workflows.open"], "deepLinks": ["workflows.page"]],
      register: AglynWorkflowsPlugin.registerWorkflowsNative
    ),
  ]
}
