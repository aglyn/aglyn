// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// Each native plugin's declared contributions and registrar, from its mobile
// block in plugins.config.json.

import AglynPluginHost
import AglynCommercePlugin
import AglynRedirectsPlugin

public enum NativePluginManifest {
  public static let entries: [NativePluginManifestEntry] = [
    NativePluginManifestEntry(
      id: "commerce",
      contributes: ["screens": ["commerce.card-readers", "commerce.order", "commerce.orders", "commerce.product", "commerce.products", "commerce.register", "commerce.sales", "commerce.scan"], "tabs": ["commerce.orders-tab", "commerce.products-tab"], "widgets": ["commerce.sales-trend", "commerce.today"], "quickActions": ["commerce.new-product", "commerce.orders-to-ship", "commerce.scan"], "deepLinks": ["commerce.orders-page", "commerce.products-page"]],
      register: AglynCommercePlugin.registerCommerceNative
    ),
    NativePluginManifestEntry(
      id: "redirects",
      contributes: ["screens": ["redirects.list"], "widgets": ["redirects.summary"], "quickActions": ["redirects.open"], "deepLinks": ["redirects.page"]],
      register: AglynRedirectsPlugin.registerRedirectsNative
    ),
  ]
}
