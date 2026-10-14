package com.aglyn.shell

import com.aglyn.ui.ImageEditPlan
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesktopImageTransformerTest {
  private val red = 0xFFFF0000.toInt()
  private val green = 0xFF00FF00.toInt()
  private val blue = 0xFF0000FF.toInt()
  private val yellow = 0xFFFFFF00.toInt()
  private val white = 0xFFFFFFFF.toInt()

  /** A 4 x 2 picture whose corners are red (top left), green (top right), blue (bottom left) and yellow (bottom right). */
  private fun corners(): ByteArray {
    val image = BufferedImage(4, 2, BufferedImage.TYPE_INT_ARGB)
    for (x in 0 until 4) for (y in 0 until 2) image.setRGB(x, y, white)
    image.setRGB(0, 0, red)
    image.setRGB(3, 0, green)
    image.setRGB(0, 1, blue)
    image.setRGB(3, 1, yellow)
    return ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()
  }

  private fun decode(bytes: ByteArray): BufferedImage = ImageIO.read(ByteArrayInputStream(bytes))

  private fun plan(rotation: Int = 0, flipH: Boolean = false, flipV: Boolean = false, crop: List<Int>, size: Pair<Int, Int>, png: Boolean = true) =
    ImageEditPlan(rotation, flipH, flipV, crop[0], crop[1], crop[2], crop[3], size.first, size.second, png)

  private fun session(bytes: ByteArray = corners()) = assertNotNull(DesktopImageTransformer.open(bytes))

  @Test
  fun aQuarterTurnPutsTheCornersWhereTheConsoleCanvasDoes() {
    val session = session()
    assertEquals(4 to 2, session.width to session.height)
    val image = decode(assertNotNull(session.render(plan(rotation = 90, crop = listOf(0, 0, 2, 4), size = 2 to 4))))
    assertEquals(2 to 4, image.width to image.height)
    // Clockwise: the bottom left becomes the top left, the top left the top right.
    assertEquals(listOf(blue, red, white, white, white, white, yellow, green), (0 until 4).flatMap { y -> (0 until 2).map { x -> image.getRGB(x, y) } })
  }

  @Test
  fun flipsMirrorBeforeTheTurn() {
    val session = session()
    val horizontal = decode(assertNotNull(session.render(plan(flipH = true, crop = listOf(0, 0, 4, 2), size = 4 to 2))))
    assertEquals(listOf(green, red, yellow, blue), listOf(horizontal.getRGB(0, 0), horizontal.getRGB(3, 0), horizontal.getRGB(0, 1), horizontal.getRGB(3, 1)))
    val vertical = decode(assertNotNull(session.render(plan(flipV = true, crop = listOf(0, 0, 4, 2), size = 4 to 2))))
    assertEquals(listOf(blue, yellow, red, green), listOf(vertical.getRGB(0, 0), vertical.getRGB(3, 0), vertical.getRGB(0, 1), vertical.getRGB(3, 1)))
  }

  @Test
  fun aCropIsCutFromTheTurnedPicture() {
    val session = session()
    val image = decode(assertNotNull(session.render(plan(crop = listOf(2, 0, 2, 2), size = 2 to 2))))
    assertEquals(listOf(white, green, white, yellow), listOf(image.getRGB(0, 0), image.getRGB(1, 0), image.getRGB(0, 1), image.getRGB(1, 1)))
  }

  @Test
  fun aSmallerSizeDrawsTheWholeCrop() {
    val big = BufferedImage(40, 20, BufferedImage.TYPE_INT_ARGB)
    for (x in 0 until 40) for (y in 0 until 20) big.setRGB(x, y, if (x < 20) red else blue)
    val bytes = ByteArrayOutputStream().also { ImageIO.write(big, "png", it) }.toByteArray()
    val image = decode(assertNotNull(session(bytes).render(plan(crop = listOf(0, 0, 40, 20), size = 8 to 4))))
    assertEquals(8 to 4, image.width to image.height)
    assertEquals(red, image.getRGB(1, 2))
    assertEquals(blue, image.getRGB(6, 2))
  }

  @Test
  fun aJpegIsWrittenWithNoTransparency() {
    val bytes = assertNotNull(session().render(plan(crop = listOf(0, 0, 4, 2), size = 4 to 2, png = false)))
    // JPEG's start marker.
    assertEquals(listOf(0xFF, 0xD8), bytes.take(2).map { it.toInt() and 0xFF })
    assertNotNull(decode(bytes))
  }

  /** Splices an EXIF block that records [orientation] in after a JPEG's start marker. */
  private fun withOrientation(jpeg: ByteArray, orientation: Int): ByteArray {
    val tiff = listOf(0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0)
    val exif = "Exif".encodeToByteArray().map { it.toInt() } + listOf(0, 0) + tiff
    val segment = listOf(0xFF, 0xE1, (exif.size + 2) shr 8, (exif.size + 2) and 0xFF) + exif
    return jpeg.copyOfRange(0, 2) + segment.map { it.toByte() }.toByteArray() + jpeg.copyOfRange(2, jpeg.size)
  }

  @Test
  fun aPhotoSavedSidewaysIsOpenedUpright() {
    // 16 x 8 stored, left half red and right half blue; orientation 6 means "turn 90 degrees clockwise to view".
    val stored = BufferedImage(16, 8, BufferedImage.TYPE_INT_RGB)
    for (x in 0 until 16) for (y in 0 until 8) stored.setRGB(x, y, if (x < 8) red else blue)
    val jpeg = ByteArrayOutputStream().also { ImageIO.write(stored, "jpg", it) }.toByteArray()
    val session = session(withOrientation(jpeg, 6))
    assertEquals(8 to 16, session.width to session.height)
    val image = decode(assertNotNull(session.render(plan(crop = listOf(0, 0, 8, 16), size = 8 to 16))))
    fun near(actual: Int, expected: Int) = (0..2).all { channel -> abs(((actual shr (channel * 8)) and 0xFF) - ((expected shr (channel * 8)) and 0xFF)) < 40 }
    assertTrue(near(image.getRGB(4, 2), red), "top is red")
    assertTrue(near(image.getRGB(4, 13), blue), "bottom is blue")
    // Without the EXIF block the same bytes open as stored.
    assertEquals(16 to 8, session(jpeg).let { it.width to it.height })
  }

  @Test
  fun somethingThatIsNotAnImageOpensAsNothing() {
    assertNull(DesktopImageTransformer.open(byteArrayOf(1, 2, 3, 4)))
  }
}
