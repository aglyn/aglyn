// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

import AglynPluginHost
import AglynAccountingPlugin
import AglynAdConversionsPlugin
import AglynAiPlugin
import AglynBookingsPlugin
import AglynCommercePlugin
import AglynCouriersPlugin
import AglynCrmPlugin
import AglynDataPlugin
import AglynDeliveryAppsPlugin
import AglynEmailPlugin
import AglynEventsCalendarPlugin
import AglynFormsPlugin
import AglynFulfillmentNetworksPlugin
import AglynFunnelsPlugin
import AglynInboxPlugin
import AglynInventorySyncPlugin
import AglynLiveChatPlugin
import AglynLogicPlugin
import AglynLoyaltyPlugin
import AglynMarketingPlugin
import AglynMarketingPlatformsPlugin
import AglynMarketplacePlugin
import AglynMarketplacesPlugin
import AglynOutreachPlugin
import AglynPostPurchasePlugin
import AglynPrintOnDemandPlugin
import AglynRedirectsPlugin
import AglynReviewPlatformsPlugin
import AglynSalesChannelsPlugin
import AglynShippingPlugin
import AglynSmsPlugin
import AglynTaxEnginesPlugin
import AglynWorkflowsPlugin
import AglynZapierPlugin

public enum NativePluginManifest {
  public static let entries: [NativePluginManifestEntry] = [
    NativePluginManifestEntry(
      id: "accounting",
      contributes: ["screens": ["accounting.activity", "accounting.attention", "accounting.books"], "deepLinks": ["accounting.books.link", "accounting.books.link2"]],
      register: AglynAccountingPlugin.registerAccountingNative
    ),
    NativePluginManifestEntry(
      id: "ad-conversions",
      contributes: ["screens": ["ad-conversions.provider", "ad-conversions.service"], "widgets": ["ad-conversions.service.card"]],
      register: AglynAdConversionsPlugin.registerAdConversionsNative
    ),
    NativePluginManifestEntry(
      id: "ai",
      contributes: ["screens": ["ai.allotment", "ai.create", "ai.credits", "ai.hostMember", "ai.import.productCopy", "ai.job", "ai.jobs", "ai.member", "ai.orgsSpendColumn", "ai.request", "ai.requests", "ai.signals", "ai.staffOrg", "ai.staffRequests", "ai.staffUser"], "widgets": ["ai.assist-panel", "ai.create-component", "ai.create-form", "ai.create-layout", "ai.create-page", "ai.create-template", "ai.insight-ask", "ai.needs-you", "ai.org-insight-ask", "ai.seo-audit", "ai.seo-start", "ai.site-memory"], "quickActions": ["ai.open"], "deepLinks": ["ai.job.link", "ai.jobs.link", "ai.signals.link"]],
      register: AglynAiPlugin.registerAINative
    ),
    NativePluginManifestEntry(
      id: "bookings",
      contributes: ["screens": ["bookings.booking", "bookings.calendar", "bookings.counter", "bookings.services"], "widgets": ["bookings.needs-you", "bookings.today"], "quickActions": ["bookings.open"], "deepLinks": ["bookings.page"]],
      register: AglynBookingsPlugin.registerBookingsNative
    ),
    NativePluginManifestEntry(
      id: "commerce",
      contributes: ["screens": ["commerce.card-readers", "commerce.categories", "commerce.collection", "commerce.collectionProducts", "commerce.collectionRules", "commerce.collections", "commerce.coupons", "commerce.discounts", "commerce.display", "commerce.fulfillmentDelivery", "commerce.fulfillmentPickup", "commerce.fulfillmentQueue", "commerce.giftCards", "commerce.giftCardsSearch", "commerce.import.giftCards", "commerce.kiosk", "commerce.localDelivery", "commerce.locations", "commerce.manage", "commerce.memberPosts", "commerce.notifications", "commerce.order", "commerce.orderServices", "commerce.orderWebhookDeliveries", "commerce.orderWebhooks", "commerce.orders", "commerce.ordersBulk", "commerce.paymentMethods", "commerce.payments", "commerce.product", "commerce.productDetails", "commerce.productMedia", "commerce.productRelated", "commerce.products", "commerce.promotions", "commerce.recovery", "commerce.register", "commerce.reservations", "commerce.return", "commerce.returnSettings", "commerce.returns", "commerce.returnsByStatus", "commerce.reviewSettings", "commerce.reviews", "commerce.sales", "commerce.scan", "commerce.settings", "commerce.shipping", "commerce.shippingTiers", "commerce.shippingeasy", "commerce.shipstation", "commerce.startReturn", "commerce.stockMovements", "commerce.stockMovementsLocation", "commerce.stockMovementsLocations", "commerce.stockMovementsOrder", "commerce.stockMovementsProduct", "commerce.stockMovementsProducts", "commerce.stockMovementsReason", "commerce.storeSettings", "commerce.suppliers", "commerce.tax", "commerce.taxSummary", "commerce.transfer"], "tabs": ["commerce.orders-tab", "commerce.products-tab"], "widgets": ["commerce.glance", "commerce.needs-you", "commerce.newest-site-users", "commerce.sales-trend", "commerce.to-ship", "commerce.today"], "quickActions": ["commerce.new-product", "commerce.orders-to-ship", "commerce.scan"], "deepLinks": ["commerce.orders-page", "commerce.products-page"]],
      register: AglynCommercePlugin.registerCommerceNative
    ),
    NativePluginManifestEntry(
      id: "couriers",
      contributes: ["screens": ["couriers.order", "couriers.service"]],
      register: AglynCouriersPlugin.registerCouriersNative
    ),
    NativePluginManifestEntry(
      id: "crm",
      contributes: ["screens": ["crm.companies", "crm.company", "crm.contact", "crm.contacts", "crm.deal", "crm.deals", "crm.fields", "crm.lead", "crm.leads", "crm.reports", "crm.settings", "crm.tasks"], "widgets": ["crm.glance", "crm.org-glance", "crm.org-tasks-due", "crm.tasks-due"], "quickActions": ["crm.deals-action", "crm.open", "crm.tasks-action"], "deepLinks": ["crm.companies-page", "crm.company-page", "crm.contact-page", "crm.contacts-page", "crm.deal-page", "crm.deals-page", "crm.fields-page", "crm.lead-page", "crm.leads-page", "crm.legacy-contacts", "crm.page", "crm.reports-page", "crm.settings-page", "crm.tasks-page"]],
      register: AglynCrmPlugin.registerCrmNative
    ),
    NativePluginManifestEntry(
      id: "data",
      contributes: ["screens": ["data.datasets", "data.records", "data.schema"], "quickActions": ["data.open"], "deepLinks": ["data.page"]],
      register: AglynDataPlugin.registerDataNative
    ),
    NativePluginManifestEntry(
      id: "delivery-apps",
      contributes: ["screens": ["delivery-apps.match", "delivery-apps.service", "delivery-apps.store"], "widgets": ["delivery-apps.pos-orders"]],
      register: AglynDeliveryAppsPlugin.registerDeliveryAppsNative
    ),
    NativePluginManifestEntry(
      id: "email",
      contributes: ["screens": ["email.audiences", "email.import.consent", "email.import.existing", "email.list.transfer", "email.messages", "email.sending", "email.suppressions", "email.templates", "email.topics"], "quickActions": ["email.open"], "deepLinks": ["email.audiences-page", "email.list-page", "email.message-page", "email.messages-page", "email.page", "email.sending-page", "email.suppressions-page", "email.templates-page", "email.topics-page"]],
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
      id: "fulfillment-networks",
      contributes: ["screens": ["fulfillment-networks.network", "fulfillment-networks.order", "fulfillment-networks.service"]],
      register: AglynFulfillmentNetworksPlugin.registerFulfillmentNetworksNative
    ),
    NativePluginManifestEntry(
      id: "funnels",
      contributes: ["screens": ["funnels.list"], "quickActions": ["funnels.open"], "deepLinks": ["funnels.page"]],
      register: AglynFunnelsPlugin.registerFunnelsNative
    ),
    NativePluginManifestEntry(
      id: "inbox",
      contributes: ["screens": ["inbox.people", "inbox.submission", "inbox.submissions"], "widgets": ["inbox.glance", "inbox.needs-you", "inbox.sidebar-count"], "quickActions": ["inbox.open", "inbox.people"], "deepLinks": ["inbox.page", "inbox.people-page", "inbox.submissions-page"]],
      register: AglynInboxPlugin.registerInboxNative
    ),
    NativePluginManifestEntry(
      id: "inventory-sync",
      contributes: ["screens": ["inventory-sync.order", "inventory-sync.service"]],
      register: AglynInventorySyncPlugin.registerInventorySyncNative
    ),
    NativePluginManifestEntry(
      id: "live-chat",
      contributes: ["screens": ["live-chat.settings"], "widgets": ["live-chat.settings.card"]],
      register: AglynLiveChatPlugin.registerLiveChatNative
    ),
    NativePluginManifestEntry(
      id: "logic",
      contributes: ["screens": ["logic.function", "logic.page"], "quickActions": ["logic.open"], "deepLinks": ["logic.page"]],
      register: AglynLogicPlugin.registerLogicNative
    ),
    NativePluginManifestEntry(
      id: "loyalty",
      contributes: ["screens": ["loyalty.connection", "loyalty.member", "loyalty.members", "loyalty.order", "loyalty.rewards"]],
      register: AglynLoyaltyPlugin.registerLoyaltyNative
    ),
    NativePluginManifestEntry(
      id: "marketing",
      contributes: ["screens": ["marketing.campaigns", "marketing.conversions", "marketing.experiments", "marketing.overlays", "marketing.overview"], "widgets": ["marketing.last-campaign"], "quickActions": ["marketing.open"], "deepLinks": ["marketing.campaign-page", "marketing.campaigns-page", "marketing.conversions-page", "marketing.experiments-page", "marketing.inbox-campaigns-page", "marketing.overlays-page", "marketing.overview-page", "marketing.page"]],
      register: AglynMarketingPlugin.registerMarketingNative
    ),
    NativePluginManifestEntry(
      id: "marketing-platforms",
      contributes: ["screens": ["marketing-platforms.platform", "marketing-platforms.service"], "widgets": ["marketing-platforms.service.card"]],
      register: AglynMarketingPlatformsPlugin.registerMarketingPlatformsNative
    ),
    NativePluginManifestEntry(
      id: "marketplace",
      contributes: ["screens": ["marketplace.browse", "marketplace.installed", "marketplace.licenses", "marketplace.listing", "marketplace.plugin-settings", "marketplace.publish", "marketplace.publishComponent", "marketplace.publishDatasetSchema", "marketplace.publishEmailStarter", "marketplace.publishEmailTemplate", "marketplace.publishLayout", "marketplace.publishPlugin", "marketplace.publishTemplate", "marketplace.publishTheme", "marketplace.publisherAgreement", "marketplace.sell"], "widgets": ["marketplace.artifact-publish", "marketplace.org-installs", "marketplace.plugin-installation"], "quickActions": ["marketplace.open"], "deepLinks": ["marketplace.listing-page", "marketplace.page"]],
      register: AglynMarketplacePlugin.registerMarketplaceNative
    ),
    NativePluginManifestEntry(
      id: "marketplaces",
      contributes: ["screens": ["marketplaces.marketplace", "marketplaces.order", "marketplaces.service"]],
      register: AglynMarketplacesPlugin.registerMarketplacesNative
    ),
    NativePluginManifestEntry(
      id: "outreach",
      contributes: ["screens": ["outreach.compliance", "outreach.mailboxes", "outreach.sequences"], "widgets": ["outreach.glance"], "deepLinks": ["outreach.compliance-page", "outreach.mailboxes-page", "outreach.page", "outreach.sequence-page", "outreach.sequences-page"]],
      register: AglynOutreachPlugin.registerOutreachNative
    ),
    NativePluginManifestEntry(
      id: "post-purchase",
      contributes: ["screens": ["post-purchase.order", "post-purchase.service"]],
      register: AglynPostPurchasePlugin.registerPostPurchaseNative
    ),
    NativePluginManifestEntry(
      id: "print-on-demand",
      contributes: ["screens": ["print-on-demand.catalog", "print-on-demand.connection", "print-on-demand.imported", "print-on-demand.order", "print-on-demand.orders", "print-on-demand.service"]],
      register: AglynPrintOnDemandPlugin.registerPrintOnDemandNative
    ),
    NativePluginManifestEntry(
      id: "redirects",
      contributes: ["screens": ["redirects.list"], "widgets": ["redirects.summary"], "quickActions": ["redirects.open"], "deepLinks": ["redirects.page"]],
      register: AglynRedirectsPlugin.registerRedirectsNative
    ),
    NativePluginManifestEntry(
      id: "review-platforms",
      contributes: ["screens": ["review-platforms.order", "review-platforms.service"]],
      register: AglynReviewPlatformsPlugin.registerReviewPlatformsNative
    ),
    NativePluginManifestEntry(
      id: "sales-channels",
      contributes: ["screens": ["sales-channels.channel", "sales-channels.diagnostics", "sales-channels.diagnosticsChannel", "sales-channels.service"]],
      register: AglynSalesChannelsPlugin.registerSalesChannelsNative
    ),
    NativePluginManifestEntry(
      id: "shipping",
      contributes: ["screens": ["shipping.batch", "shipping.batchReview", "shipping.billing", "shipping.boxes", "shipping.carriers", "shipping.connectCarrier", "shipping.connectOwn", "shipping.labels", "shipping.order", "shipping.own", "shipping.returnLabel", "shipping.service", "shipping.services", "shipping.shipFrom", "shipping.spend"]],
      register: AglynShippingPlugin.registerShippingNative
    ),
    NativePluginManifestEntry(
      id: "sms",
      contributes: ["screens": ["sms.texts"], "quickActions": ["sms.open"]],
      register: AglynSmsPlugin.registerSmsNative
    ),
    NativePluginManifestEntry(
      id: "tax-engines",
      contributes: ["screens": ["tax-engines.service"]],
      register: AglynTaxEnginesPlugin.registerTaxEnginesNative
    ),
    NativePluginManifestEntry(
      id: "workflows",
      contributes: ["screens": ["workflows.action", "workflows.automation", "workflows.org-automation", "workflows.runs", "workflows.webhook", "workflows.workflow"], "quickActions": ["workflows.open"], "deepLinks": ["workflows.page"]],
      register: AglynWorkflowsPlugin.registerWorkflowsNative
    ),
    NativePluginManifestEntry(
      id: "zapier",
      contributes: ["screens": ["zapier.connections"], "widgets": ["zapier.connections.card"]],
      register: AglynZapierPlugin.registerZapierNative
    ),
  ]
}
