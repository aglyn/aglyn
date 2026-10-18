package com.aglyn.ui

import androidx.compose.ui.window.DialogProperties

/**
 * A sheet's window: as wide as the sheet asks, and on Android drawn edge to edge so the keyboard's inset reaches the
 * sheet (its `imePadding` then lifts the field being typed in above the keyboard instead of leaving it behind it).
 */
expect fun sheetDialogProperties(dismissOnClickOutside: Boolean = true): DialogProperties
