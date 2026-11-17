// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// A PHOTO OF A PAGE (`kind: "photo"`), as the console's paper waiver takes one (AGL-4042, `shrinkPhoto`): taken with the
/// camera or picked from the photos, stood upright and shrunk to a JPEG (quality 0.85) no wider or taller than `maxEdge`
/// pixels (1600), never made larger. The value is the picture as a `data:image/jpeg;base64,` address, the shape
/// `waivers/paper` takes.
public enum PagePhoto {
  public static let maxEdge = 1600
  public static let quality = 0.85

  /// The longer side a picture `width` by `height` is drawn at: the console's `Math.round` of it scaled to `maxEdge`.
  public static func longerSide(width: Int, height: Int, maxEdge: Int = maxEdge) -> Int {
    let longer = Swift.max(1, Swift.max(width, height))
    let scale = Swift.min(1, Double(maxEdge) / Double(longer))
    return Swift.max(1, Int((Double(longer) * scale + 0.5).rounded(.down)))
  }

  /// The picture in `data`, upright and shrunk, as a JPEG `data:` address; nil when it is not a picture.
  public static func dataURL(_ data: Data, maxEdge: Int = maxEdge) -> String? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    else { return nil }
    let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0
    let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: longerSide(width: width, height: height, maxEdge: maxEdge),
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let out = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return "data:image/jpeg;base64," + (out as Data).base64EncodedString()
  }

  /// The picture a `data:` address holds, for the preview.
  static func image(_ dataURL: String) -> CGImage? {
    guard dataURL.hasPrefix("data:image/"), let comma = dataURL.range(of: ";base64,"),
      let data = Data(base64Encoded: String(dataURL[comma.upperBound...])),
      let source = CGImageSourceCreateWithData(data as CFData, nil)
    else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }
}

/// The button a `photo` field draws (its label, then `retakeLabel` once a photo is held), the sources the device offers
/// for a photo (the camera where there is one, and the photo library), and the photo under it.
struct PhotoFieldView: View {
  let field: FieldSpec
  let label: String
  @Binding var value: FieldValue
  @State private var picking: PickSource?
  @State private var error: String?
  /// The photo held, decoded once for the preview (not on every redraw of the form).
  @State private var preview: (source: String, image: CGImage?)?

  private var held: String {
    if case .text(let text) = value { return text }
    return ""
  }

  private var sources: [PickSource] {
    let offered = PickSource.available
    let photos = offered.filter { $0 != .files }
    return photos.isEmpty ? offered : photos
  }

  var body: some View {
    let title = held.isEmpty ? label : (field.config?["retakeLabel"]?.stringValue ?? label)
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Group {
        if sources.count == 1, let only = sources.first {
          Button { picking = only } label: { Text(title).frame(maxWidth: .infinity) }
        } else {
          Menu {
            ForEach(sources) { source in
              Button { picking = source } label: { Label(source.label, systemImage: source.systemImage) }
            }
          } label: {
            Text(title).frame(maxWidth: .infinity)
          }
        }
      }
      .buttonStyle(.bordered)
      .accessibilityIdentifier("photo-\(field.key)")
      if let image = preview.flatMap({ $0.source == held ? $0.image : nil }) {
        Image(decorative: image, scale: 1)
          .resizable()
          .scaledToFit()
          .frame(maxHeight: 360)
          .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
          .accessibilityLabel(field.config?["alt"]?.stringValue ?? label)
      }
      if let error {
        Text(error).font(AglynFont.caption).foregroundStyle(AglynColor.error)
      }
    }
    .task(id: held) { preview = (held, PagePhoto.image(held)) }
    .aglynMediaPicker($picking, multiple: false) { files in
      guard let file = files.first else { return }
      let edge = field.config?["maxEdge"]?.numberValue.map { Int($0) } ?? PagePhoto.maxEdge
      if let shrunk = PagePhoto.dataURL(file.data, maxEdge: edge) {
        error = nil
        value = .text(shrunk)
      } else {
        error = "That file is not a photo."
      }
    }
  }
}
