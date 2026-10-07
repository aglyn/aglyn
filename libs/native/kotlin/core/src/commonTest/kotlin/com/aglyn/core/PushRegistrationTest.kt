package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PushRegistrationTest {
  private val token = "fGx1:" + "A".repeat(150) + "_-"

  @Test
  fun aFirstWriteCarriesExactlyTheKeysTheRulesAccept() {
    val row = fcmDeviceRow(token, AglynAppId.AGLYN, "0.1.0", firstWrite = true)!!
    assertEquals(setOf("token", "transport", "platform", "app", "appVersion", "lastSeen", "createdAt"), row.keys)
    assertEquals("fcm", row["transport"])
    assertEquals("android", row["platform"])
    assertEquals("aglyn", row["app"])
    assertEquals(ServerTimestamp, row["lastSeen"])
    assertEquals(ServerTimestamp, row["createdAt"])
  }

  @Test
  fun aRefreshLeavesCreatedAtAlone() {
    val row = fcmDeviceRow(token, AglynAppId.POS, null, firstWrite = false)!!
    assertEquals(setOf("token", "transport", "platform", "app", "lastSeen"), row.keys)
    assertEquals("aglyn-pos", row["app"])
  }

  @Test
  fun capsTheAppVersion() {
    assertEquals(32, (fcmDeviceRow(token, AglynAppId.AGLYN, "1".repeat(40), false)!!["appVersion"] as String).length)
  }

  @Test
  fun refusesATokenTheRulesWouldRefuse() {
    assertNull(fcmDeviceRow("short", AglynAppId.AGLYN, null, true))
    assertFalse(isFcmToken("A".repeat(99)))
    assertFalse(isFcmToken("A".repeat(120) + "!"))
    assertFalse(isFcmToken("A".repeat(4097)))
    assertTrue(isFcmToken(token))
  }

  @Test
  fun rowsLiveUnderTheMembersDevices() {
    assertEquals("users/u1/devices/i1", deviceRowPath("u1", "i1"))
  }
}
