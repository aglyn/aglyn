package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals

class UpgradeNoticeTest {
  /** The console's `blockedExtensionNotice` sentences (apps/console/utils/extension-entitlement.ts). */
  @Test
  fun namesThePlanThatIncludesTheFeatureOrSaysNoneDoes() {
    assertEquals(
      "CRM is not included in your current plan. Manage your plan and add-ons from Billing. Included from Starter.",
      upgradeNoticeMessage("CRM", "crm"),
    )
    assertEquals(
      "Nothing isn't included in any plan — it's a paid add-on. Manage your plan and add-ons from Billing.",
      upgradeNoticeMessage("Nothing", "notAFeature"),
    )
  }

  @Test
  fun readsTheEntitlementsRoute() {
    val body = kotlinx.serialization.json.Json.parseToJsonElement("""{"orgId":"o1","plan":"pro","features":{"crm":true,"whiteLabel":false},"quotas":{"sites":3,"pages":null}}""")
    val read = OrgEntitlements.of(body)!!
    assertEquals("pro", read.plan)
    assertEquals(true, read.has("crm"))
    assertEquals(false, read.has("whiteLabel"))
    assertEquals(3L, read.limit("sites"))
    assertEquals(null, read.limit("pages"))
  }
}
