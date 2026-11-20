package com.aglyn.site

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class StoreBillingGateTest {
  @Test
  fun anUpgradeNoticeKeepsItsButtonOnlyWhereTheBuildMayBuy() {
    var opened = 0
    val debug = assertNotNull(planUpgradeAction(buying = true) { opened++ })
    debug()
    assertEquals(1, opened)
    assertNull(planUpgradeAction(buying = false) { opened++ })
  }
}
