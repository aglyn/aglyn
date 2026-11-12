package com.aglyn.shell

import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeDeepLink
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginRegistry
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Every link shape the server stores, run through the resolver against the platform's real routes (Sites, Pages, the
 * core spec screens) and the plugins' routes as their registrations name them (AGL-4215). The plugin manifest's own test
 * runs the plugin links through the real plugin registrations.
 */
class DeepLinkShapesTest {
  private val pluginRoutes = listOf(
    NativeDeepLink("commerce", "commerce.orders-page", "/products/orders", "commerce.orders"),
    NativeDeepLink("commerce", "commerce.products-page", "/products", "commerce.products"),
    NativeDeepLink("commerce", "commerce.order-link", "/products/orders?order=:orderId", "commerce.order"),
    NativeDeepLink("commerce", "commerce.quote-link", "/products/orders?quote=:quote", "commerce.quote"),
    NativeDeepLink("commerce", "commerce.returns-page", "/products/returns", "commerce.returns"),
    NativeDeepLink("commerce", "commerce.return-link", "/products/returns?return=:returnId", "commerce.return"),
    NativeDeepLink("commerce", "commerce.shipping-page", "/products/shipping", "commerce.shipping"),
    NativeDeepLink("commerce", "commerce.notifications-page", "/products/notifications", "commerce.notifications"),
    NativeDeepLink("marketplace", "marketplace.page", "/marketplace", "marketplace.browse"),
    NativeDeepLink("marketplace", "marketplace.browse-page", "/marketplace/browse", "marketplace.browse"),
    NativeDeepLink("marketplace", "marketplace.licences-page", "/marketplace/licences", "marketplace.licenses"),
    NativeDeepLink("marketplace", "marketplace.sell-page", "/marketplace/:section(profile|listings|payouts|sales)", "marketplace.sell"),
    NativeDeepLink("marketplace", "marketplace.listing-page", "/marketplace/:listingId(!upload)", "marketplace.listing"),
    NativeDeepLink("crm", "crm.leads-page", "/crm/leads", "crm.leads"),
    NativeDeepLink("crm", "crm.lead-page", "/crm/leads/:lead", "crm.lead"),
    NativeDeepLink("ai", "ai.jobs.link", "/ai-jobs", "ai.jobs"),
    NativeDeepLink("ai", "ai.job.link", "/ai-jobs/:jobId", "ai.job"),
  )

  private val routes = NativePluginRegistry().also { it.load(PLATFORM_ENTRIES) }.deepLinks() + pluginRoutes

  private fun screen(id: String, vararg params: Pair<String, String>) = NativeLinkTarget.Screen(id, mapOf(*params))

  private val site = arrayOf("orgSlug" to "acme", "hostSlug" to "shop")

  @Test
  fun everyStoredLinkShapeOpensThePageItNames() {
    val cases = listOf(
      // The console's own order address (the Orders card, order notices) opens that order, not the list.
      "/acme/hosts/shop/products/orders?order=o1" to screen("commerce.order", *site, "order" to "o1", "orderId" to "o1"),
      "/acme/hosts/shop/products/orders?quote=q1" to screen("commerce.quote", *site, "quote" to "q1"),
      "/acme/hosts/shop/products/orders?order=" to screen("commerce.orders", *site, "order" to ""),
      "/acme/hosts/shop/products/returns?return=r%201" to screen("commerce.return", *site, "return" to "r 1", "returnId" to "r 1"),
      "/acme/hosts/shop/products/returns" to screen("commerce.returns", *site),
      "/acme/hosts/shop/products/shipping" to screen("commerce.shipping", *site),
      "/acme/hosts/shop/products/notifications" to screen("commerce.notifications", *site),
      // No native screen: the shell's nearest answer, never a listing or an order.
      "/acme/hosts/shop/products/subscriptions?subscription=s1" to NativeLinkTarget.Unmatched("/acme/hosts/shop/products/subscriptions?subscription=s1"),
      "/acme/hosts/shop/products/pos" to NativeLinkTarget.Unmatched("/acme/hosts/shop/products/pos"),
      // The marketplace hub's sections win over a listing's `/marketplace/{id}`.
      "/acme/marketplace/payouts" to screen("marketplace.sell", "orgSlug" to "acme", "section" to "payouts"),
      "/acme/marketplace/listings" to screen("marketplace.sell", "orgSlug" to "acme", "section" to "listings"),
      "/acme/marketplace/licences" to screen("marketplace.licenses", "orgSlug" to "acme"),
      "/acme/marketplace/upload" to NativeLinkTarget.Unmatched("/acme/marketplace/upload"),
      "/acme/marketplace/l1" to screen("marketplace.listing", "orgSlug" to "acme", "listingId" to "l1"),
      // A workspace's own address (Home), its Sites, and a workspace setting.
      "/acme" to NativeLinkTarget.Unmatched("/acme"),
      "/acme/hosts" to screen("site.sites", "orgSlug" to "acme"),
      "/acme/settings/sso" to screen("core.settings.sso", "orgSlug" to "acme"),
      // A staff link's `#fragment` names a spot on the page, never part of its id.
      "/admin/orgs/org-1#site-care" to screen("core.staff.org", "orgId" to "org-1"),
      "/admin/hardware-orders" to NativeLinkTarget.Unmatched("/admin/hardware-orders"),
      "/acme/hosts/shop/analytics" to NativeLinkTarget.Unmatched("/acme/hosts/shop/analytics"),
      "/acme/crm/leads/l1" to screen("crm.lead", "orgSlug" to "acme", "lead" to "l1"),
      "/acme/hosts/shop/ai-jobs/j1" to screen("ai.job", *site, "jobId" to "j1"),
      withAiJobPath("/acme/hosts/shop?aiJob=j1") to screen("ai.job", *site, "jobId" to "j1"),
      "/acme/hosts/shop/screens/s1" to screen("site.pages", *site, "screenId" to "s1"),
      "/acme/hosts/shop/screens/list" to screen("site.pages", *site),
    )
    for ((link, expected) in cases) assertEquals(expected, DeepLinks.resolve(link, routes), link)
  }

  @Test
  fun aNotificationLinkOpensWhereTheConsoleOpensIt() {
    val follow = { link: String? -> DeepLinks.notificationLink(link, "acme", "h1", "shop") }
    assertEquals("/acme/hosts/shop/products/orders?order=o1", follow("/h1/products/orders?order=o1"))
    assertEquals("/acme/hosts/shop?aiJob=j1", follow("/h1?aiJob=j1"))
    assertEquals("/h10/bookings", follow("/h10/bookings"))
    assertEquals("/acme/settings/sso", follow("/org/settings/sso"))
    // A stored `/hosts` is the workspace's Sites, as on the Mac and iPhone, not a workspace called "hosts".
    assertEquals("/acme/hosts", follow("/hosts"))
    assertEquals(screen("site.sites", "orgSlug" to "acme"), DeepLinks.resolve(follow("/hosts"), routes))
    assertEquals(screen("marketplace.sell", "orgSlug" to "acme", "section" to "payouts"), DeepLinks.resolve(follow("/org/marketplace/payouts"), routes))
    assertEquals("https://example.com/x", follow("https://example.com/x"))
    assertEquals(null, follow(null))
    assertEquals("/h1/bookings", DeepLinks.notificationLink("/h1/bookings", "acme", "h1", null))
  }

  @Test
  fun aLinkWithAFragmentStillNamesItsWorkspace() {
    val workspace = com.aglyn.core.WorkspaceState(
      orgs = listOf(com.aglyn.core.WorkspaceOrg("org-acme", "Acme", "acme", "owner")), sites = emptyList(), ready = true,
    )
    assertEquals(LinkScope("org-acme", whole = true), linkScopeOf("/acme#top", workspace))
  }
}
