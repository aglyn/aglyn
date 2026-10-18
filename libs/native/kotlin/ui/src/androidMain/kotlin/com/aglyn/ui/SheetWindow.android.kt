package com.aglyn.ui

import androidx.compose.ui.window.DialogProperties

actual fun sheetDialogProperties(dismissOnClickOutside: Boolean): DialogProperties =
  DialogProperties(dismissOnClickOutside = dismissOnClickOutside, usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
