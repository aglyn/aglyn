package com.aglyn.core

import java.text.Normalizer

internal actual fun stripMarks(value: String): String =
  Normalizer.normalize(value, Normalizer.Form.NFKD).replace(Regex("[\\u0300-\\u036f]"), "")
