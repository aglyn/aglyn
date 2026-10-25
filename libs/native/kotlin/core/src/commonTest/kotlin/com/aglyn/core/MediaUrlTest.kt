package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MediaUrlTest {
  @Test
  fun aReferenceIsServedFromTheConsolesCdnForTheSiteBeingShown() {
    assertEquals("https://console.test/api/media/cdn/h/m1?w=320", mediaPreviewUrl("media:h/m1", "https://console.test/", "h"))
    assertEquals("https://console.test/api/media/cdn/org:o1:h9/m2?w=320", mediaPreviewUrl("media:org:o1/m2", "https://console.test", "h9"))
    assertEquals("https://console.test/api/media/cdn/org:o1/m2?w=96", mediaPreviewUrl("media:org:o1/m2", "https://console.test", null, 96))
  }

  @Test
  fun aCdnPathAsTheMediaPickerStoresItIsReadFromTheConsole() {
    // A workspace logo and a site favicon hold `media.cdnPath ?: media.url` (the console's MediaUrlField).
    assertEquals("http://10.0.2.2:4370/api/media/cdn/org:o1/logo?w=160", mediaPreviewUrl("/api/media/cdn/org:o1/logo", "http://10.0.2.2:4370", null, 160))
    assertEquals("https://console.test/img/a.png", mediaPreviewUrl("/img/a.png", "https://console.test", "h"))
  }

  @Test
  fun anAddressStaysAsItIs() {
    assertEquals("https://example.com/a.png", mediaPreviewUrl("https://example.com/a.png", "https://console.test", "h"))
  }

  @Test
  fun nothingOrAnythingThatIsNotAnHttpAddressIsNoPicture() {
    assertNull(mediaPreviewUrl(null, "https://console.test", "h"))
    assertNull(mediaPreviewUrl("  ", "https://console.test", "h"))
    assertNull(mediaPreviewUrl("javascript:alert(1)", "https://console.test", null))
    assertNull(mediaPreviewUrl("//evil.example/a.png", "https://console.test", null))
    assertNull(mediaPreviewUrl("a bowl on a shelf", "https://console.test", null))
    assertNull(mediaPreviewUrl("media:not a ref", "https://console.test", null))
  }

  @Test
  fun anSvgIsReadAsTheCdnsPngOfIt() {
    // A logo the decoders cannot read (an SVG) is asked of the CDN as a transparent PNG at least as wide as it was shown.
    assertEquals("http://10.0.2.2:4410/api/media/cdn/org:o1/logo?icon=png-192", mediaRasterUrl("http://10.0.2.2:4410/api/media/cdn/org:o1/logo?w=160"))
    assertEquals("https://c.test/api/media/cdn/h/m?v=3&icon=png-96", mediaRasterUrl("https://c.test/api/media/cdn/h/m?w=96&v=3"))
    assertEquals("https://c.test/api/media/cdn/h/m?icon=png-192", mediaRasterUrl("https://c.test/api/media/cdn/h/m"))
    assertEquals("https://c.test/api/media/cdn/h/m?icon=png-512", mediaRasterUrl("https://c.test/api/media/cdn/h/m?w=2000"))
    // Off the CDN, or already a representation: nothing to ask for.
    assertNull(mediaRasterUrl("https://example.com/logo.svg"))
    assertNull(mediaRasterUrl("https://c.test/api/media/cdn/h/m?icon=png-32"))
  }
}
