package com.aglyn.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontWeight
import com.aglyn.ui.InlineMarkdown.Code
import com.aglyn.ui.InlineMarkdown.Emphasis
import com.aglyn.ui.InlineMarkdown.Link
import com.aglyn.ui.InlineMarkdown.Strike
import com.aglyn.ui.InlineMarkdown.Strong
import com.aglyn.ui.InlineMarkdown.Text
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The AI panel's answers: the console's links (`renderAssistText`) plus the Apple sheet's inline marks. */
class InlineMarkdownTest {
  private fun parse(text: String) = InlineMarkdown.parse(text)

  @Test
  fun aMarkdownLinkToAPathOrAnAddressIsALink() {
    assertEquals(
      listOf(Text("Open "), Link("/acme/hosts/shop/pages", listOf(Text("Pages"))), Text(" or "), Link("https://docs.example.com/a", listOf(Text("the guide"))), Text(".")),
      parse("Open [Pages](/acme/hosts/shop/pages) or [the guide](https://docs.example.com/a)."),
    )
  }

  @Test
  fun aLinkToAnythingElseStaysText() {
    assertEquals(listOf(Text("[mail](mailto:a@example.com) and [x](relative/path)")), parse("[mail](mailto:a@example.com) and [x](relative/path)"))
  }

  @Test
  fun aBareAddressIsALinkWithoutItsClosingMark() {
    assertEquals(
      listOf(
        Text("See "), Link("https://example.com/help", listOf(Text("https://example.com/help"))),
        Text(" (or "), Link("http://example.com", listOf(Text("http://example.com"))), Text(")."),
      ),
      parse("See https://example.com/help (or http://example.com)."),
    )
  }

  @Test
  fun theInlineMarksTheAppleSheetDraws() {
    assertEquals(
      listOf(Strong(listOf(Text("Save"))), Text(" then "), Emphasis(listOf(Text("publish"))), Text(", not "), Strike(listOf(Text("delete"))), Text(" — run "), Code("npm i")),
      parse("**Save** then *publish*, not ~~delete~~ — run `npm i`"),
    )
    assertEquals(listOf(Strong(listOf(Text("a"))), Text(" "), Emphasis(listOf(Text("b")))), parse("__a__ _b_"))
  }

  @Test
  fun marksNestAndALinkLabelCarriesThem() {
    assertEquals(listOf(Strong(listOf(Text("Go to "), Link("/x", listOf(Emphasis(listOf(Text("Orders")))))))), parse("**Go to [*Orders*](/x)**"))
  }

  @Test
  fun whatIsNotMarkupStaysAsWritten() {
    val text = "# Heading\n\n- a snake_case_name, 2 * 3 * 4, a lone ** and `unclosed\n1. kept"
    assertEquals(listOf(Text(text)), parse(text))
    assertEquals(listOf(Text("a *literal* star")), parse("a \\*literal\\* star"))
    assertEquals(listOf(Text("code keeps "), Code("**this**")), parse("code keeps `**this**`"))
  }

  @Test
  fun theAnnotatedStringHasTheLinksAndTheReadableText() {
    val opened = mutableListOf<String>()
    val text = InlineMarkdown.annotated("**Open** [Pages](/p) or https://example.com.", Color.Blue) { opened += it }
    assertEquals("Open Pages or https://example.com.", text.text)
    val links = text.getLinkAnnotations(0, text.length)
    assertEquals(listOf("/p", "https://example.com"), links.map { (it.item as LinkAnnotation.Clickable).tag })
    assertEquals("Pages", text.text.substring(links[0].start, links[0].end))
    links.forEach { (it.item as LinkAnnotation.Clickable).linkInteractionListener?.onClick(it.item) }
    assertEquals(listOf("/p", "https://example.com"), opened)
    assertTrue(text.spanStyles.any { it.item.fontWeight == FontWeight.Bold && text.text.substring(it.start, it.end) == "Open" })
  }
}
