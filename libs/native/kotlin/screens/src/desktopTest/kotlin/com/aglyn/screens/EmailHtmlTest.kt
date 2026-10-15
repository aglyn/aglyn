package com.aglyn.screens

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import kotlinx.serialization.json.Json
import java.io.File
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The staff apps' message viewer, replayed over libs/native/screens/email-html-cases.json (Apple replays the same file): real mail from the
 * console's renderer, and hostile and malformed messages.
 */
class EmailHtmlTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }
    .first { File(it, "libs/native/screens").isDirectory }

  private class Case(val name: String, val html: String, val text: List<String>, val links: List<String>, val absent: List<String>)

  private fun cases(): List<Case> {
    val file = Json.parseToJsonElement(File(root, "libs/native/screens/email-html-cases.json").readText())
    return file.arr("cases").map { entry ->
      fun strings(key: String) = entry.arr(key).map { ScreenValues.text(it) }
      Case(entry.str("name")!!, entry.str("html")!!, strings("text"), strings("links"), strings("absent"))
    }
  }

  private fun words(text: AnnotatedString): String = text.text.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")

  private fun links(text: AnnotatedString): List<String> =
    text.getLinkAnnotations(0, text.length).mapNotNull { (it.item as? LinkAnnotation.Url)?.url }

  /** An address as a reader would open it: the root path a bare host leaves out, written in. */
  private fun normalized(address: String): String {
    val uri = runCatching { URI(address.replace("…", "%E2%80%A6")) }.getOrNull() ?: return address
    return if (uri.host != null && uri.rawPath.isNullOrEmpty()) uri.toString() + "/" else uri.toString()
  }

  @Test
  fun everyCaseReadsItsWordsInOrderAndOpensOnlyItsLinks() {
    val all = cases()
    assertTrue(all.size >= 12)
    for (entry in all) {
      val shown = EmailHtml.annotated(entry.html)
      val read = words(shown)
      var from = 0
      for (expected in entry.text) {
        val folded = expected.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
        val found = read.indexOf(folded, from)
        assertTrue(found >= 0, "${entry.name}: \"$folded\" is not read in order in: $read")
        from = found + folded.length
      }
      assertEquals(entry.links.map(::normalized).toSet(), links(shown).map(::normalized).toSet(), entry.name)
      val clean = EmailHtml.sanitize(entry.html).lowercase()
      for (banned in entry.absent) {
        assertFalse(clean.contains(banned.lowercase()), "${entry.name}: cleaned HTML still holds $banned")
        assertFalse(read.lowercase().contains(banned.lowercase()), "${entry.name}: the text still holds $banned")
      }
    }
  }

  @Test
  fun linksKeepOnlyWhatMayBeOpened() {
    assertEquals("https://example.com/a", EmailHtml.openableAddress("https://example.com/a"))
    assertEquals("mailto:a@b.co", EmailHtml.openableAddress(" mailto:a@b.co "))
    assertNull(EmailHtml.openableAddress("javascript:alert(1)"))
    assertNull(EmailHtml.openableAddress("java&#115;cript:alert(1)"))
    assertNull(EmailHtml.openableAddress("jav&#x61;script&colon;alert(1)"))
    assertNull(EmailHtml.openableAddress("\tjava\nscript:alert(1)"))
    assertNull(EmailHtml.openableAddress("data:text/html;base64,AAAA"))
    assertNull(EmailHtml.openableAddress("/relative"))
    assertTrue(EmailHtml.isOpenable("tel:+15125550100"))
    assertFalse(EmailHtml.isOpenable("file:///etc/passwd"))
  }

  @Test
  fun emphasisSurvivesAsStyledText() {
    val shown = EmailHtml.annotated("<p>Total <b>\$12.00</b> for <i>one month</i>.</p>")
    val bold = shown.spanStyles.filter { it.item.fontWeight == FontWeight.Bold }.map { shown.text.substring(it.start, it.end) }
    val italic = shown.spanStyles.filter { it.item.fontStyle == FontStyle.Italic }.map { shown.text.substring(it.start, it.end) }
    assertEquals(listOf("\$12.00"), bold)
    assertEquals(listOf("one month"), italic)
  }

  @Test
  fun listItemsAndBlocksKeepTheirLines() {
    val shown = EmailHtml.annotated("<h1>Receipt</h1><ul><li>First item</li><li>Second item</li></ul><p>Done</p>")
    assertEquals(listOf("Receipt", "", "• First item", "• Second item", "", "Done"), shown.text.lines())
  }

  @Test
  fun anEmptyMessageIsNothingToShow() {
    assertEquals("", EmailHtml.annotated("").text)
    assertEquals("", EmailHtml.annotated("<script>x()</script>").text)
    assertNotNull(EmailHtml.annotated("<p>x</p>"))
  }
}
