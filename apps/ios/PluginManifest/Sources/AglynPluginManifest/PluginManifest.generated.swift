// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

import AglynPluginHost
import AglynBookingsPlugin
import AglynCommercePlugin
import AglynEventsCalendarPlugin
import AglynFormsPlugin
import AglynInboxPlugin
import AglynRedirectsPlugin
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
      id: "inbox",
      contributes: ["screens": ["inbox.submission", "inbox.submissions"], "deepLinks": ["inbox.submissions-page"]],
      register: AglynInboxPlugin.registerInboxNative
    ),
    NativePluginManifestEntry(
      id: "redirects",
      contributes: ["screens": ["redirects.list"], "widgets": ["redirects.summary"], "quickActions": ["redirects.open"], "deepLinks": ["redirects.page"]],
      register: AglynRedirectsPlugin.registerRedirectsNative
    ),
    NativePluginManifestEntry(
      id: "workflows",
      contributes: ["screens": ["workflows.action", "workflows.automation", "workflows.org-automation", "workflows.runs", "workflows.webhook", "workflows.workflow"], "quickActions": ["workflows.open"], "deepLinks": ["workflows.page"]],
      register: AglynWorkflowsPlugin.registerWorkflowsNative
    ),
  ]
}
