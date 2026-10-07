package com.aglyn.webview

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionCookieTest {
  @Test
  fun readsTheConsolesHttpOnlySessionCookie() {
    val cookie = parseSetCookie("__session=abc.def; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax", "app.aglyn.com", 1_000.0)
    assertEquals(SessionCookie("__session", "abc.def", "app.aglyn.com", "/", httpOnly = true, secure = true, sameSite = "Lax", expiresEpochSeconds = 1_210_600.0), cookie)
  }

  @Test
  fun maxAgeWinsOverExpiresAndADomainDropsItsDot() {
    val cookie = parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=60; Domain=.Aglyn.com", "app.aglyn.com", 100.0)!!
    assertEquals(160.0, cookie.expiresEpochSeconds)
    assertEquals("aglyn.com", cookie.domain)
    assertEquals(false, cookie.httpOnly)
    assertNull(cookie.sameSite)
  }

  @Test
  fun readsAnHttpDate() {
    assertEquals(1_792_567_680.0, parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT", "h", 0.0)!!.expiresEpochSeconds)
    assertEquals(0.0, parseHttpDate("Thu, 01 Jan 1970 00:00:00 GMT"))
    assertNull(parseHttpDate("tomorrow"))
  }

  @Test
  fun aSessionCookieHasNoExpiryAndANamelessHeaderIsNone() {
    assertNull(parseSetCookie("a=\"quoted\"; Path=/x", "h", 0.0)!!.expiresEpochSeconds)
    assertEquals("quoted", parseSetCookie("a=\"quoted\"", "h", 0.0)!!.value)
    assertNull(parseSetCookie("novalue", "h", 0.0))
    assertNull(parseSetCookie("=x", "h", 0.0))
  }
}
