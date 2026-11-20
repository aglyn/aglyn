// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.sitecare

import kotlin.test.Test
import kotlin.test.assertEquals

/** What Site Care draws on a site's Home, in a store build and a build that sells, with and without Site Care. */
class SiteCareControlTest {
  @Test
  fun withSiteCareRequestAChangeWorksInEveryBuild() {
    assertEquals(SiteCareControl.REQUEST, siteCareControl(siteCare = true, buying = true))
    assertEquals(SiteCareControl.REQUEST, siteCareControl(siteCare = true, buying = false))
  }

  @Test
  fun withoutSiteCareABuildThatSellsShowsTheOffButtonBesideAddSiteCare() {
    assertEquals(SiteCareControl.OFF_WITH_ADD, siteCareControl(siteCare = false, buying = true))
  }

  @Test
  fun withoutSiteCareAStoreBuildDrawsNothing() {
    assertEquals(SiteCareControl.NONE, siteCareControl(siteCare = false, buying = false))
  }

  @Test
  fun nothingUntilTheRouteAnswers() {
    assertEquals(SiteCareControl.NONE, siteCareControl(siteCare = null, buying = true))
    assertEquals(SiteCareControl.NONE, siteCareControl(siteCare = null, buying = false))
  }
}
