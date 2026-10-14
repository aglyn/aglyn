package com.aglyn.screens

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import java.io.StringReader
import javax.swing.text.MutableAttributeSet
import javax.swing.text.html.HTML
import javax.swing.text.html.HTMLEditorKit
import javax.swing.text.html.parser.ParserDelegator

/**
 * The desktop JDK has no `android.text.Html`; its own HTML parser (`javax.swing.text.html`, no window involved) reads the cleaned message
 * into styled text the same way: bold, italic, underline, strike, monospace and links, a bullet for a list item, a line for a block.
 */
internal actual fun htmlToAnnotated(sanitized: String): AnnotatedString {
  val builder = AnnotatedString.Builder()
  // How many styles each open tag pushed, so its end pops the same.
  val pushed = ArrayDeque<Pair<HTML.Tag, Int>>()
  val lists = ArrayDeque<Pair<Boolean, Int>>() // ordered?, items so far
  var preformatted = 0
  var pendingSpace = false

  fun last(): Char? = builder.length.takeIf { it > 0 }?.let { builder.toAnnotatedString().text[it - 1] }

  fun newline(blank: Boolean = false) {
    val text = builder.toAnnotatedString().text
    if (text.isEmpty()) return
    val wanted = if (blank) "\n\n" else "\n"
    if (!text.endsWith(wanted)) {
      builder.append(if (text.endsWith("\n")) "\n" else wanted)
    }
    pendingSpace = false
  }

  fun push(style: SpanStyle): Int {
    builder.pushStyle(style)
    return 1
  }

  val callback = object : HTMLEditorKit.ParserCallback() {
    override fun handleStartTag(tag: HTML.Tag, attributes: MutableAttributeSet, position: Int) {
      var count = 0
      when (tag) {
        HTML.Tag.B, HTML.Tag.STRONG, HTML.Tag.H1, HTML.Tag.H2, HTML.Tag.H3, HTML.Tag.H4, HTML.Tag.H5, HTML.Tag.H6 -> {
          if (tag.isBlock) newline(blank = true)
          count += push(SpanStyle(fontWeight = FontWeight.Bold))
        }
        HTML.Tag.I, HTML.Tag.EM -> count += push(SpanStyle(fontStyle = FontStyle.Italic))
        HTML.Tag.U -> count += push(SpanStyle(textDecoration = TextDecoration.Underline))
        HTML.Tag.S, HTML.Tag.STRIKE -> count += push(SpanStyle(textDecoration = TextDecoration.LineThrough))
        HTML.Tag.CODE, HTML.Tag.PRE -> {
          if (tag == HTML.Tag.PRE) {
            preformatted++
            newline()
          }
          count += push(SpanStyle(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace))
        }
        HTML.Tag.A -> {
          val href = attributes.getAttribute(HTML.Attribute.HREF)?.toString()
          if (href != null && EmailHtml.isOpenable(href)) {
            builder.pushLink(LinkAnnotation.Url(href, TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))))
            count += 1
          }
        }
        HTML.Tag.P, HTML.Tag.BLOCKQUOTE -> newline(blank = true)
        HTML.Tag.DIV -> newline()
        HTML.Tag.UL -> {
          newline()
          lists.addLast(false to 0)
        }
        HTML.Tag.OL -> {
          newline()
          lists.addLast(true to 0)
        }
        HTML.Tag.LI -> {
          newline()
          val (ordered, items) = lists.removeLastOrNull() ?: (false to 0)
          lists.addLast(ordered to items + 1)
          builder.append(if (ordered) "${items + 1}. " else "\u2022 ")
        }
        else -> Unit
      }
      pushed.addLast(tag to count)
    }

    override fun handleEndTag(tag: HTML.Tag, position: Int) {
      val index = pushed.indexOfLast { it.first == tag }
      if (index >= 0) {
        repeat(pushed[index].second) { builder.pop() }
        pushed.removeAt(index)
      }
      when (tag) {
        HTML.Tag.P, HTML.Tag.BLOCKQUOTE, HTML.Tag.H1, HTML.Tag.H2, HTML.Tag.H3, HTML.Tag.H4, HTML.Tag.H5, HTML.Tag.H6 -> newline(blank = true)
        HTML.Tag.DIV, HTML.Tag.LI -> newline()
        HTML.Tag.UL, HTML.Tag.OL -> {
          lists.removeLastOrNull()
          newline()
        }
        HTML.Tag.PRE -> {
          preformatted = (preformatted - 1).coerceAtLeast(0)
          newline()
        }
        else -> Unit
      }
    }

    override fun handleSimpleTag(tag: HTML.Tag, attributes: MutableAttributeSet, position: Int) {
      when (tag) {
        HTML.Tag.BR -> builder.append("\n")
        HTML.Tag.HR -> newline()
        else -> Unit
      }
    }

    override fun handleText(data: CharArray, position: Int) {
      val raw = String(data)
      if (preformatted > 0) {
        builder.append(raw)
        return
      }
      // Runs of white space are one space, and none at the start of a line, as a browser reads it.
      val collapsed = raw.replace('\u00A0', '\u0001').replace(Regex("\\s+"), " ").replace('\u0001', '\u00A0')
      if (collapsed.isBlank() && collapsed.none { it == '\u00A0' }) {
        pendingSpace = true
        return
      }
      val atLineStart = last() == null || last() == '\n'
      val lead = collapsed.startsWith(" ")
      if (!atLineStart && (pendingSpace || lead) && last() != ' ') builder.append(' ')
      builder.append(if (atLineStart) collapsed.trimStart() else collapsed.trimStart())
      pendingSpace = collapsed.endsWith(" ")
    }
  }
  ParserDelegator().parse(StringReader(sanitized), callback, true)
  while (pushed.isNotEmpty()) repeat(pushed.removeLast().second) { builder.pop() }
  return builder.toAnnotatedString()
}
