package com.aglyn.hardware

import java.text.Normalizer

internal actual fun decompose(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKD)
