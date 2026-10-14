// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The arithmetic of the media library's image editor, ported once from
 * libs/aglyn/src/lib/app-utils/image-edit.ts: the quarter-turn size, the crop a
 * drag draws, where an edit cuts and how big it comes out, the copy's name and
 * type. The pixels are Core Graphics' (AglynSite); ImageEditTests replays the
 * TypeScript's own answers, so a crop that lands on one pixel in the browser
 * lands on the same pixel in the app. The Kotlin contracts' ImageEdit.kt.
 */

/// A rectangle in whatever pixels the caller measures in.
public struct ImageEditRect: Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var w: Double
  public var h: Double

  public init(x: Double, y: Double, w: Double, h: Double) {
    self.x = x
    self.y = y
    self.w = w
    self.h = h
  }
}

/// A crop ratio the editor offers; a nil `ratio` is a free crop.
public struct ImageEditAspect: Equatable, Sendable {
  public let label: String
  public let ratio: Double?
}

/// What an edit writes: the crop in the turned image's own pixels, and the size it is drawn at.
public struct ImageEditOutput: Equatable, Sendable {
  public let cropX: Int
  public let cropY: Int
  public let cropW: Int
  public let cropH: Int
  public let width: Int
  public let height: Int
}

/// The crop ratios, as the console lists them.
public let imageEditAspects: [ImageEditAspect] = {
  let list = (try? JSONSerialization.jsonObject(with: Data(ContractValues.shared.imageEditAspectsJson.utf8))) as? [[String: Any]] ?? []
  return list.compactMap { entry in
    guard let label = entry["label"] as? String else { return nil }
    return ImageEditAspect(label: label, ratio: entry["ratio"] as? Double)
  }
}()

/// `Math.round`: halves go up, which `rounded()` (away from zero) only does for positive numbers.
private func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

/// The image's size once it is turned: a quarter turn swaps the sides.
public func imageEditWorkedSize(width: Int, height: Int, rotation: Int) -> (width: Int, height: Int) {
  rotation == 90 || rotation == 270 ? (height, width) : (width, height)
}

/// How far the preview is shrunk so its longest side fits; never enlarged.
public func imageEditPreviewScale(workedWidth: Double, workedHeight: Double) -> Double {
  if workedWidth == 0 || workedHeight == 0 { return 1 }
  return min(1, Double(ContractValues.shared.imageEditPreviewMax) / max(workedWidth, workedHeight))
}

/// The crop a drag draws, from where it started to where the pointer is, kept inside the preview.
/// A locked ratio is width-led; a free crop uses the dragged height.
public func imageEditCropFromDrag(
  startX: Double, startY: Double, nowX: Double, nowY: Double, aspect: Double?, previewWidth: Double, previewHeight: Double
) -> ImageEditRect {
  let w = abs(nowX - startX)
  let h = aspect.map { $0 != 0 ? w / $0 : abs(nowY - startY) } ?? abs(nowY - startY)
  let x = min(startX, nowX)
  let y = min(startY, nowY)
  return ImageEditRect(x: x, y: y, w: min(w, previewWidth - x), h: min(h, previewHeight - y))
}

/// Where an edit cuts and how big it comes out. `crop` is in preview pixels (nil keeps the whole turned image) and
/// `scale` is the preview's `imageEditPreviewScale`; `maxWidth` shrinks the result to at most that wide (0, nothing,
/// or a width at or above the crop's keeps the size). A crop under a pixel each way is taken as no crop.
public func imageEditOutput(workedWidth: Int, workedHeight: Int, crop: ImageEditRect?, scale: Double, maxWidth: Double) -> ImageEditOutput {
  let inv = scale != 0 ? 1 / scale : 1
  var (x, y, w, h) = (0.0, 0.0, Double(workedWidth), Double(workedHeight))
  if let crop {
    let drawnW = jsRound(crop.w * inv)
    let drawnH = jsRound(crop.h * inv)
    if drawnW >= 1 && drawnH >= 1 {
      x = jsRound(crop.x * inv)
      y = jsRound(crop.y * inv)
      w = drawnW
      h = drawnH
    }
  }
  let targetW = maxWidth.isFinite && maxWidth > 0 && maxWidth < w ? maxWidth : w
  let targetH = w > 0 ? jsRound(h * targetW / w) : h
  return ImageEditOutput(
    cropX: Int(x), cropY: Int(y), cropW: Int(w), cropH: Int(h), width: Int(max(1, targetW)), height: Int(max(1, targetH)))
}

/// The name "Save as copy" gives the new file: `photo.png` becomes `photo (edited).png`.
public func imageEditCopyName(_ fileName: String) -> String {
  // The extension is a dot and at least one character after it; a trailing dot has none.
  guard let dot = fileName.lastIndex(of: "."), fileName.index(after: dot) < fileName.endIndex else { return fileName + " (edited)" }
  return String(fileName[..<dot]) + " (edited)" + String(fileName[dot...])
}

/// PNG stays PNG, so a logo keeps its edges; anything else is saved as JPEG.
public func imageEditContentType(_ fileName: String) -> String {
  fileName.lowercased().hasSuffix(".png") ? "image/png" : "image/jpeg"
}
