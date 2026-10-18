package com.aglyn.shell

import androidx.compose.runtime.Composable

/** The desktop app posts no push notifications, so it has no sound to pick. */
@Composable
internal actual fun rememberSoundPreview(): ((resource: String) -> Unit)? = null
