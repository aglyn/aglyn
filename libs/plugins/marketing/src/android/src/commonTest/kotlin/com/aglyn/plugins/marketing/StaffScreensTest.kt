package com.aglyn.plugins.marketing

import com.aglyn.screens.ScreenSpec
import kotlin.test.Test
import kotlin.test.assertEquals

class StaffScreensTest {
  /** The staff organization page's read-only Email campaigns card (AGL-3380), in the staff organization's zone. */
  @Test
  fun theStaffEmailScreenSitsInTheStaffOrganizationZone() {
    val specs = MarketingScreenJson.files.flatMap { ScreenSpec.parseFile(it) }.associateBy { it.id }
    assertEquals(listOf("staffOrg"), specs.getValue("marketing.staffOrgEmail").zones)
    assertEquals(emptyList(), specs.getValue("marketing.staffOrgEmailSend").zones)
  }
}
