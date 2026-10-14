package com.aglyn.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * A QR CODE, drawn on the device. The text is encoded here and never sent
 * anywhere: a live payment URL in a third party's query string is a link that
 * pays the sale for whoever opens it (the console's QR dialog says the same,
 * AGL-1671). Error correction is the lowest level, "L", because the payment
 * page's address is long and the screen is read from a hand's length.
 *
 * The encoder follows ISO/IEC 18004: byte mode (UTF-8), versions 1 to 40, the
 * lowest error-correction level, Reed-Solomon over GF(256), and the mask with
 * the lowest penalty. The specs replay modules the console's own encoder draws.
 */

/** The dark and light modules of one QR symbol. */
class QrCode private constructor(val version: Int, val mask: Int, private val modules: Array<BooleanArray>) {
  /** Modules per side. */
  val size: Int get() = modules.size

  /** True for a dark module; false outside the symbol. */
  fun isDark(x: Int, y: Int): Boolean = x in 0 until size && y in 0 until size && modules[y][x]

  companion object {
    /** The most bytes the lowest level carries (version 40). */
    const val MAX_BYTES = 2953

    private const val MIN_VERSION = 1
    private const val MAX_VERSION = 40

    // Error-correction codewords per block and block counts, by version (index 0 unused), at level L.
    private val ECC_CODEWORDS_PER_BLOCK = intArrayOf(
      -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    )
    private val NUM_ERROR_CORRECTION_BLOCKS = intArrayOf(
      -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
    )

    /** The symbol for [text] as UTF-8 bytes, or null when it is longer than a QR code can carry. */
    fun encode(text: String): QrCode? {
      if (text.isEmpty()) return null
      val bytes = text.encodeToByteArray()
      if (bytes.size > MAX_BYTES) return null
      // The smallest version whose data capacity holds the segment.
      var version = MIN_VERSION
      var bitsUsed = 0
      while (true) {
        val capacityBits = numDataCodewords(version) * 8
        val countBits = if (version <= 9) 8 else 16
        bitsUsed = 4 + countBits + bytes.size * 8
        if (bitsUsed <= capacityBits) break
        if (version >= MAX_VERSION) return null
        version++
      }
      val bits = BitBuffer()
      bits.append(0b0100, 4)
      bits.append(bytes.size, if (version <= 9) 8 else 16)
      for (byte in bytes) bits.append(byte.toInt() and 0xFF, 8)
      val capacityBits = numDataCodewords(version) * 8
      bits.append(0, minOf(4, capacityBits - bits.length))
      bits.append(0, (8 - bits.length % 8) % 8)
      var pad = 0xEC
      while (bits.length < capacityBits) {
        bits.append(pad, 8)
        pad = pad xor (0xEC xor 0x11)
      }
      val data = ByteArray(bits.length / 8)
      for (i in 0 until bits.length) data[i ushr 3] = (data[i ushr 3].toInt() or (bits.bit(i) shl (7 - (i and 7)))).toByte()
      return build(version, addEccAndInterleave(data, version))
    }

    private fun build(version: Int, codewords: ByteArray): QrCode {
      val size = version * 4 + 17
      val modules = Array(size) { BooleanArray(size) }
      val isFunction = Array(size) { BooleanArray(size) }
      drawFunctionPatterns(version, modules, isFunction)
      drawCodewords(codewords, modules, isFunction)
      // The mask with the lowest penalty; the first of equals wins.
      var best = 0
      var bestPenalty = Int.MAX_VALUE
      for (mask in 0 until 8) {
        applyMask(mask, modules, isFunction)
        drawFormatBits(mask, modules, isFunction)
        val penalty = penaltyScore(modules)
        if (penalty < bestPenalty) {
          best = mask
          bestPenalty = penalty
        }
        applyMask(mask, modules, isFunction) // XOR again: undone
      }
      applyMask(best, modules, isFunction)
      drawFormatBits(best, modules, isFunction)
      return QrCode(version, best, modules)
    }

    private class BitBuffer {
      private val bits = ArrayList<Int>()
      val length: Int get() = bits.size
      fun bit(index: Int): Int = bits[index]
      fun append(value: Int, count: Int) {
        for (i in count - 1 downTo 0) bits += (value ushr i) and 1
      }
    }

    private fun numRawDataModules(version: Int): Int {
      var result = (16 * version + 128) * version + 64
      if (version >= 2) {
        val numAlign = version / 7 + 2
        result -= (25 * numAlign - 10) * numAlign - 55
        if (version >= 7) result -= 36
      }
      return result
    }

    private fun numDataCodewords(version: Int): Int =
      numRawDataModules(version) / 8 - ECC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version]

    private fun alignmentPatternPositions(version: Int): IntArray {
      if (version == 1) return IntArray(0)
      val numAlign = version / 7 + 2
      val step = if (version == 32) 26 else (version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2) * 2
      val result = IntArray(numAlign)
      result[0] = 6
      var position = version * 4 + 10
      for (i in numAlign - 1 downTo 1) {
        result[i] = position
        position -= step
      }
      return result
    }

    // ---- Reed-Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1.

    private fun reedSolomonDivisor(degree: Int): IntArray {
      val result = IntArray(degree)
      result[degree - 1] = 1
      var root = 1
      for (i in 0 until degree) {
        for (j in result.indices) {
          result[j] = gfMultiply(result[j], root)
          if (j + 1 < result.size) result[j] = result[j] xor result[j + 1]
        }
        root = gfMultiply(root, 0x02)
      }
      return result
    }

    private fun reedSolomonRemainder(data: ByteArray, from: Int, length: Int, divisor: IntArray): IntArray {
      val result = IntArray(divisor.size)
      for (i in 0 until length) {
        val factor = (data[from + i].toInt() and 0xFF) xor result[0]
        for (j in 0 until result.size - 1) result[j] = result[j + 1]
        result[result.size - 1] = 0
        for (j in result.indices) result[j] = result[j] xor gfMultiply(divisor[j], factor)
      }
      return result
    }

    private fun gfMultiply(x: Int, y: Int): Int {
      var z = 0
      for (i in 7 downTo 0) {
        z = (z shl 1) xor ((z ushr 7) * 0x11D)
        z = z xor (((y ushr i) and 1) * x)
      }
      return z
    }

    private fun addEccAndInterleave(data: ByteArray, version: Int): ByteArray {
      val numBlocks = NUM_ERROR_CORRECTION_BLOCKS[version]
      val blockEccLen = ECC_CODEWORDS_PER_BLOCK[version]
      val rawCodewords = numRawDataModules(version) / 8
      val numShortBlocks = numBlocks - rawCodewords % numBlocks
      val shortBlockLen = rawCodewords / numBlocks
      val divisor = reedSolomonDivisor(blockEccLen)
      val blocks = ArrayList<ByteArray>()
      var k = 0
      for (i in 0 until numBlocks) {
        val dataLen = shortBlockLen - blockEccLen + (if (i < numShortBlocks) 0 else 1)
        val block = ByteArray(shortBlockLen + 1)
        data.copyInto(block, 0, k, k + dataLen)
        val ecc = reedSolomonRemainder(data, k, dataLen, divisor)
        // A short block leaves a gap where a long block's last data byte sits.
        val eccAt = shortBlockLen + 1 - blockEccLen
        for (j in ecc.indices) block[eccAt + j] = ecc[j].toByte()
        blocks += block
        k += dataLen
      }
      val result = ByteArray(rawCodewords)
      var at = 0
      for (i in 0..shortBlockLen) {
        for (j in 0 until numBlocks) {
          if (i != shortBlockLen - blockEccLen || j >= numShortBlocks) result[at++] = blocks[j][i]
        }
      }
      return result
    }

    // ---- Drawing.

    private fun setFunction(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, x: Int, y: Int, dark: Boolean) {
      modules[y][x] = dark
      isFunction[y][x] = true
    }

    private fun drawFunctionPatterns(version: Int, modules: Array<BooleanArray>, isFunction: Array<BooleanArray>) {
      val size = modules.size
      for (i in 0 until size) {
        setFunction(modules, isFunction, 6, i, i % 2 == 0)
        setFunction(modules, isFunction, i, 6, i % 2 == 0)
      }
      drawFinder(modules, isFunction, 3, 3)
      drawFinder(modules, isFunction, size - 4, 3)
      drawFinder(modules, isFunction, 3, size - 4)
      val align = alignmentPatternPositions(version)
      for (i in align.indices) {
        for (j in align.indices) {
          // Not where an alignment pattern would overlap a finder pattern.
          if ((i == 0 && j == 0) || (i == 0 && j == align.size - 1) || (i == align.size - 1 && j == 0)) continue
          drawAlignment(modules, isFunction, align[i], align[j])
        }
      }
      // Reserve the format bits with a mask that is replaced once the real one is chosen.
      drawFormatBits(0, modules, isFunction)
      drawVersion(version, modules, isFunction)
    }

    private fun drawFinder(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, cx: Int, cy: Int) {
      val size = modules.size
      for (dy in -4..4) {
        for (dx in -4..4) {
          val distance = maxOf(kotlin.math.abs(dx), kotlin.math.abs(dy))
          val x = cx + dx
          val y = cy + dy
          if (x in 0 until size && y in 0 until size) setFunction(modules, isFunction, x, y, distance != 2 && distance != 4)
        }
      }
    }

    private fun drawAlignment(modules: Array<BooleanArray>, isFunction: Array<BooleanArray>, cx: Int, cy: Int) {
      for (dy in -2..2) {
        for (dx in -2..2) setFunction(modules, isFunction, cx + dx, cy + dy, maxOf(kotlin.math.abs(dx), kotlin.math.abs(dy)) != 1)
      }
    }

    private fun bit(value: Int, index: Int): Boolean = ((value ushr index) and 1) != 0

    private fun drawFormatBits(mask: Int, modules: Array<BooleanArray>, isFunction: Array<BooleanArray>) {
      val size = modules.size
      // Error-correction level L is 1 in the format field.
      val data = (1 shl 3) or mask
      var remainder = data
      for (i in 0 until 10) remainder = (remainder shl 1) xor ((remainder ushr 9) * 0x537)
      val bits = ((data shl 10) or remainder) xor 0x5412
      for (i in 0..5) setFunction(modules, isFunction, 8, i, bit(bits, i))
      setFunction(modules, isFunction, 8, 7, bit(bits, 6))
      setFunction(modules, isFunction, 8, 8, bit(bits, 7))
      setFunction(modules, isFunction, 7, 8, bit(bits, 8))
      for (i in 9 until 15) setFunction(modules, isFunction, 14 - i, 8, bit(bits, i))
      for (i in 0 until 8) setFunction(modules, isFunction, size - 1 - i, 8, bit(bits, i))
      for (i in 8 until 15) setFunction(modules, isFunction, 8, size - 15 + i, bit(bits, i))
      setFunction(modules, isFunction, 8, size - 8, true) // always dark
    }

    private fun drawVersion(version: Int, modules: Array<BooleanArray>, isFunction: Array<BooleanArray>) {
      if (version < 7) return
      val size = modules.size
      var remainder = version
      for (i in 0 until 12) remainder = (remainder shl 1) xor ((remainder ushr 11) * 0x1F25)
      val bits = (version shl 12) or remainder
      for (i in 0 until 18) {
        val dark = bit(bits, i)
        val a = size - 11 + i % 3
        val b = i / 3
        setFunction(modules, isFunction, a, b, dark)
        setFunction(modules, isFunction, b, a, dark)
      }
    }

    private fun drawCodewords(data: ByteArray, modules: Array<BooleanArray>, isFunction: Array<BooleanArray>) {
      val size = modules.size
      var i = 0
      var right = size - 1
      while (right >= 1) {
        if (right == 6) right = 5
        for (vertical in 0 until size) {
          for (j in 0 until 2) {
            val x = right - j
            val upward = ((right + 1) and 2) == 0
            val y = if (upward) size - 1 - vertical else vertical
            if (!isFunction[y][x] && i < data.size * 8) {
              modules[y][x] = bit(data[i ushr 3].toInt() and 0xFF, 7 - (i and 7))
              i++
            }
          }
        }
        right -= 2
      }
    }

    private fun applyMask(mask: Int, modules: Array<BooleanArray>, isFunction: Array<BooleanArray>) {
      val size = modules.size
      for (y in 0 until size) {
        for (x in 0 until size) {
          val invert = when (mask) {
            0 -> (x + y) % 2 == 0
            1 -> y % 2 == 0
            2 -> x % 3 == 0
            3 -> (x + y) % 3 == 0
            4 -> (x / 3 + y / 2) % 2 == 0
            5 -> x * y % 2 + x * y % 3 == 0
            6 -> (x * y % 2 + x * y % 3) % 2 == 0
            else -> ((x + y) % 2 + x * y % 3) % 2 == 0
          }
          if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x]
        }
      }
    }

    // ---- Penalty (ISO/IEC 18004 section 8.8.2): runs, 2x2 blocks, finder-like runs, dark balance.

    private fun penaltyScore(modules: Array<BooleanArray>): Int {
      val size = modules.size
      var result = 0
      for (y in 0 until size) {
        var runColor = false
        var runLength = 0
        val history = IntArray(7)
        for (x in 0 until size) {
          if (modules[y][x] == runColor) {
            runLength++
            if (runLength == 5) result += 3 else if (runLength > 5) result++
          } else {
            addHistory(runLength, history, size)
            if (!runColor) result += countFinderLike(history) * 40
            runColor = modules[y][x]
            runLength = 1
          }
        }
        result += terminateAndCount(runColor, runLength, history, size) * 40
      }
      for (x in 0 until size) {
        var runColor = false
        var runLength = 0
        val history = IntArray(7)
        for (y in 0 until size) {
          if (modules[y][x] == runColor) {
            runLength++
            if (runLength == 5) result += 3 else if (runLength > 5) result++
          } else {
            addHistory(runLength, history, size)
            if (!runColor) result += countFinderLike(history) * 40
            runColor = modules[y][x]
            runLength = 1
          }
        }
        result += terminateAndCount(runColor, runLength, history, size) * 40
      }
      for (y in 0 until size - 1) {
        for (x in 0 until size - 1) {
          val color = modules[y][x]
          if (color == modules[y][x + 1] && color == modules[y + 1][x] && color == modules[y + 1][x + 1]) result += 3
        }
      }
      var dark = 0
      for (row in modules) for (module in row) if (module) dark++
      val total = size * size
      val k = (kotlin.math.abs(dark * 20 - total * 10) + total - 1) / total - 1
      return result + k * 10
    }

    private fun countFinderLike(history: IntArray): Int {
      val n = history[1]
      val core = n > 0 && history[2] == n && history[3] == n * 3 && history[4] == n && history[5] == n
      return (if (core && history[0] >= n * 4 && history[6] >= n) 1 else 0) +
        (if (core && history[6] >= n * 4 && history[0] >= n) 1 else 0)
    }

    private fun terminateAndCount(runColor: Boolean, runLength: Int, history: IntArray, size: Int): Int {
      var length = runLength
      if (runColor) {
        addHistory(length, history, size)
        length = 0
      }
      length += size // light border
      addHistory(length, history, size)
      return countFinderLike(history)
    }

    private fun addHistory(runLength: Int, history: IntArray, size: Int) {
      var length = runLength
      if (history[0] == 0) length += size // light border
      history.copyInto(history, 1, 0, history.size - 1)
      history[0] = length
    }
  }
}

/** True when [text] fits in a QR code at all, so a caller can say so instead of drawing nothing. */
fun qrCodeFits(text: String): Boolean = QrCode.encode(text) != null

/**
 * A QR code of [text] on a white card with its quiet zone, [size] across. Nothing is drawn when the text is longer
 * than a QR code carries ([qrCodeFits]).
 */
@Composable
fun QrCodeImage(text: String, modifier: Modifier = Modifier, size: Dp = 256.dp, quietModules: Int = 4) {
  val code = remember(text) { QrCode.encode(text) } ?: return
  val total = code.size + quietModules * 2
  Canvas(
    modifier
      .size(size)
      .background(Color.White)
      .semantics { contentDescription = "Payment QR code" },
  ) {
    val module = this.size.width / total
    for (y in 0 until code.size) {
      for (x in 0 until code.size) {
        if (code.isDark(x, y)) {
          drawRect(Color.Black, Offset((x + quietModules) * module, (y + quietModules) * module), Size(module + 0.5f, module + 0.5f))
        }
      }
    }
  }
}
