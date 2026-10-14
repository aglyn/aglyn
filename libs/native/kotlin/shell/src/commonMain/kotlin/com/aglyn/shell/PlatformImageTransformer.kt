package com.aglyn.shell

import com.aglyn.ui.ImageTransformer

/** The image editor's pixels on this platform: Android's bitmaps, the desktop's java.awt. */
expect fun platformImageTransformer(): ImageTransformer
