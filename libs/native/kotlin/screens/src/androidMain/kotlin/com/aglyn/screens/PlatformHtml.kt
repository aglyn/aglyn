package com.aglyn.screens

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.style.TextDecoration

/** Android's own HTML reader (`android.text.Html` through Compose's `AnnotatedString.fromHtml`): links become URL annotations the system opens. */
internal actual fun htmlToAnnotated(sanitized: String): AnnotatedString =
  AnnotatedString.fromHtml(sanitized, linkStyles = TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline)))
