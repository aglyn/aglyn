package com.aglyn.screens

import androidx.compose.ui.text.AnnotatedString

/**
 * A sent email's HTML, drawn natively (the `html` block): cleaned down to what is read, then turned into styled text by the platform's
 * own HTML reader (Android's, through `AnnotatedString.fromHtml`; the desktop JDK's), with its links opening in the system handler. The
 * console shows the same message in a frame with an empty sandbox (no scripts, no forms); nothing here can run a script or fetch an image.
 */
object EmailHtml {
  /** Elements whose content is not for reading, dropped with it. */
  private val droppedWithContent = listOf(
    "head", "script", "style", "noscript", "template", "iframe", "object", "embed", "applet", "svg", "math", "video", "audio",
    "canvas", "title", "map", "select", "textarea",
  )

  /** Tags that stay as they are (a link keeps only an address it may open). */
  private val kept = setOf(
    "a", "b", "strong", "i", "em", "u", "s", "strike", "del", "br", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol",
    "li", "blockquote", "pre", "code", "hr", "sub", "sup", "small", "big", "div",
  )

  /** Layout tags that become a block of their own: a table is read cell by cell, top to bottom. */
  private val blocks = setOf(
    "td", "th", "center", "section", "article", "header", "footer", "main", "aside", "nav", "form", "figure", "figcaption",
    "address", "fieldset", "dl", "dt", "dd",
  )

  /** What a link may open. */
  private val schemes = listOf("http://", "https://", "mailto:", "tel:")

  private val tagPattern = Regex("<(/?)([A-Za-z][A-Za-z0-9]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>")
  private val numericEntity = Regex("&#(x[0-9a-f]+|[0-9]+);?", RegexOption.IGNORE_CASE)

  private fun remove(pattern: String, text: String): String = Regex(pattern, RegexOption.IGNORE_CASE).replace(text, "")

  /**
   * The address an `href` names, if it is one a link may open: white space and control characters taken out and numeric entities decoded
   * first, so `java&#115;cript:` is not read as anything else.
   */
  fun openableAddress(raw: String): String? {
    var decoded = numericEntity.replace(raw) { match ->
      val body = match.groupValues[1]
      val value = if (body.startsWith("x", ignoreCase = true)) body.drop(1).toIntOrNull(16) else body.toIntOrNull()
      value?.takeIf { it in 0..0x10FFFF }?.let { String(Character.toChars(it)) } ?: ""
    }
    decoded = decoded.replace("&colon;", ":", ignoreCase = true)
    val lowered = decoded.filter { !it.isWhitespace() && !it.isISOControl() }.lowercase()
    return raw.trim().takeIf { schemes.any { lowered.startsWith(it) } }
  }

  /** Whether a link found in the result may be opened. */
  fun isOpenable(url: String): Boolean {
    val scheme = url.substringBefore(':', "").lowercase()
    return scheme in setOf("http", "https", "mailto", "tel")
  }

  private fun attribute(name: String, attributes: String): String? {
    val match = Regex("(?:^|\\s)$name\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", RegexOption.IGNORE_CASE).find(attributes) ?: return null
    return listOf(2, 3, 4).firstOrNull { match.groups[it] != null }?.let { match.groupValues[it] }
  }

  /**
   * The message with everything that is not reading taken out: scripts, styles, frames and forms with their content, every attribute but
   * a link's address, comments, and any tag outside the short list above. An image becomes its alternative text, so nothing is fetched.
   */
  fun sanitize(html: String): String {
    var text = html
    text = remove("<!--[\\s\\S]*?-->", text)
    text = remove("<![A-Za-z][^>]*>", text)
    text = remove("<\\?[\\s\\S]*?\\?>", text)
    for (tag in droppedWithContent) text = remove("<$tag\\b[^>]*>[\\s\\S]*?</$tag\\s*>", text)
    val out = StringBuilder()
    var cursor = 0
    // Each open link: true when it keeps its address, false when it is read as the text it wraps.
    val anchors = ArrayDeque<Boolean>()
    for (match in tagPattern.findAll(text)) {
      out.append(text, cursor, match.range.first)
      cursor = match.range.last + 1
      val closing = match.groupValues[1].isNotEmpty()
      val name = match.groupValues[2].lowercase()
      val attributes = match.groupValues[3]
      when {
        name == "img" -> attribute("alt", attributes)?.trim()?.takeIf { it.isNotEmpty() }?.let { out.append(it) }
        name == "a" -> when {
          closing -> anchors.removeLastOrNull()?.let { real -> out.append(if (real) "</a>" else "</span>") }
          else -> {
            val address = attribute("href", attributes)?.let { openableAddress(it) }
            if (address != null) {
              anchors.addLast(true)
              out.append("<a href=\"").append(address.replace("\"", "&quot;")).append("\">")
            } else {
              anchors.addLast(false)
              out.append("<span>")
            }
          }
        }
        name in kept -> out.append(if (closing) "</$name>" else "<$name>")
        name in blocks -> out.append(if (closing) "</div>" else "<div>")
      }
    }
    out.append(text, cursor, text.length)
    return out.toString()
  }

  /** The plain words of cleaned HTML, for a message the reader cannot read. */
  internal fun plainText(html: String): String {
    val breaks = Regex("<(br|/p|/div|/li|/h[1-6])\\b[^>]*>", RegexOption.IGNORE_CASE).replace(html, "\n")
    return Regex("<[^>]+>").replace(breaks, "").replace("&nbsp;", " ").replace("&amp;", "&")
  }

  /** The message as styled text: bold, italic, underline and links kept, colors and sizes left to the app so it reads in dark mode as in light. */
  fun annotated(html: String): AnnotatedString {
    val clean = sanitize(html)
    return runCatching { htmlToAnnotated(clean) }.getOrNull()?.trimmed() ?: AnnotatedString(plainText(clean).trim())
  }

  /** The text without leading and trailing white space. */
  internal fun AnnotatedString.trimmed(): AnnotatedString {
    var start = 0
    var end = length
    while (start < end && text[start].isWhitespace()) start++
    while (end > start && text[end - 1].isWhitespace()) end--
    return subSequence(start, end)
  }
}

/** The platform's HTML reader over cleaned HTML. */
internal expect fun htmlToAnnotated(sanitized: String): AnnotatedString
