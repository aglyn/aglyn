// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.plugins.bookings.registerBookingsNative
import com.aglyn.plugins.commerce.registerCommerceNative
import com.aglyn.plugins.crm.registerCrmNative
import com.aglyn.plugins.data.registerDataNative
import com.aglyn.plugins.email.registerEmailNative
import com.aglyn.plugins.eventscalendar.registerEventsCalendarNative
import com.aglyn.plugins.forms.registerFormsNative
import com.aglyn.plugins.funnels.registerFunnelsNative
import com.aglyn.plugins.inbox.registerInboxNative
import com.aglyn.plugins.logic.registerLogicNative
import com.aglyn.plugins.marketing.registerMarketingNative
import com.aglyn.plugins.marketplace.registerMarketplaceNative
import com.aglyn.plugins.outreach.registerOutreachNative
import com.aglyn.plugins.redirects.registerRedirectsNative
import com.aglyn.plugins.workflows.registerWorkflowsNative

object NativePluginManifest {
    val entries: List<NativePluginManifestEntry> = listOf(
        NativePluginManifestEntry(
            id = "bookings",
            contributes = mapOf("screens" to listOf("bookings.booking", "bookings.calendar", "bookings.counter", "bookings.services"), "widgets" to listOf("bookings.today"), "quickActions" to listOf("bookings.open"), "deepLinks" to listOf("bookings.page")),
            register = ::registerBookingsNative,
        ),
        NativePluginManifestEntry(
            id = "commerce",
            contributes = mapOf("screens" to listOf("commerce.card-readers", "commerce.order", "commerce.orders", "commerce.product", "commerce.products", "commerce.register", "commerce.sales", "commerce.scan"), "tabs" to listOf("commerce.orders-tab", "commerce.products-tab"), "widgets" to listOf("commerce.sales-trend", "commerce.to-ship", "commerce.today"), "quickActions" to listOf("commerce.new-product", "commerce.orders-to-ship", "commerce.scan"), "deepLinks" to listOf("commerce.orders-page", "commerce.products-page")),
            register = ::registerCommerceNative,
        ),
        NativePluginManifestEntry(
            id = "crm",
            contributes = mapOf("screens" to listOf("crm.companies", "crm.company", "crm.contact", "crm.contacts", "crm.deal", "crm.deals", "crm.fields", "crm.lead", "crm.leads", "crm.reports", "crm.settings", "crm.tasks"), "widgets" to listOf("crm.glance", "crm.tasks-due"), "quickActions" to listOf("crm.deals-action", "crm.open", "crm.tasks-action"), "deepLinks" to listOf("crm.companies-page", "crm.company-page", "crm.contact-page", "crm.contacts-page", "crm.deal-page", "crm.deals-page", "crm.fields-page", "crm.lead-page", "crm.leads-page", "crm.legacy-contacts", "crm.page", "crm.reports-page", "crm.settings-page", "crm.tasks-page")),
            register = ::registerCrmNative,
        ),
        NativePluginManifestEntry(
            id = "data",
            contributes = mapOf("screens" to listOf("data.datasets", "data.records", "data.schema"), "quickActions" to listOf("data.open"), "deepLinks" to listOf("data.page")),
            register = ::registerDataNative,
        ),
        NativePluginManifestEntry(
            id = "email",
            contributes = mapOf("screens" to listOf("email.audiences", "email.messages", "email.sending", "email.suppressions", "email.templates", "email.topics"), "quickActions" to listOf("email.open"), "deepLinks" to listOf("email.audiences-page", "email.list-page", "email.message-page", "email.messages-page", "email.page", "email.sending-page", "email.suppressions-page", "email.templates-page", "email.topics-page")),
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
            id = "funnels",
            contributes = mapOf("screens" to listOf("funnels.list"), "quickActions" to listOf("funnels.open"), "deepLinks" to listOf("funnels.page")),
            register = ::registerFunnelsNative,
        ),
        NativePluginManifestEntry(
            id = "inbox",
            contributes = mapOf("screens" to listOf("inbox.people", "inbox.submission", "inbox.submissions"), "widgets" to listOf("inbox.glance"), "quickActions" to listOf("inbox.open", "inbox.people"), "deepLinks" to listOf("inbox.page", "inbox.people-page", "inbox.submissions-page")),
            register = ::registerInboxNative,
        ),
        NativePluginManifestEntry(
            id = "logic",
            contributes = mapOf("screens" to listOf("logic.function", "logic.page"), "quickActions" to listOf("logic.open"), "deepLinks" to listOf("logic.page")),
            register = ::registerLogicNative,
        ),
        NativePluginManifestEntry(
            id = "marketing",
            contributes = mapOf("screens" to listOf("marketing.campaigns", "marketing.conversions", "marketing.experiments", "marketing.overlays", "marketing.overview"), "quickActions" to listOf("marketing.open"), "deepLinks" to listOf("marketing.campaign-page", "marketing.campaigns-page", "marketing.conversions-page", "marketing.experiments-page", "marketing.inbox-campaigns-page", "marketing.overlays-page", "marketing.overview-page", "marketing.page")),
            register = ::registerMarketingNative,
        ),
        NativePluginManifestEntry(
            id = "marketplace",
            contributes = mapOf("screens" to listOf("marketplace.browse", "marketplace.installed", "marketplace.licenses", "marketplace.listing"), "quickActions" to listOf("marketplace.open"), "deepLinks" to listOf("marketplace.listing-page", "marketplace.page")),
            register = ::registerMarketplaceNative,
        ),
        NativePluginManifestEntry(
            id = "outreach",
            contributes = mapOf("screens" to listOf("outreach.compliance", "outreach.mailboxes", "outreach.sequences"), "widgets" to listOf("outreach.glance"), "deepLinks" to listOf("outreach.compliance-page", "outreach.mailboxes-page", "outreach.page", "outreach.sequence-page", "outreach.sequences-page")),
            register = ::registerOutreachNative,
        ),
        NativePluginManifestEntry(
            id = "redirects",
            contributes = mapOf("screens" to listOf("redirects.list"), "widgets" to listOf("redirects.summary"), "quickActions" to listOf("redirects.open"), "deepLinks" to listOf("redirects.page")),
            register = ::registerRedirectsNative,
        ),
        NativePluginManifestEntry(
            id = "workflows",
            contributes = mapOf("screens" to listOf("workflows.action", "workflows.automation", "workflows.org-automation", "workflows.runs", "workflows.webhook", "workflows.workflow"), "quickActions" to listOf("workflows.open"), "deepLinks" to listOf("workflows.page")),
            register = ::registerWorkflowsNative,
        ),
    )
}
