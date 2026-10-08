// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

package com.aglyn.plugins.manifest

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.plugins.ai.registerAINative
import com.aglyn.plugins.bookings.registerBookingsNative
import com.aglyn.plugins.commerce.registerCommerceNative
import com.aglyn.plugins.forms.registerFormsNative
import com.aglyn.plugins.inbox.registerInboxNative
import com.aglyn.plugins.redirects.registerRedirectsNative

object NativePluginManifest {
    val entries: List<NativePluginManifestEntry> = listOf(
        NativePluginManifestEntry(
            id = "ai",
            contributes = mapOf("screens" to listOf("ai.credits", "ai.job", "ai.jobs", "ai.member", "ai.signals", "ai.staffOrg", "ai.staffUser"), "quickActions" to listOf("ai.open"), "deepLinks" to listOf("ai.job.link", "ai.jobs.link", "ai.signals.link")),
            register = ::registerAINative,
        ),
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
            id = "forms",
            contributes = mapOf("screens" to listOf("forms.form", "forms.list"), "quickActions" to listOf("forms.open"), "deepLinks" to listOf("forms.page", "forms.record")),
            register = ::registerFormsNative,
        ),
        NativePluginManifestEntry(
            id = "inbox",
            contributes = mapOf("screens" to listOf("inbox.submission", "inbox.submissions"), "deepLinks" to listOf("inbox.submissions-page")),
            register = ::registerInboxNative,
        ),
        NativePluginManifestEntry(
            id = "redirects",
            contributes = mapOf("screens" to listOf("redirects.list"), "widgets" to listOf("redirects.summary"), "quickActions" to listOf("redirects.open"), "deepLinks" to listOf("redirects.page")),
            register = ::registerRedirectsNative,
        ),
    )
}
