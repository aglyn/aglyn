package com.aglyn.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape

/*
 * Material's text and outlined buttons with the accent's TEXT shade as their label (AGL-3990), as the console's MuiButton
 * draws its text and outlined variants (`primary.dark`, AGL-1186). Material paints both labels with `primary`, which is
 * the fill: the brand blue #00B0FF, 2.43:1 as text on white. Same parameters and defaults as Material's otherwise, so a
 * module imports `com.aglyn.ui.TextButton` / `com.aglyn.ui.OutlinedButton` in Material's place and nothing else changes.
 */

/** Material's TextButton, its label in the accent's text shade ([aglynAccentText]). */
@Composable
fun TextButton(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  shape: Shape = ButtonDefaults.textShape,
  colors: ButtonColors = ButtonDefaults.textButtonColors(contentColor = aglynAccentText),
  elevation: ButtonElevation? = null,
  border: BorderStroke? = null,
  contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
  interactionSource: MutableInteractionSource? = null,
  content: @Composable RowScope.() -> Unit,
) {
  androidx.compose.material3.TextButton(
    onClick = onClick,
    modifier = modifier,
    enabled = enabled,
    shape = shape,
    colors = colors,
    elevation = elevation,
    border = border,
    contentPadding = contentPadding,
    interactionSource = interactionSource,
    content = content,
  )
}

/** Material's OutlinedButton, its label in the accent's text shade ([aglynAccentText]); the border stays Material's. */
@Composable
fun OutlinedButton(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  shape: Shape = ButtonDefaults.outlinedShape,
  colors: ButtonColors = ButtonDefaults.outlinedButtonColors(contentColor = aglynAccentText),
  elevation: ButtonElevation? = null,
  border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
  contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
  interactionSource: MutableInteractionSource? = null,
  content: @Composable RowScope.() -> Unit,
) {
  androidx.compose.material3.OutlinedButton(
    onClick = onClick,
    modifier = modifier,
    enabled = enabled,
    shape = shape,
    colors = colors,
    elevation = elevation,
    border = border,
    contentPadding = contentPadding,
    interactionSource = interactionSource,
    content = content,
  )
}
