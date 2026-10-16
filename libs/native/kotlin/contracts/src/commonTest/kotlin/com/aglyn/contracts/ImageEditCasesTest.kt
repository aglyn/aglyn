package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the image editor's cases in function-cases.generated.json: the TypeScript's own answers. */
class ImageEditCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertTrue(list.isNotEmpty(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun number(element: JsonElement?): Double = (element as JsonPrimitive).doubleOrNull!!

  private fun rect(element: JsonElement?): ImageEditRect? =
    if (element == null || element is JsonNull) null else element.jsonObject.let { ImageEditRect(number(it["x"]), number(it["y"]), number(it["w"]), number(it["h"])) }

  @Test
  fun theSizeAndScaleFollowTheTurn() {
    for ((args, result) in cases("imageEditWorkedSize")) {
      val size = imageEditWorkedSize(number(args[0]).toInt(), number(args[1]).toInt(), number(args[2]).toInt())
      assertEquals(number(result.jsonObject["w"]).toInt() to number(result.jsonObject["h"]).toInt(), size, args.toString())
    }
    for ((args, result) in cases("imageEditPreviewScale")) assertEquals(number(result), imageEditPreviewScale(number(args[0]), number(args[1])), args.toString())
  }

  @Test
  fun aDragDrawsTheSameCropTheConsoleDoes() {
    for ((args, result) in cases("imageEditCropFromDrag")) {
      val start = args[0].jsonObject
      val now = args[1].jsonObject
      val aspect = if (args[2] is JsonNull) null else number(args[2])
      val crop = imageEditCropFromDrag(number(start["x"]), number(start["y"]), number(now["x"]), number(now["y"]), aspect, number(args[3]), number(args[4]))
      assertEquals(rect(result), crop, args.toString())
    }
  }

  @Test
  fun anEditCutsAndSizesAsTheConsoleDoes() {
    for ((args, result) in cases("imageEditOutput")) {
      val worked = args[0].jsonObject
      val out = imageEditOutput(number(worked["w"]).toInt(), number(worked["h"]).toInt(), rect(args[1]), number(args[2]), number(args[3]))
      val crop = result.jsonObject.getValue("crop").jsonObject
      assertEquals(
        listOf(number(crop["x"]), number(crop["y"]), number(crop["w"]), number(crop["h"]), number(result.jsonObject["width"]), number(result.jsonObject["height"])).map { it.toInt() },
        listOf(out.cropX, out.cropY, out.cropW, out.cropH, out.width, out.height),
        args.toString(),
      )
    }
  }

  @Test
  fun theCopyIsNamedAndTypedAsTheConsoleDoes() {
    for ((args, result) in cases("imageEditCopyName")) assertEquals(result.jsonPrimitive.content, imageEditCopyName(args[0].jsonPrimitive.content), args.toString())
    for ((args, result) in cases("imageEditContentType")) assertEquals(result.jsonPrimitive.content, imageEditContentType(args[0].jsonPrimitive.content), args.toString())
  }

  @Test
  fun theOriginalIsAskedForWithDownload() {
    for ((args, result) in cases("mediaOriginalSrc")) assertEquals(result.jsonPrimitive.content, mediaOriginalSrc(args[0].jsonPrimitive.content), args.toString())
  }

  @Test
  fun theAspectsAreTheConsoles() {
    assertEquals(listOf("Free", "1:1", "4:3", "3:2", "16:9"), imageEditAspects.map { it.label })
    assertEquals(listOf(null, 1.0, 4.0 / 3, 1.5, 16.0 / 9), imageEditAspects.map { it.ratio })
    assertEquals(480L, Contracts.imageEditPreviewMax)
  }

  /** A JPEG that is only its EXIF block and an end marker, with the orientation tag set. */
  private fun jpegWithOrientation(orientation: Int, little: Boolean): ByteArray {
    fun u16(value: Int) = if (little) listOf(value and 0xFF, value shr 8) else listOf(value shr 8, value and 0xFF)
    fun u32(value: Int) = if (little) listOf(value and 0xFF, 0, 0, 0) else listOf(0, 0, 0, value and 0xFF)
    val tiff = (if (little) listOf(0x49, 0x49) else listOf(0x4D, 0x4D)) + u16(42) + u32(8) +
      u16(1) + u16(0x0112) + u16(3) + u32(1) + u16(orientation) + listOf(0, 0) + u32(0)
    val exif = "Exif".encodeToByteArray().map { it.toInt() } + listOf(0, 0) + tiff
    val segment = listOf(0xFF, 0xE1) + u16BigEndian(exif.size + 2) + exif
    return (listOf(0xFF, 0xD8) + segment + listOf(0xFF, 0xD9)).map { it.toByte() }.toByteArray()
  }

  private fun u16BigEndian(value: Int) = listOf(value shr 8, value and 0xFF)

  @Test
  fun aPhotoSavedSidewaysIsStoodUpright() {
    for (orientation in 1..8) {
      assertEquals(orientation, jpegExifOrientation(jpegWithOrientation(orientation, little = true)), "little $orientation")
      assertEquals(orientation, jpegExifOrientation(jpegWithOrientation(orientation, little = false)), "big $orientation")
    }
    assertEquals(1, jpegExifOrientation(jpegWithOrientation(9, little = true)))
    assertEquals(1, jpegExifOrientation(byteArrayOf(1, 2, 3)))
    assertEquals(1, jpegExifOrientation(ByteArray(0)))
    // No EXIF block, or one cut short, is upright.
    assertEquals(1, jpegExifOrientation(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())))
    assertEquals(1, jpegExifOrientation(jpegWithOrientation(6, little = true).copyOf(20)))
    // The turns, in the editor's order (mirror, then rotate).
    assertEquals(listOf(0 to false, 0 to true, 180 to false, 180 to true, 270 to true, 90 to false, 90 to true, 270 to false), (1..8).map(::exifTurn))
    assertEquals(0 to false, exifTurn(0))
    assertEquals(0 to false, exifTurn(9))
  }
}
