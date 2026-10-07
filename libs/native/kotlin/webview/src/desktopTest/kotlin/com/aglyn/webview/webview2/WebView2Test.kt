package com.aglyn.webview.webview2

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class WebView2Test {
  @Test
  fun aGuidIsLaidOutAsWindowsStoresIt() {
    // IUnknown: {00000000-0000-0000-C000-000000000046}.
    assertContentEquals(
      byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0, 0xC0.toByte(), 0, 0, 0, 0, 0, 0, 0x46),
      guidBytes("00000000-0000-0000-C000-000000000046"),
    )
    // Data1..3 little-endian, Data4 as written.
    assertContentEquals(
      byteArrayOf(0xF8.toByte(), 0x0C, 0x8F.toByte(), 0x9E.toByte(), 0x70, 0xE6.toByte(), 0x5E, 0x4B, 0xB2.toByte(), 0xBC.toByte(), 0x73, 0xE0.toByte(), 0x61, 0xE3.toByte(), 0x18, 0x4C),
      guidBytes("{9E8F0CF8-E670-4B5E-B2BC-73E061E3184C}"),
    )
    assertFailsWith<IllegalArgumentException> { guidBytes("not-a-guid") }
  }

  @Test
  fun sameSiteMapsToWebView2sKinds() {
    assertEquals(0, sameSiteKind("None"))
    assertEquals(1, sameSiteKind("Lax"))
    assertEquals(2, sameSiteKind("STRICT"))
  }

  @Test
  fun theProfileLivesUnderLocalAppData() {
    assertEquals(java.io.File("C:/Users/a/AppData/Local", "Aglyn/WebView2").path, webView2DataFolder("C:/Users/a/AppData/Local"))
  }

  @Test
  fun anythingButWindowsWithTheLoaderIsUnsupported() {
    if (!System.getProperty("os.name").startsWith("Windows")) assertFalse(webView2Supported)
  }
}
