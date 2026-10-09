package com.aglyn.core

/**
 * A day (`yyyy-MM-dd`) and a time of day (`HH:mm`) on this device's clock as
 * epoch ms, the way a browser's `new Date('yyyy-MM-ddTHH:mm')` reads a
 * `datetime-local` field; null when either does not parse.
 */
expect fun localDateTimeMillis(day: String, time: String): Long?

/** An instant as this device's local day and time of day: (`yyyy-MM-dd`, `HH:mm`). */
expect fun localDayAndTime(millis: Long): Pair<String, String>
