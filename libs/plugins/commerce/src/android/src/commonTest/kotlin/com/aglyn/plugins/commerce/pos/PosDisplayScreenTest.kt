package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.PosDisplayScreen
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PosDisplayScreenTest {
  @Test
  fun aScreenOpensThePluginsPublicPageWithTheWayBack() = assertEquals(
    "/kiosk/waivers/display-sign?host=shop-1&return=%2Fkiosk%2Fcommerce%2Fpos-display",
    customerDisplayScreenHref(PosDisplayScreen(mapOf("host" to "shop-1"), "/display-sign", "waivers")),
  )

  @Test
  fun aScreenOutOfShapeOpensNothing() {
    assertNull(customerDisplayScreenHref(PosDisplayScreen(emptyMap(), "/../console", "waivers")))
    assertNull(customerDisplayScreenHref(PosDisplayScreen(emptyMap(), "/display-sign", "Waivers!")))
  }
}
