package com.aglyn.pluginhost

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Which console links the apps open, as the console's app-link documents claim them (AGL-4059). */
class ConsoleAppLinksTest {
  @Test
  fun everyWorkspaceSiteAndAccountPageOpensTheApp() {
    // The link the owner clicked on the Mac, and its parents.
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/elevated-concepts/hosts/elevated-concepts/admin/plugins/pIbeqgnNLn"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/acme/hosts/shop/admin/plugins"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/acme/hosts/shop/products/orders?order=o1#items"))
    assertTrue(DeepLinks.opensInApp("aglyn://acme/crm/leads/l1"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/admin/orgs/o1"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/billing/plans"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/manage/notifications"))
    // The console's home (an invitation's link) and the auth pages the app finishes itself.
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/signup?plan=pro"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/verify-email?oobCode=x"))
    // A workspace whose slug only starts like a web-only section is still a workspace.
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/apiary/hosts/hive/media"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/press/crm"))
    assertTrue(DeepLinks.opensInApp("https://app.aglyn.com/authors-guild"))
  }

  @Test
  fun webOnlyPagesStayInTheBrowser() {
    for (path in listOf(
      "/_next/static/x.js", "/api", "/api/health/console", "/.well-known/assetlinks.json",
      "/auth", "/auth/native", "/edit-access", "/edit-access/x", "/kiosk", "/kiosk/d1", "/oauth/authorize?client_id=c",
      "/p", "/p/link1", "/signin", "/signin/sso", "/signout", "/sso", "/sso/acme",
      "/signup/finish", "/verify-email/x", "/reset-password/x", "/account-recovery/x",
    )) {
      assertFalse(DeepLinks.opensInApp("https://app.aglyn.com$path"), path)
    }
    assertFalse(DeepLinks.opensInApp("mailto:someone@example.test"))
    assertFalse(DeepLinks.opensInApp(null))
  }
}
