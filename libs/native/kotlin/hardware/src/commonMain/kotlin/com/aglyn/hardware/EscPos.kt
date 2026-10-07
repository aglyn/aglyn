package com.aglyn.hardware

/**
 * ESC/POS bytes for a [PrintDocument]: the command set Epson TM, Star (in
 * ESC/POS mode), Bixolon, Citizen and most no-name thermal printers take over
 * a raw socket (TCP 9100), USB or serial.
 *
 * Every job starts from a reset (`ESC @`) on code page PC437, and text is
 * already [toPrintable], so a byte is always one ASCII character. Styles are
 * set only when they change, and reset at the end of each line that set
 * them, so a dropped job never leaves the next one bold or centered.
 */
class EscPosEncoder(
  /** The NV graphics key (1-255) of a logo stored in the printer; null prints none. */
  private val logoImage: Int? = null,
  /** Which drawer connector the kick pulses: pin 2 (0) or pin 5 (1). */
  private val drawerPin: Int = 0,
) {
  fun encode(document: PrintDocument): ByteArray {
    val out = ByteSink()
    out.add(*INITIALIZE)
    out.add(*SELECT_PC437)
    for (op in document.ops) {
      when (op) {
        is PrintOp.Text -> text(out, op, document.columns)
        is PrintOp.Feed -> out.add(ESC, 0x64, op.lines.coerceIn(1, 10))
        is PrintOp.Barcode -> barcode(out, op.data)
        PrintOp.Logo -> logo(out)
        PrintOp.Drawer -> out.add(*drawerKick(drawerPin))
        PrintOp.Cut -> out.add(*CUT)
      }
    }
    return out.toByteArray()
  }

  private fun text(out: ByteSink, op: PrintOp.Text, columns: Int) {
    val size = if (op.size == 2) 2 else 1
    // Double width halves the line, so a size-2 line keeps to half the paper.
    val text = toPrintable(op.text).take(if (size == 2) columns / 2 else columns)
    if (op.align != PrintAlign.LEFT) out.add(ESC, 0x61, op.align.ordinal)
    if (op.bold) out.add(ESC, 0x45, 1)
    if (size == 2) out.add(GS, 0x21, 0x11)
    out.ascii(text)
    out.add(LF)
    if (size == 2) out.add(GS, 0x21, 0x00)
    if (op.bold) out.add(ESC, 0x45, 0)
    if (op.align != PrintAlign.LEFT) out.add(ESC, 0x61, 0)
  }

  private fun barcode(out: ByteSink, data: String) {
    val code = code128Printable(data)
    if (code.isEmpty()) return
    out.add(ESC, 0x61, 1)
    // 64 dots tall, module width 2, the digits printed below the bars.
    out.add(GS, 0x68, 64)
    out.add(GS, 0x77, 2)
    out.add(GS, 0x48, 2)
    // GS k 73 (Code128) with its length, then `{B` to select code set B.
    out.add(GS, 0x6b, 73, code.length + 2, 0x7b, 0x42)
    out.ascii(code)
    out.add(LF)
    out.add(ESC, 0x61, 0)
  }

  private fun logo(out: ByteSink) {
    val key = logoImage ?: return
    out.add(ESC, 0x61, 1)
    // FS p n m: print NV bit image n at normal scale.
    out.add(FS, 0x70, key.coerceIn(1, 255), 0)
    out.add(ESC, 0x61, 0)
  }

  companion object {
    const val ESC = 0x1b
    const val GS = 0x1d
    const val FS = 0x1c
    const val LF = 0x0a

    /** `ESC @`: clears the printer's modes and buffer. */
    val INITIALIZE = intArrayOf(ESC, 0x40)

    /** `ESC t 0`: code page PC437, whose lower half is ASCII. */
    val SELECT_PC437 = intArrayOf(ESC, 0x74, 0)

    /** `GS V 66 0`: feed to the cutter, then a partial cut. */
    val CUT = intArrayOf(GS, 0x56, 66, 0)

    /**
     * `ESC p m t1 t2`: one pulse on drawer pin [pin] (0 = pin 2, 1 = pin 5),
     * on for 25 × 2 ms and off for 250 × 2 ms, the timing drawers expect.
     */
    fun drawerKick(pin: Int = 0) = intArrayOf(ESC, 0x70, pin.coerceIn(0, 1), 25, 250)

    /** The bytes of a drawer kick with nothing printed. */
    fun drawerKickBytes(pin: Int = 0): ByteArray = EscPosEncoder(drawerPin = pin).encode(drawerKickDocument())
  }
}

private class ByteSink {
  private val bytes = ArrayList<Byte>(512)

  fun add(vararg values: Int) {
    for (value in values) bytes += value.toByte()
  }

  fun ascii(text: String) {
    for (char in text) bytes += (if (char.code in 0x20..0x7e) char.code else '?'.code).toByte()
  }

  fun toByteArray(): ByteArray = bytes.toByteArray()
}
