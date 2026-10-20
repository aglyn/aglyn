package com.aglyn.ui

import androidx.compose.runtime.Composable

/**
 * Whether a screen reader is on (TalkBack's touch exploration on Android). Something that moves by itself, such as the plan
 * card's carousel, then holds still, so the reader is never read a card that changed under it.
 */
@Composable
expect fun screenReaderOn(): Boolean
