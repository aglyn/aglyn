// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.plugins.bookings.registerBookingsNative
import com.aglyn.plugins.commerce.registerCommerceNative
import com.aglyn.plugins.crm.registerCrmNative
import com.aglyn.plugins.inbox.registerInboxNative
import com.aglyn.plugins.redirects.registerRedirectsNative

object NativePluginManifest {
    val entries: List<NativePluginManifestEntry> = listOf(
        NativePluginManifestEntry(
            id = "bookings",
            contributes = mapOf("screens" to listOf("bookings.counter")),
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
            id = "inbox",
            contributes = mapOf("screens" to listOf("inbox.people", "inbox.submissions"), "widgets" to listOf("inbox.glance"), "quickActions" to listOf("inbox.open", "inbox.people"), "deepLinks" to listOf("inbox.page", "inbox.people-page", "inbox.submissions-page")),
            register = ::registerInboxNative,
        ),
        NativePluginManifestEntry(
            id = "redirects",
            contributes = mapOf("screens" to listOf("redirects.list"), "widgets" to listOf("redirects.summary"), "quickActions" to listOf("redirects.open"), "deepLinks" to listOf("redirects.page")),
            register = ::registerRedirectsNative,
        ),
    )
}
