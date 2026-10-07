package com.aglyn.ui

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.aglyn.ui.resources.Res
import com.aglyn.ui.resources.aglyn_logo
import com.aglyn.ui.resources.aglyn_mark
import com.aglyn.ui.resources.aglyn_wordmark
import org.jetbrains.compose.resources.painterResource

/** The Aglyn mark alone (the app icon's glyph). */
@Composable
fun AglynMark(modifier: Modifier = Modifier, contentDescription: String? = null) =
  Image(painterResource(Res.drawable.aglyn_mark), contentDescription, modifier)

/** The mark beside the wordmark; the dark-theme copy has white ink. */
@Composable
fun AglynLogo(modifier: Modifier = Modifier, contentDescription: String? = "Aglyn") =
  Image(painterResource(Res.drawable.aglyn_logo), contentDescription, modifier)

/** The wordmark alone. */
@Composable
fun AglynWordmark(modifier: Modifier = Modifier, contentDescription: String? = "Aglyn") =
  Image(painterResource(Res.drawable.aglyn_wordmark), contentDescription, modifier)

/** The mark as a painter, for a window or tray icon. */
@Composable
fun aglynMarkPainter(): androidx.compose.ui.graphics.painter.Painter = painterResource(Res.drawable.aglyn_mark)
