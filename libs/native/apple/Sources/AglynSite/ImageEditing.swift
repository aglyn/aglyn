// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/*
 * The media library's image editor, the native side of the console's: rotate,
 * flip, a crop and a max width, drawn with Core Graphics. Every number is the
 * console's own arithmetic (AglynContracts/ImageEdit.swift); this file holds
 * the pixels and the state the screen edits. The Kotlin apps' ImageTransformer
 * and ImageEditSettings.
 */

/// What the editor writes, in the order the console's editor applies it to a
/// picture standing upright: mirror (`flipH`, `flipV`), turn clockwise by
/// `rotation` degrees (0, 90, 180 or 270), cut `cropW` by `cropH` from
/// (`cropX`, `cropY`) of the turned picture, and draw that at `width` by
/// `height`. PNG stays lossless; anything else is a JPEG.
public struct ImageEditPlan: Equatable, Sendable {
  public var rotation: Int
  public var flipH: Bool
  public var flipV: Bool
  public var cropX: Int
  public var cropY: Int
  public var cropW: Int
  public var cropH: Int
  public var width: Int
  public var height: Int
  public var png: Bool
}

/// A picture opened for editing: decoded and stood upright once (a photo's
/// EXIF turn applied, as the browser does before drawing), drawn at as many
/// plans as the screen asks.
public final class ImageEditSession: @unchecked Sendable {
  public let width: Int
  public let height: Int
  private let image: CGImage

  private init(image: CGImage) {
    self.image = image
    width = image.width
    height = image.height
  }

  /// Decodes `data`, or nil for a format the device cannot read.
  public static func open(_ data: Data) -> ImageEditSession? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else { return nil }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let side = max(properties?[kCGImagePropertyPixelWidth] as? Int ?? 0, properties?[kCGImagePropertyPixelHeight] as? Int ?? 0)
    if side > 0 {
      // The full-size "thumbnail" with the transform on is the upright picture.
      let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: side,
        kCGImageSourceShouldCacheImmediately: true,
      ]
      if let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) { return ImageEditSession(image: upright) }
    }
    return CGImageSourceCreateImageAtIndex(source, 0, nil).map(ImageEditSession.init(image:))
  }

  /// The picture drawn as `plan` says, as pixels.
  public func draw(_ plan: ImageEditPlan) -> CGImage? {
    guard plan.width > 0, plan.height > 0 else { return nil }
    let (workedW, workedH) = imageEditWorkedSize(width: width, height: height, rotation: plan.rotation)
    let cropX = min(max(plan.cropX, 0), workedW - 1)
    let cropY = min(max(plan.cropY, 0), workedH - 1)
    let cropW = min(max(plan.cropW, 1), workedW - cropX)
    let cropH = min(max(plan.cropH, 1), workedH - cropY)
    // A JPEG has no transparency; the console's canvas leaves it black.
    let alpha: CGImageAlphaInfo = plan.png ? .premultipliedLast : .noneSkipLast
    guard
      let context = CGContext(
        data: nil, width: plan.width, height: plan.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(), bitmapInfo: alpha.rawValue)
    else { return nil }
    context.interpolationQuality = .high
    if !plan.png {
      context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
      context.fill(CGRect(x: 0, y: 0, width: plan.width, height: plan.height))
    }
    // Work from the top left, down and to the right, as the console's canvas does.
    context.translateBy(x: 0, y: CGFloat(plan.height))
    context.scaleBy(x: 1, y: -1)
    // Scale to the output, cut, place the picture on its centre, turn, mirror: the console's order.
    context.scaleBy(x: CGFloat(plan.width) / CGFloat(cropW), y: CGFloat(plan.height) / CGFloat(cropH))
    context.translateBy(x: -CGFloat(cropX), y: -CGFloat(cropY))
    context.translateBy(x: CGFloat(workedW) / 2, y: CGFloat(workedH) / 2)
    context.rotate(by: CGFloat(plan.rotation) * .pi / 180)
    context.scaleBy(x: plan.flipH ? -1 : 1, y: plan.flipV ? -1 : 1)
    context.translateBy(x: -CGFloat(width) / 2, y: -CGFloat(height) / 2)
    // Core Graphics draws an image upside down in a space that runs downward; turn it back over.
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }

  /// The picture drawn as `plan` says, encoded as a PNG or a JPEG at the console's quality.
  public func render(_ plan: ImageEditPlan) -> Data? {
    guard let drawn = draw(plan) else { return nil }
    let output = NSMutableData()
    let type = plan.png ? UTType.png : UTType.jpeg
    guard let destination = CGImageDestinationCreateWithData(output, type.identifier as CFString, 1, nil) else { return nil }
    let properties: [CFString: Any] = plan.png ? [:] : [kCGImageDestinationLossyCompressionQuality: ContractValues.shared.imageEditJpegQuality]
    CGImageDestinationAddImage(destination, drawn, properties as CFDictionary)
    return CGImageDestinationFinalize(destination) ? output as Data : nil
  }
}

/// What a person has asked of the image editor so far: the console's editor state (rotation, flips, a ratio-locked
/// crop in preview pixels, a max width), and the plans it turns into.
public struct ImageEditSettings: Equatable, Sendable {
  public var rotation = 0
  public var flipH = false
  public var flipV = false
  /// The crop's width over its height, or nil for a free crop.
  public var aspect: Double?
  /// The crop, in preview pixels; nil keeps the whole picture.
  public var crop: ImageEditRect?
  /// The widest the result may be, as typed; blank keeps the size.
  public var maxWidth = ""

  public init() {}

  /// A quarter turn; the crop was drawn on the old turn, so it goes.
  public mutating func turn(clockwise: Bool) {
    rotation = (rotation + (clockwise ? 90 : 270)) % 360
    crop = nil
  }

  /// A new ratio starts the crop over, as the console's editor does.
  public mutating func setAspect(_ ratio: Double?) {
    aspect = ratio
    crop = nil
  }

  public mutating func setMaxWidth(_ text: String) { maxWidth = String(text.filter(\.isNumber).prefix(5)) }

  /// The picture's size once it is turned.
  public func worked(sourceWidth: Int, sourceHeight: Int) -> (width: Int, height: Int) {
    imageEditWorkedSize(width: sourceWidth, height: sourceHeight, rotation: rotation)
  }

  /// How far the preview is shrunk so its longest side fits.
  public func scale(sourceWidth: Int, sourceHeight: Int) -> Double {
    let size = worked(sourceWidth: sourceWidth, sourceHeight: sourceHeight)
    return imageEditPreviewScale(workedWidth: Double(size.width), workedHeight: Double(size.height))
  }

  /// The preview's size in pixels.
  public func previewSize(sourceWidth: Int, sourceHeight: Int) -> (width: Int, height: Int) {
    let size = worked(sourceWidth: sourceWidth, sourceHeight: sourceHeight)
    let scale = scale(sourceWidth: sourceWidth, sourceHeight: sourceHeight)
    return (Int((Double(size.width) * scale + 0.5).rounded(.down)), Int((Double(size.height) * scale + 0.5).rounded(.down)))
  }

  /// The crop a drag from `start` to `now` draws, in preview pixels, with the pointer held inside the preview.
  public mutating func drag(
    from start: (x: Double, y: Double), to now: (x: Double, y: Double), previewWidth: Int, previewHeight: Int
  ) {
    func clamp(_ value: Double, _ limit: Int) -> Double { min(max(value, 0), Double(limit)) }
    crop = imageEditCropFromDrag(
      startX: clamp(start.x, previewWidth), startY: clamp(start.y, previewHeight), nowX: clamp(now.x, previewWidth),
      nowY: clamp(now.y, previewHeight), aspect: aspect, previewWidth: Double(previewWidth), previewHeight: Double(previewHeight))
  }

  /// The turned picture at preview size, with no cut: what the screen shows under the crop.
  public func previewPlan(sourceWidth: Int, sourceHeight: Int) -> ImageEditPlan {
    let size = worked(sourceWidth: sourceWidth, sourceHeight: sourceHeight)
    let preview = previewSize(sourceWidth: sourceWidth, sourceHeight: sourceHeight)
    return ImageEditPlan(
      rotation: rotation, flipH: flipH, flipV: flipV, cropX: 0, cropY: 0, cropW: size.width, cropH: size.height,
      width: max(1, preview.width), height: max(1, preview.height), png: true)
  }

  /// The file to save: the crop and size the console's editor would write, in the type it would pick.
  public func savePlan(sourceWidth: Int, sourceHeight: Int, fileName: String) -> ImageEditPlan {
    let size = worked(sourceWidth: sourceWidth, sourceHeight: sourceHeight)
    let out = imageEditOutput(
      workedWidth: size.width, workedHeight: size.height, crop: crop, scale: scale(sourceWidth: sourceWidth, sourceHeight: sourceHeight),
      maxWidth: Double(maxWidth) ?? 0)
    return ImageEditPlan(
      rotation: rotation, flipH: flipH, flipV: flipV, cropX: out.cropX, cropY: out.cropY, cropW: out.cropW, cropH: out.cropH,
      width: out.width, height: out.height, png: imageEditContentType(fileName) == "image/png")
  }

  /// Whether anything is asked for.
  public var changed: Bool { rotation != 0 || flipH || flipV || crop != nil || !maxWidth.isEmpty }
}
