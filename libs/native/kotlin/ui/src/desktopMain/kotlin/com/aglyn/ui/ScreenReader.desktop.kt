package com.aglyn.ui

import androidx.compose.runtime.Composable

/** The desktop reads no system screen-reader switch; `-Daglyn.screenReader=true` holds the carousel still for a test. */
@Composable
actual fun screenReaderOn(): Boolean = System.getProperty("aglyn.screenReader")?.toBoolean() ?: false
