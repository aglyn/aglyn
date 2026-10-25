// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.plugins.accounting.registerAccountingNative
import com.aglyn.plugins.adconversions.registerAdConversionsNative
import com.aglyn.plugins.ai.registerAINative
import com.aglyn.plugins.bookings.registerBookingsNative
import com.aglyn.plugins.commerce.registerCommerceNative
import com.aglyn.plugins.couriers.registerCouriersNative
import com.aglyn.plugins.crm.registerCrmNative
import com.aglyn.plugins.data.registerDataNative
import com.aglyn.plugins.deliveryapps.registerDeliveryAppsNative
import com.aglyn.plugins.email.registerEmailNative
import com.aglyn.plugins.eventscalendar.registerEventsCalendarNative
import com.aglyn.plugins.forms.registerFormsNative
import com.aglyn.plugins.fulfillmentnetworks.registerFulfillmentNetworksNative
import com.aglyn.plugins.funnels.registerFunnelsNative
import com.aglyn.plugins.inbox.registerInboxNative
import com.aglyn.plugins.inventorysync.registerInventorySyncNative
import com.aglyn.plugins.livechat.registerLiveChatNative
import com.aglyn.plugins.logic.registerLogicNative
import com.aglyn.plugins.loyalty.registerLoyaltyNative
import com.aglyn.plugins.marketing.registerMarketingNative
import com.aglyn.plugins.marketingplatforms.registerMarketingPlatformsNative
import com.aglyn.plugins.marketplace.registerMarketplaceNative
import com.aglyn.plugins.marketplaces.registerMarketplacesNative
import com.aglyn.plugins.outreach.registerOutreachNative
import com.aglyn.plugins.postpurchase.registerPostPurchaseNative
import com.aglyn.plugins.printondemand.registerPrintOnDemandNative
import com.aglyn.plugins.redirects.registerRedirectsNative
import com.aglyn.plugins.reviewplatforms.registerReviewPlatformsNative
import com.aglyn.plugins.saleschannels.registerSalesChannelsNative
import com.aglyn.plugins.shipping.registerShippingNative
import com.aglyn.plugins.sms.registerSmsNative
import com.aglyn.plugins.taxengines.registerTaxEnginesNative
import com.aglyn.plugins.workflows.registerWorkflowsNative
import com.aglyn.plugins.zapier.registerZapierNative

object NativePluginManifest {
    val entries: List<NativePluginManifestEntry> = listOf(
        NativePluginManifestEntry(
            id = "accounting",
            contributes = mapOf("screens" to listOf("accounting.activity", "accounting.attention", "accounting.books"), "deepLinks" to listOf("accounting.books.link", "accounting.books.link2")),
            register = ::registerAccountingNative,
        ),
        NativePluginManifestEntry(
            id = "ad-conversions",
            contributes = mapOf("screens" to listOf("ad-conversions.provider", "ad-conversions.service"), "widgets" to listOf("ad-conversions.service.card")),
            register = ::registerAdConversionsNative,
        ),
        NativePluginManifestEntry(
            id = "ai",
            contributes = mapOf("screens" to listOf("ai.allotment", "ai.create", "ai.credits", "ai.hostMember", "ai.import.productCopy", "ai.job", "ai.jobs", "ai.member", "ai.orgsSpendColumn", "ai.request", "ai.requests", "ai.signals", "ai.staffOrg", "ai.staffRequests", "ai.staffUser"), "widgets" to listOf("ai.assist-panel", "ai.create-component", "ai.create-form", "ai.create-layout", "ai.create-page", "ai.create-template", "ai.insight-ask", "ai.needs-you", "ai.org-insight-ask", "ai.seo-audit", "ai.seo-start", "ai.site-memory"), "quickActions" to listOf("ai.open"), "deepLinks" to listOf("ai.job.link", "ai.jobs.link", "ai.signals.link")),
            register = ::registerAINative,
        ),
        NativePluginManifestEntry(
            id = "bookings",
            contributes = mapOf("screens" to listOf("bookings.booking", "bookings.calendar", "bookings.counter", "bookings.services"), "widgets" to listOf("bookings.needs-you", "bookings.today"), "quickActions" to listOf("bookings.open"), "deepLinks" to listOf("bookings.page")),
            register = ::registerBookingsNative,
        ),
        NativePluginManifestEntry(
            id = "commerce",
            contributes = mapOf("screens" to listOf("commerce.card-readers", "commerce.categories", "commerce.collection", "commerce.collectionProducts", "commerce.collectionRules", "commerce.collections", "commerce.coupons", "commerce.discounts", "commerce.display", "commerce.fulfillmentDelivery", "commerce.fulfillmentPickup", "commerce.fulfillmentQueue", "commerce.giftCards", "commerce.giftCardsSearch", "commerce.import.giftCards", "commerce.kiosk", "commerce.localDelivery", "commerce.locations", "commerce.manage", "commerce.memberPosts", "commerce.notifications", "commerce.order", "commerce.orderServices", "commerce.orderWebhookDeliveries", "commerce.orderWebhooks", "commerce.orders", "commerce.ordersBulk", "commerce.paymentMethods", "commerce.payments", "commerce.product", "commerce.productDetails", "commerce.productMedia", "commerce.productRelated", "commerce.products", "commerce.promotions", "commerce.recovery", "commerce.register", "commerce.reservations", "commerce.return", "commerce.returnSettings", "commerce.returns", "commerce.returnsByStatus", "commerce.reviewSettings", "commerce.reviews", "commerce.sales", "commerce.scan", "commerce.settings", "commerce.shipping", "commerce.shippingTiers", "commerce.shippingeasy", "commerce.shipstation", "commerce.startReturn", "commerce.stockMovements", "commerce.stockMovementsLocation", "commerce.stockMovementsLocations", "commerce.stockMovementsOrder", "commerce.stockMovementsProduct", "commerce.stockMovementsProducts", "commerce.stockMovementsReason", "commerce.storeSettings", "commerce.suppliers", "commerce.tax", "commerce.taxSummary", "commerce.transfer"), "tabs" to listOf("commerce.orders-tab", "commerce.products-tab"), "widgets" to listOf("commerce.glance", "commerce.needs-you", "commerce.newest-site-users", "commerce.sales-trend", "commerce.to-ship", "commerce.today"), "quickActions" to listOf("commerce.new-product", "commerce.orders-to-ship", "commerce.scan"), "deepLinks" to listOf("commerce.orders-page", "commerce.products-page")),
            register = ::registerCommerceNative,
        ),
        NativePluginManifestEntry(
            id = "couriers",
            contributes = mapOf("screens" to listOf("couriers.order", "couriers.service")),
            register = ::registerCouriersNative,
        ),
        NativePluginManifestEntry(
            id = "crm",
            contributes = mapOf("screens" to listOf("crm.companies", "crm.company", "crm.contact", "crm.contacts", "crm.deal", "crm.deals", "crm.fields", "crm.lead", "crm.leads", "crm.reports", "crm.settings", "crm.tasks"), "widgets" to listOf("crm.glance", "crm.org-glance", "crm.org-tasks-due", "crm.tasks-due"), "quickActions" to listOf("crm.deals-action", "crm.open", "crm.tasks-action"), "deepLinks" to listOf("crm.companies-page", "crm.company-page", "crm.contact-page", "crm.contacts-page", "crm.deal-page", "crm.deals-page", "crm.fields-page", "crm.lead-page", "crm.leads-page", "crm.legacy-contacts", "crm.page", "crm.reports-page", "crm.settings-page", "crm.tasks-page")),
            register = ::registerCrmNative,
        ),
        NativePluginManifestEntry(
            id = "data",
            contributes = mapOf("screens" to listOf("data.datasets", "data.records", "data.schema"), "quickActions" to listOf("data.open"), "deepLinks" to listOf("data.page")),
            register = ::registerDataNative,
        ),
        NativePluginManifestEntry(
            id = "delivery-apps",
            contributes = mapOf("screens" to listOf("delivery-apps.match", "delivery-apps.service", "delivery-apps.store"), "widgets" to listOf("delivery-apps.pos-orders")),
            register = ::registerDeliveryAppsNative,
        ),
        NativePluginManifestEntry(
            id = "email",
            contributes = mapOf("screens" to listOf("email.audiences", "email.import.consent", "email.import.existing", "email.list.transfer", "email.messages", "email.sending", "email.suppressions", "email.templates", "email.topics"), "quickActions" to listOf("email.open"), "deepLinks" to listOf("email.audiences-page", "email.list-page", "email.message-page", "email.messages-page", "email.page", "email.sending-page", "email.suppressions-page", "email.templates-page", "email.topics-page")),
            register = ::registerEmailNative,
        ),
        NativePluginManifestEntry(
            id = "events-calendar",
            contributes = mapOf("screens" to listOf("events-calendar.events"), "quickActions" to listOf("events-calendar.open"), "deepLinks" to listOf("events-calendar.page")),
            register = ::registerEventsCalendarNative,
        ),
        NativePluginManifestEntry(
            id = "forms",
            contributes = mapOf("screens" to listOf("forms.form", "forms.list"), "quickActions" to listOf("forms.open"), "deepLinks" to listOf("forms.page", "forms.record")),
            register = ::registerFormsNative,
        ),
        NativePluginManifestEntry(
            id = "fulfillment-networks",
            contributes = mapOf("screens" to listOf("fulfillment-networks.network", "fulfillment-networks.order", "fulfillment-networks.service")),
            register = ::registerFulfillmentNetworksNative,
        ),
        NativePluginManifestEntry(
            id = "funnels",
            contributes = mapOf("screens" to listOf("funnels.list"), "quickActions" to listOf("funnels.open"), "deepLinks" to listOf("funnels.page")),
            register = ::registerFunnelsNative,
        ),
        NativePluginManifestEntry(
            id = "inbox",
            contributes = mapOf("screens" to listOf("inbox.people", "inbox.submission", "inbox.submissions"), "widgets" to listOf("inbox.glance", "inbox.needs-you", "inbox.sidebar-count"), "quickActions" to listOf("inbox.open", "inbox.people"), "deepLinks" to listOf("inbox.page", "inbox.people-page", "inbox.submissions-page")),
            register = ::registerInboxNative,
        ),
        NativePluginManifestEntry(
            id = "inventory-sync",
            contributes = mapOf("screens" to listOf("inventory-sync.order", "inventory-sync.service")),
            register = ::registerInventorySyncNative,
        ),
        NativePluginManifestEntry(
            id = "live-chat",
            contributes = mapOf("screens" to listOf("live-chat.settings"), "widgets" to listOf("live-chat.settings.card")),
            register = ::registerLiveChatNative,
        ),
        NativePluginManifestEntry(
            id = "logic",
            contributes = mapOf("screens" to listOf("logic.function", "logic.page"), "quickActions" to listOf("logic.open"), "deepLinks" to listOf("logic.page")),
            register = ::registerLogicNative,
        ),
        NativePluginManifestEntry(
            id = "loyalty",
            contributes = mapOf("screens" to listOf("loyalty.connection", "loyalty.member", "loyalty.members", "loyalty.order", "loyalty.rewards")),
            register = ::registerLoyaltyNative,
        ),
        NativePluginManifestEntry(
            id = "marketing",
            contributes = mapOf("screens" to listOf("marketing.campaigns", "marketing.conversions", "marketing.experiments", "marketing.overlays", "marketing.overview"), "widgets" to listOf("marketing.last-campaign"), "quickActions" to listOf("marketing.open"), "deepLinks" to listOf("marketing.campaign-page", "marketing.campaigns-page", "marketing.conversions-page", "marketing.experiments-page", "marketing.inbox-campaigns-page", "marketing.overlays-page", "marketing.overview-page", "marketing.page")),
            register = ::registerMarketingNative,
        ),
        NativePluginManifestEntry(
            id = "marketing-platforms",
            contributes = mapOf("screens" to listOf("marketing-platforms.platform", "marketing-platforms.service"), "widgets" to listOf("marketing-platforms.service.card")),
            register = ::registerMarketingPlatformsNative,
        ),
        NativePluginManifestEntry(
            id = "marketplace",
            contributes = mapOf("screens" to listOf("marketplace.browse", "marketplace.installed", "marketplace.licenses", "marketplace.listing", "marketplace.plugin-settings", "marketplace.publish", "marketplace.publishComponent", "marketplace.publishDatasetSchema", "marketplace.publishEmailStarter", "marketplace.publishEmailTemplate", "marketplace.publishLayout", "marketplace.publishPlugin", "marketplace.publishTemplate", "marketplace.publishTheme", "marketplace.publisherAgreement", "marketplace.sell"), "widgets" to listOf("marketplace.artifact-publish", "marketplace.org-installs", "marketplace.plugin-installation"), "quickActions" to listOf("marketplace.open"), "deepLinks" to listOf("marketplace.listing-page", "marketplace.page")),
            register = ::registerMarketplaceNative,
        ),
        NativePluginManifestEntry(
            id = "marketplaces",
            contributes = mapOf("screens" to listOf("marketplaces.marketplace", "marketplaces.order", "marketplaces.service")),
            register = ::registerMarketplacesNative,
        ),
        NativePluginManifestEntry(
            id = "outreach",
            contributes = mapOf("screens" to listOf("outreach.compliance", "outreach.mailboxes", "outreach.sequences"), "widgets" to listOf("outreach.glance"), "deepLinks" to listOf("outreach.compliance-page", "outreach.mailboxes-page", "outreach.page", "outreach.sequence-page", "outreach.sequences-page")),
            register = ::registerOutreachNative,
        ),
        NativePluginManifestEntry(
            id = "post-purchase",
            contributes = mapOf("screens" to listOf("post-purchase.order", "post-purchase.service")),
            register = ::registerPostPurchaseNative,
        ),
        NativePluginManifestEntry(
            id = "print-on-demand",
            contributes = mapOf("screens" to listOf("print-on-demand.catalog", "print-on-demand.connection", "print-on-demand.imported", "print-on-demand.order", "print-on-demand.orders", "print-on-demand.service")),
            register = ::registerPrintOnDemandNative,
        ),
        NativePluginManifestEntry(
            id = "redirects",
            contributes = mapOf("screens" to listOf("redirects.list"), "widgets" to listOf("redirects.summary"), "quickActions" to listOf("redirects.open"), "deepLinks" to listOf("redirects.page")),
            register = ::registerRedirectsNative,
        ),
        NativePluginManifestEntry(
            id = "review-platforms",
            contributes = mapOf("screens" to listOf("review-platforms.order", "review-platforms.service")),
            register = ::registerReviewPlatformsNative,
        ),
        NativePluginManifestEntry(
            id = "sales-channels",
            contributes = mapOf("screens" to listOf("sales-channels.channel", "sales-channels.diagnostics", "sales-channels.diagnosticsChannel", "sales-channels.service")),
            register = ::registerSalesChannelsNative,
        ),
        NativePluginManifestEntry(
            id = "shipping",
            contributes = mapOf("screens" to listOf("shipping.batch", "shipping.batchReview", "shipping.billing", "shipping.boxes", "shipping.carriers", "shipping.connectCarrier", "shipping.connectOwn", "shipping.labels", "shipping.order", "shipping.own", "shipping.returnLabel", "shipping.service", "shipping.services", "shipping.shipFrom", "shipping.spend")),
            register = ::registerShippingNative,
        ),
        NativePluginManifestEntry(
            id = "sms",
            contributes = mapOf("screens" to listOf("sms.texts"), "quickActions" to listOf("sms.open")),
            register = ::registerSmsNative,
        ),
        NativePluginManifestEntry(
            id = "tax-engines",
            contributes = mapOf("screens" to listOf("tax-engines.service")),
            register = ::registerTaxEnginesNative,
        ),
        NativePluginManifestEntry(
            id = "workflows",
            contributes = mapOf("screens" to listOf("workflows.action", "workflows.automation", "workflows.org-automation", "workflows.runs", "workflows.webhook", "workflows.workflow"), "quickActions" to listOf("workflows.open"), "deepLinks" to listOf("workflows.page")),
            register = ::registerWorkflowsNative,
        ),
        NativePluginManifestEntry(
            id = "zapier",
            contributes = mapOf("screens" to listOf("zapier.connections"), "widgets" to listOf("zapier.connections.card")),
            register = ::registerZapierNative,
        ),
    )
}
