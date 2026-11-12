package com.aglyn.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle

/**
 * Inline markdown for text a person reads, not edits: the AI panel's answers.
 *
 * It speaks what the console's Assist panel renders (`renderAssistText`: a markdown link to a root-relative path or an
 * http(s) address, and a bare http(s) address, become links; everything else stays text with its line breaks) plus
 * what the Apple sheet's `AttributedString(markdown:, .inlineOnlyPreservingWhitespace)` already draws: **strong**,
 * *emphasis*, `code` and ~~strike~~. No blocks: a `#`, a list marker or a blank line stays as written, as on both.
 *
 * A link whose target is neither `/…` nor `http(s)://…` stays the literal text, as the console leaves it.
 */
object InlineMarkdown {
  sealed interface Node
  data class Text(val text: String) : Node
  data class Strong(val children: List<Node>) : Node
  data class Emphasis(val children: List<Node>) : Node
  data class Strike(val children: List<Node>) : Node
  data class Code(val text: String) : Node
  data class Link(val href: String, val children: List<Node>) : Node

  /** The text's inline nodes, adjacent text merged. */
  fun parse(text: String): List<Node> = Parser(text).run(0, text.length)

  /** What the nodes read as with the markup taken off (screen readers, tests). */
  fun plain(nodes: List<Node>): String = buildString { nodes.forEach { appendPlain(it) } }

  private fun StringBuilder.appendPlain(node: Node) {
    when (node) {
      is Text -> append(node.text)
      is Code -> append(node.text)
      is Strong -> node.children.forEach { appendPlain(it) }
      is Emphasis -> node.children.forEach { appendPlain(it) }
      is Strike -> node.children.forEach { appendPlain(it) }
      is Link -> node.children.forEach { appendPlain(it) }
    }
  }

  /**
   * The text as an [AnnotatedString]: links in [linkColor] that call [onLink] with their target (the plugin context
   * opens a `/…` path in the app and an address in the in-app browser), strong as bold, emphasis as italic, code in
   * the monospace face, strike struck through.
   */
  fun annotated(text: String, linkColor: Color, onLink: (String) -> Unit): AnnotatedString {
    val linkStyles = TextLinkStyles(SpanStyle(color = linkColor))
    return buildAnnotatedString {
      fun emit(node: Node) {
        when (node) {
          is Text -> append(node.text)
          is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(node.text) }
          is Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { node.children.forEach(::emit) }
          is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { node.children.forEach(::emit) }
          is Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { node.children.forEach(::emit) }
          is Link -> withLink(LinkAnnotation.Clickable(node.href, linkStyles) { onLink(node.href) }) { node.children.forEach(::emit) }
        }
      }
      parse(text).forEach(::emit)
    }
  }

  private class Parser(val s: String) {
    fun run(from: Int, to: Int): List<Node> {
      val out = mutableListOf<Node>()
      val buffer = StringBuilder()
      fun flush() { if (buffer.isNotEmpty()) { out += Text(buffer.toString()); buffer.clear() } }
      var i = from
      while (i < to) {
        val c = s[i]
        // A backslash takes the next punctuation literally, as markdown does.
        if (c == '\\' && i + 1 < to && s[i + 1] in ESCAPABLE) { buffer.append(s[i + 1]); i += 2; continue }
        val matched = code(i, to) ?: link(i, to) ?: bare(i, to) ?: delimited(i, to)
        if (matched != null) { flush(); out += matched.first; i = matched.second; continue }
        buffer.append(c)
        i++
      }
      flush()
      return out
    }

    /** `code`: everything to the next backtick, untouched. */
    private fun code(i: Int, to: Int): Pair<Node, Int>? {
      if (s[i] != '`') return null
      val close = s.indexOf('`', i + 1).takeIf { it in (i + 2) until to } ?: return null
      return Code(s.substring(i + 1, close)) to close + 1
    }

    /** [label](/path) or [label](https://…), the console's pattern. */
    private fun link(i: Int, to: Int): Pair<Node, Int>? {
      if (s[i] != '[') return null
      val close = matchingBracket(i, to) ?: return null
      if (close + 1 >= to || s[close + 1] != '(' || close == i + 1) return null
      val end = s.indexOf(')', close + 2).takeIf { it in 0 until to } ?: return null
      val href = s.substring(close + 2, end)
      if (!isTarget(href)) return null
      return Link(href, run(i + 1, close)) to end + 1
    }

    private fun matchingBracket(open: Int, to: Int): Int? {
      var depth = 0
      var j = open
      while (j < to) {
        when (s[j]) {
          '\\' -> j++
          '[' -> depth++
          ']' -> if (--depth == 0) return j
          '\n' -> if (j + 1 < to && s[j + 1] == '\n') return null
        }
        j++
      }
      return null
    }

    /** A bare http(s) address, at a word's start, up to a space or `)`; a sentence's closing mark stays outside it. */
    private fun bare(i: Int, to: Int): Pair<Node, Int>? {
      if (!s.startsWith("http://", i) && !s.startsWith("https://", i)) return null
      if (i > 0 && s[i - 1].isLetterOrDigit()) return null
      var end = i
      while (end < to && !s[end].isWhitespace() && s[end] != ')') end++
      while (end > i && s[end - 1] in TRAILING) end--
      val href = s.substring(i, end)
      if (!isTarget(href)) return null
      return Link(href, listOf(Text(href))) to end
    }

    /** **strong** / __strong__, ~~strike~~, *emphasis* / _emphasis_; a `_` inside a word is a letter, not markup. */
    private fun delimited(i: Int, to: Int): Pair<Node, Int>? {
      val c = s[i]
      if (c != '*' && c != '_' && c != '~') return null
      val double = i + 1 < to && s[i + 1] == c
      if (c == '~' && !double) return null
      val width = if (double) 2 else 1
      val delimiter = s.substring(i, i + width)
      val start = i + width
      if (start >= to || s[start].isWhitespace()) return null
      if (c == '_' && i > 0 && s[i - 1].isLetterOrDigit()) return null
      var j = start + 1
      while (j <= to - width) {
        if (s[j] == '\\') { j += 2; continue }
        val skipped = if (s[j] == '`') code(j, to) else null
        if (skipped != null) { j = skipped.second; continue }
        if (s.startsWith(delimiter, j) && !s[j - 1].isWhitespace() &&
          // A single * never closes on half of a **, nor a single _ on half of a __.
          (double || !(j + 1 < to && s[j + 1] == c)) &&
          !(c == '_' && j + width < to && s[j + width].isLetterOrDigit())
        ) {
          val inner = run(start, j)
          val node = when {
            c == '~' -> Strike(inner)
            double -> Strong(inner)
            else -> Emphasis(inner)
          }
          return node to j + width
        }
        j += if (!double && s[j] == c && j + 1 < to && s[j + 1] == c) 2 else 1
      }
      return null
    }

    private fun isTarget(href: String): Boolean =
      (href.startsWith("/") && href.none { it.isWhitespace() }) ||
        ((href.startsWith("http://") || href.startsWith("https://")) && href.length > href.indexOf("//") + 2 && href.none { it.isWhitespace() })
  }

  private const val ESCAPABLE = "\\`*_{}[]()#+-.!~>|"
  private const val TRAILING = ".,;:!?'\""
}

/** [InlineMarkdown.annotated] for a composable, remembered per text, its links in the accent's text shade. */
@Composable
fun rememberInlineMarkdown(text: String, onLink: (String) -> Unit): AnnotatedString {
  val linkColor = aglynAccentText
  val open = rememberUpdatedState(onLink)
  return remember(text, linkColor) { InlineMarkdown.annotated(text, linkColor) { open.value(it) } }
}
