// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

#if os(iOS)
  import UIKit
#endif

/// A remote image (a media thumbnail, a site's icon). While it loads, and
/// when it cannot (no URL, offline, not an image), `systemImage` sits on a
/// muted ground in its place.
public struct AglynRemoteImage: View {
  let url: URL?
  let systemImage: String
  let contentMode: ContentMode
  let label: String?

  public init(_ url: URL?, systemImage: String = "photo", contentMode: ContentMode = .fill, label: String? = nil) {
    self.url = url
    self.systemImage = systemImage
    self.contentMode = contentMode
    self.label = label
  }

  private var placeholder: some View {
    ZStack {
      AglynColor.primary.opacity(0.08)
      Image(systemName: systemImage)
        .font(.system(size: 28, weight: .regular))
        .foregroundStyle(AglynColor.tint.opacity(0.7))
    }
  }

  public var body: some View {
    Group {
      if let url {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
          if let image = phase.image {
            image.resizable().aspectRatio(contentMode: contentMode)
          } else {
            placeholder
          }
        }
      } else {
        placeholder
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label ?? "")
    .accessibilityHidden(label == nil)
  }
}

/// A brand picture in a small square: a workspace's logo or a site's favicon, its dark-appearance art in dark mode
/// when there is one, and `fallback` (the kit's symbol) while there is none, while it loads, or when it fails.
///
/// What is drawn is the art's ink, not its canvas: a logo uploaded off-center or with empty room round it is centered
/// by its ink and sized by it (AGL-4027). Opaque art (a photo, a solid tile) fills the square and loses its corners to
/// `cornerRadius`, which costs nothing. A badge that already fits the shape (a round seal) is drawn edge to edge. Any
/// other art on a transparent ground (a logo mark) is drawn whole: fitted, and shrunk only as far as the shape needs
/// for every visible pixel to clear its edges (`AglynBrandArt.scale`). The picture is decoded at the pixels it is
/// drawn at, so it is never minified on screen.
public struct AglynBrandPicture<Fallback: View>: View {
  @Environment(\.colorScheme) private var scheme
  let url: URL?
  let darkURL: URL?
  let size: CGFloat
  let cornerRadius: CGFloat
  let fallback: Fallback

  public init(
    _ url: URL?, darkURL: URL? = nil, size: CGFloat, cornerRadius: CGFloat,
    @ViewBuilder fallback: () -> Fallback
  ) {
    self.url = url
    self.darkURL = darkURL
    self.size = size
    self.cornerRadius = cornerRadius
    self.fallback = fallback()
  }

  public var body: some View {
    if let shown = (scheme == .dark ? darkURL : nil) ?? url {
      AglynBrandLoaded(url: shown, fit: .badge(side: size, cornerRadius: cornerRadius)) { picture, layout in
        AglynBrandDrawn(picture: picture, layout: layout, side: size, cornerRadius: cornerRadius)
      } fallback: {
        fallback
      }
      .frame(width: size, height: size)
      .accessibilityHidden(true)
    } else {
      fallback
    }
  }
}

/// A loaded brand picture in its box, as its layout says: covering the box or whole inside it, clipped to the box's
/// shape either way.
struct AglynBrandDrawn: View {
  @Environment(\.displayScale) private var displayScale
  let picture: AglynBrandImage
  let layout: AglynBrandLayout
  let side: CGFloat
  let cornerRadius: CGFloat

  var body: some View {
    // Decoded at the pixels it is drawn at (`AglynBrandImageLoader`), so this draws it about one to one; high
    // interpolation is the backstop for the rounding between the two.
    let image = Image(decorative: picture.image, scale: max(displayScale, 1)).resizable().interpolation(.high)
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    switch layout.kind {
    case .fill:
      image.scaledToFill()
        .frame(width: side, height: side)
        .clipShape(shape)
    case .whole:
      image.scaledToFit()
        .frame(width: layout.inkSide, height: layout.inkSide)
        .frame(width: side, height: side)
        .clipShape(shape)
    }
  }
}

/// How a brand picture is placed: the box it is drawn in, which decides how its art is laid out and the pixels it is
/// decoded at.
enum AglynBrandFit: Hashable, Sendable {
  /// A picture in a rounded square of `side` points (`AglynBrandPicture`).
  case badge(side: CGFloat, cornerRadius: CGFloat)
  /// A workspace's tile of `side` points (`AglynWorkspaceTile`), with its logo slot of `slot` points on the plate.
  case tile(side: CGFloat, cornerRadius: CGFloat, slot: CGFloat)

  var side: CGFloat {
    switch self {
    case .badge(let side, _), .tile(let side, _, _): side
    }
  }

  /// Where `art` goes in this box.
  func layout(_ art: AglynBrandArt) -> AglynBrandLayout {
    switch self {
    case .badge(let side, let cornerRadius):
      let corner = side > 0 ? cornerRadius / side : 0.5
      if art.opaqueCorners { return AglynBrandLayout(kind: .fill, inkSide: side * art.fillFactor, plate: false) }
      if let badge = art.badgeScale(cornerFraction: corner) {
        return AglynBrandLayout(kind: .whole, inkSide: side * badge, plate: false)
      }
      return AglynBrandLayout(kind: .whole, inkSide: side * art.scale(cornerFraction: corner), plate: false)
    case .tile(let side, let cornerRadius, let slot):
      let corner = side > 0 ? cornerRadius / side : 0.5
      // Figma Rail/Workspace tile, Type=Picture: a picture covers the whole tile.
      if art.opaqueCorners { return AglynBrandLayout(kind: .fill, inkSide: side * art.fillFactor, plate: false) }
      // A badge already has its own edge, so it takes the whole tile too, with nothing under it.
      if let badge = art.badgeScale(cornerFraction: corner) {
        return AglynBrandLayout(kind: .whole, inkSide: side * badge, plate: false)
      }
      // Type=Logo: a mark sits on the paper plate, its ink fitted whole in the slot. The slot keeps it clear of the
      // plate's corners, so it is not shrunk again.
      return AglynBrandLayout(kind: .whole, inkSide: slot, plate: true)
    }
  }
}

/// Where a brand picture's art goes in its box.
struct AglynBrandLayout: Equatable, Sendable {
  enum Kind: Equatable, Sendable {
    /// Covers the box; the box's shape crops it.
    case fill
    /// Fitted whole inside the box.
    case whole
  }

  let kind: Kind
  /// The longer side of the art's ink as drawn, in points.
  let inkSide: CGFloat
  /// Whether the workspace tile's paper plate and border are drawn under it.
  let plate: Bool
}

/// Loads the brand picture at `url` for `fit` and draws it with `content`; `fallback` while it loads or when it fails.
struct AglynBrandLoaded<Content: View, Fallback: View>: View {
  @Environment(\.displayScale) private var displayScale
  @State private var loaded: (key: String, picture: AglynBrandImage)?
  let url: URL
  let fit: AglynBrandFit
  let content: (AglynBrandImage, AglynBrandLayout) -> Content
  let fallback: Fallback

  init(
    url: URL, fit: AglynBrandFit, @ViewBuilder content: @escaping (AglynBrandImage, AglynBrandLayout) -> Content,
    @ViewBuilder fallback: () -> Fallback
  ) {
    self.url = url
    self.fit = fit
    self.content = content
    self.fallback = fallback()
  }

  var body: some View {
    let request = AglynBrandRequest(url: url, fit: fit, scale: max(displayScale, 1))
    // A picture already decoded draws on the first frame, so a row scrolled back into view does not flash its
    // fallback.
    let picture = loaded?.key == request.key ? loaded?.picture : AglynBrandImageLoader.cached(request)
    Group {
      if let picture {
        content(picture, fit.layout(picture.art))
      } else {
        fallback
      }
    }
    .task(id: request.key) {
      guard AglynBrandImageLoader.cached(request) == nil,
            let picture = await AglynBrandImageLoader.loadRetrying(request.url, load: { _ in
              await AglynBrandImageLoader.load(request)
            }) else { return }
      loaded = (request.key, picture)
    }
  }
}

/// Where a brand picture's art has ink. `bounds` is the box round the ink, and everything else is measured in it:
/// `ink` holds, for each row of pixels that has any, the outer corner of its outermost visible pixel on each side,
/// measured from the box's center in units of its longer side. The badge's shape is convex and symmetric, so those are
/// the only points that can cross its edge.
public struct AglynBrandArt: Equatable, Sendable {
  /// The room a brand mark keeps from its badge's edge, as a fraction of the badge's side.
  public static let margin: CGFloat = 0.06
  /// How nearly whole art must fit a shape with no room round it to count as a badge in its own right (a round or
  /// rounded seal, which brings its own edge) rather than a mark that wants room round it.
  public static let badgeFit: CGFloat = 0.95
  /// Pixels at or below this opacity are ground, not art: anti-aliasing haze, not a visible edge.
  static let inkAlpha: CGFloat = 0.06
  /// The longest side a picture is read at: enough to place its ink box within a pixel of the badges' sizes.
  static let readSide = 256

  public let ink: [CGPoint]
  /// Whether all four corners of the ink's box are opaque: a photo or a solid tile rather than a mark on a clear
  /// ground.
  public let opaqueCorners: Bool
  /// The ink's box in the picture, in fractions of its width and height, from its top left: what is drawn.
  public let bounds: CGRect
  /// The ink box's longer side as a fraction of the picture's longer side.
  public let inkSide: CGFloat
  /// The ink box's width over its height.
  public let aspect: CGFloat

  public init(
    ink: [CGPoint], opaqueCorners: Bool, bounds: CGRect = CGRect(x: 0, y: 0, width: 1, height: 1), inkSide: CGFloat = 1,
    aspect: CGFloat = 1
  ) {
    self.ink = ink
    self.opaqueCorners = opaqueCorners
    self.bounds = bounds
    self.inkSide = inkSide
    self.aspect = aspect
  }

  /// The art of a `width` × `height` picture whose opacity at a pixel (0…1) is `alphaAt`, rows counted from the top.
  public init(width: Int, height: Int, alphaAt: (_ x: Int, _ y: Int) -> CGFloat) {
    guard width > 0, height > 0 else {
      self.init(ink: [], opaqueCorners: false)
      return
    }
    var rows: [(y: Int, left: Int, right: Int)] = []
    for y in 0..<height {
      guard let left = (0..<width).first(where: { alphaAt($0, y) > Self.inkAlpha }),
            let right = (left..<width).reversed().first(where: { alphaAt($0, y) > Self.inkAlpha }) else { continue }
      rows.append((y, left, right + 1))
    }
    guard let top = rows.first?.y, let bottom = rows.last.map({ $0.y + 1 }),
          let minX = rows.map(\.left).min(), let maxX = rows.map(\.right).max() else {
      // Nothing visible: nothing to fit.
      self.init(ink: [], opaqueCorners: false, aspect: CGFloat(width) / CGFloat(height))
      return
    }
    let boxWidth = CGFloat(maxX - minX), boxHeight = CGFloat(bottom - top)
    let unit = max(boxWidth, boxHeight)
    let midX = CGFloat(minX + maxX) / 2, midY = CGFloat(top + bottom) / 2
    let corners = [(minX, top), (maxX - 1, top), (minX, bottom - 1), (maxX - 1, bottom - 1)]
    let opaque = corners.allSatisfy { alphaAt($0.0, $0.1) >= 0.95 }
    var points: [CGPoint] = []
    for row in rows {
      // The pixel's edge farthest from the center, on each axis.
      let rowY = max(abs(CGFloat(row.y) - midY), abs(CGFloat(row.y + 1) - midY)) / unit
      points.append(CGPoint(x: abs(CGFloat(row.left) - midX) / unit, y: rowY))
      points.append(CGPoint(x: abs(CGFloat(row.right) - midX) / unit, y: rowY))
    }
    self.init(
      ink: points, opaqueCorners: opaque,
      bounds: CGRect(
        x: CGFloat(minX) / CGFloat(width), y: CGFloat(top) / CGFloat(height), width: boxWidth / CGFloat(width),
        height: boxHeight / CGFloat(height)),
      inkSide: unit / CGFloat(max(width, height)), aspect: boxWidth / boxHeight)
  }

  /// Reads `image`'s ink at no more than `readSide` pixels a side. A picture that cannot be read counts as opaque, so
  /// it fills as it always has.
  public init(image: CGImage) {
    let longer = max(image.width, image.height)
    let factor = longer > Self.readSide ? CGFloat(Self.readSide) / CGFloat(longer) : 1
    let width = max(1, Int((CGFloat(image.width) * factor).rounded()))
    let height = max(1, Int((CGFloat(image.height) * factor).rounded()))
    guard let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ), let data = context.data else {
      self.init(ink: [], opaqueCorners: true, aspect: CGFloat(image.width) / CGFloat(max(image.height, 1)))
      return
    }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    let bytes = data.bindMemory(to: UInt8.self, capacity: width * height * 4)
    // A bitmap context keeps its top row first.
    self.init(width: width, height: height) { x, y in CGFloat(bytes[(y * width + x) * 4 + 3]) / 255 }
  }

  /// How much longer the ink box's longer side is than its shorter: covering a square with it takes its shorter side.
  var fillFactor: CGFloat { aspect > 0 ? max(aspect, 1 / aspect) : 1 }

  /// How far to shrink art fitted to a badge (its longer side the badge's side) so that all of its ink lies inside
  /// the badge's shape, `margin` in from its edge: 1 when it already does, since art is never enlarged past its fit.
  /// `cornerFraction` is the shape's corner radius as a fraction of its side: 0 for a square, 0.5 for a circle.
  public func scale(cornerFraction: CGFloat, margin: CGFloat = Self.margin) -> CGFloat {
    let half = 0.5 - margin
    let radius = max(0, min(max(cornerFraction, 0), 0.5) - margin)
    let straight = half - radius
    var scale: CGFloat = 1
    for point in ink {
      let x = abs(point.x), y = abs(point.y)
      let far = max(x, y)
      guard far > 0 else { continue }
      var limit = half / far
      // Past the straight part of both edges the point meets the corner's arc instead: the larger root of
      // |k·(x, y) − (straight, straight)| = radius.
      if radius > 0, limit * min(x, y) > straight {
        let norm = x * x + y * y
        let reach = -straight * straight * (x - y) * (x - y) + radius * radius * norm
        limit = min(limit, (straight * (x + y) + max(reach, 0).squareRoot()) / norm)
      }
      scale = min(scale, limit)
    }
    return scale
  }

  /// The scale art is drawn at when it is a badge in its own right: art that fits the shape all but whole with no room
  /// round it (a round seal in a rounded square). Nil for a mark, which keeps its room.
  public func badgeScale(cornerFraction: CGFloat) -> CGFloat? {
    guard !ink.isEmpty else { return nil }
    let whole = scale(cornerFraction: cornerFraction, margin: 0)
    return whole >= Self.badgeFit ? whole : nil
  }
}

/// A decoded brand picture, cut to its ink's box, and where its art has ink.
final class AglynBrandImage {
  let image: CGImage
  let art: AglynBrandArt

  init(image: CGImage, art: AglynBrandArt) {
    self.image = image
    self.art = art
  }
}

/// A brand picture's bytes in a form the image decoders read (AGL-3996). ImageIO decodes no SVG, and the media CDN's
/// `?w=` serves an SVG unchanged, so a workspace logo uploaded as an SVG fell back to its initials
/// and gave the rail no color. The CDN draws any asset as a transparent PNG on request (`?icon=png-N`, the site icon
/// set's `transparent` plate, `site-icon-set.ts`); an SVG is read through that.
public enum AglynRasterArt {
  /// The sides the CDN draws a transparent PNG at (`site-icon-set.ts`: `FAVICON_PNG_SIZES` + `MANIFEST_ICON_SIZES`).
  public static let pngSides = [16, 32, 48, 72, 96, 128, 144, 152, 192, 256, 384, 512]
  /// The media CDN's route, as `mediaPreviewURL` builds its addresses.
  static let cdnRoute = "/api/media/cdn/"

  /// The CDN's PNG of the asset at `url`, at least as wide as the `w` it was asked at; nil for an address that is not
  /// on the media CDN, or already names a representation.
  public static func pngURL(for url: URL) -> URL? {
    guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.path.contains(cdnRoute) else {
      return nil
    }
    var items = parts.queryItems ?? []
    guard !items.contains(where: { $0.name == "icon" }) else { return nil }
    let width = items.first(where: { $0.name == "w" }).flatMap { Int($0.value ?? "") } ?? 160
    let side = pngSides.first { $0 >= width } ?? pngSides[pngSides.count - 1]
    items.removeAll { $0.name == "w" }
    items.append(URLQueryItem(name: "icon", value: "png-\(side)"))
    parts.queryItems = items
    return parts.url
  }

  /// Whether a response's bytes are a vector picture the decoders cannot read.
  static func isVector(_ data: Data, response: URLResponse) -> Bool {
    let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
    if type.contains("svg") { return true }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return true }
    return CGImageSourceGetCount(source) == 0
  }

  /// The bytes at `url`, or the CDN's PNG of them when they are an SVG; nil when neither can be fetched.
  public static func data(from url: URL, session: URLSession = .shared) async -> Data? {
    guard let (data, response) = try? await session.data(from: url) else { return nil }
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
    guard isVector(data, response: response), let png = pngURL(for: url) else { return data }
    guard let (pngData, pngResponse) = try? await session.data(from: png) else { return nil }
    if let http = pngResponse as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
    return pngData
  }
}

/// One brand picture as one box draws it, on a screen of `scale` pixels a point.
struct AglynBrandRequest: Hashable, Sendable {
  let url: URL
  let fit: AglynBrandFit
  let scale: CGFloat

  var key: String { "\(url.absoluteString)|\(fit)|\(scale)" }

  /// The pixels the ink box's longer side is decoded at: what the box draws it at, so it is never minified on screen.
  func pixels(_ art: AglynBrandArt) -> Int {
    max(1, Int((fit.layout(art).inkSide * scale).rounded(.up)))
  }
}

/// Fetches and decodes brand pictures. The fetched bytes and the art read from them are kept by URL, so every badge
/// showing one logo fetches and reads it once; each size it is drawn at is decoded once, at that size.
enum AglynBrandImageLoader {
  private static let bytes: NSCache<NSURL, NSData> = {
    let cache = NSCache<NSURL, NSData>()
    cache.totalCostLimit = 24 << 20
    return cache
  }()

  private final class ArtBox {
    let art: AglynBrandArt
    init(_ art: AglynBrandArt) { self.art = art }
  }

  private static let arts: NSCache<NSURL, ArtBox> = {
    let cache = NSCache<NSURL, ArtBox>()
    cache.countLimit = 240
    return cache
  }()

  private static let pictures: NSCache<NSString, AglynBrandImage> = {
    let cache = NSCache<NSString, AglynBrandImage>()
    cache.countLimit = 240
    return cache
  }()

  private static func pictureKey(_ url: URL, pixels: Int) -> NSString { "\(url.absoluteString)@\(pixels)" as NSString }

  /// The picture `request` draws, when it is already decoded at its size.
  static func cached(_ request: AglynBrandRequest) -> AglynBrandImage? {
    guard let art = arts.object(forKey: request.url as NSURL)?.art else { return nil }
    return pictures.object(forKey: pictureKey(request.url, pixels: request.pixels(art)))
  }

  /// How long to wait before each further try of a picture that failed: a CDN route still starting, a dropped
  /// connection. A logo that failed once otherwise kept its fallback (the workspace's initials) until the view was
  /// rebuilt (AGL-3991).
  static let retryDelays: [Duration] = [.seconds(1), .seconds(3), .seconds(8)]

  /// The picture at `url`, tried again after each of `delays` while it fails; nil once every try has, or when the
  /// view that asked has gone (its task is cancelled).
  static func loadRetrying(
    _ url: URL, delays: [Duration] = retryDelays, load: (URL) async -> AglynBrandImage?
  ) async -> AglynBrandImage? {
    if let picture = await load(url) { return picture }
    for delay in delays {
      try? await Task.sleep(for: delay)
      if Task.isCancelled { return nil }
      if let picture = await load(url) { return picture }
    }
    return nil
  }

  /// The picture `request` draws, or nil when it cannot be fetched or is not an image. An SVG is read as the media
  /// CDN's PNG of it.
  static func load(_ request: AglynBrandRequest) async -> AglynBrandImage? {
    if let hit = cached(request) { return hit }
    let key = request.url as NSURL
    let data: Data
    if let kept = bytes.object(forKey: key) {
      data = kept as Data
    } else {
      // An SVG is read as the media CDN's PNG of it (`AglynRasterArt`).
      guard let fetched = await AglynRasterArt.data(from: request.url) else { return nil }
      bytes.setObject(fetched as NSData, forKey: key, cost: fetched.count)
      data = fetched
    }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let art: AglynBrandArt
    if let kept = arts.object(forKey: key)?.art {
      art = kept
    } else {
      guard let read = thumbnail(source, maxPixels: AglynBrandArt.readSide) else { return nil }
      art = AglynBrandArt(image: read)
      arts.setObject(ArtBox(art), forKey: key)
    }
    let pixels = request.pixels(art)
    guard let image = decode(source, art: art, pixels: pixels) else { return nil }
    let picture = AglynBrandImage(image: image, art: art)
    pictures.setObject(picture, forKey: pictureKey(request.url, pixels: pixels))
    return picture
  }

  /// The picture in `source`, decoded so its ink box's longer side is `pixels` (never past the picture's own
  /// resolution), and cut to that box.
  static func decode(_ source: CGImageSource, art: AglynBrandArt, pixels: Int) -> CGImage? {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let width = (properties?[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0
    let height = (properties?[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0
    let longer = max(width, height)
    // The longer side of the whole picture that puts `pixels` across its ink.
    var side = Int((CGFloat(pixels) / max(art.inkSide, 0.001)).rounded(.up))
    if longer > 0 { side = min(side, longer) }
    guard let image = thumbnail(source, maxPixels: max(side, 1)) else { return nil }
    return crop(image, to: art.bounds)
  }

  /// `source` downsampled by ImageIO (a filtered reduction, not a single sampling pass), upright, no more than
  /// `maxPixels` on its longer side.
  static func thumbnail(_ source: CGImageSource, maxPixels: Int) -> CGImage? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  /// `image` cut to `bounds` (fractions of its sides, from its top left), rounded out to whole pixels.
  static func crop(_ image: CGImage, to bounds: CGRect) -> CGImage {
    let width = CGFloat(image.width), height = CGFloat(image.height)
    let minX = (bounds.minX * width).rounded(.down), minY = (bounds.minY * height).rounded(.down)
    let rect = CGRect(
      x: minX, y: minY, width: (bounds.maxX * width).rounded(.up) - minX,
      height: (bounds.maxY * height).rounded(.up) - minY
    ).intersection(CGRect(x: 0, y: 0, width: width, height: height))
    guard !rect.isEmpty, rect.size != CGSize(width: width, height: height) else { return image }
    return image.cropping(to: rect) ?? image
  }
}

/// A square tile in a media grid: the preview (or the kind's symbol), the
/// file name, and a badge ("Private") in the corner.
public struct AglynMediaTile: View {
  let title: String
  let imageURL: URL?
  let systemImage: String
  let badge: (text: String, tone: AglynTone)?
  let selected: Bool

  public init(
    _ title: String, imageURL: URL?, systemImage: String, badge: (text: String, tone: AglynTone)? = nil,
    selected: Bool = false
  ) {
    self.title = title
    self.imageURL = imageURL
    self.systemImage = systemImage
    self.badge = badge
    self.selected = selected
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Color.clear
        .aspectRatio(1, contentMode: .fit)
        .overlay { AglynRemoteImage(imageURL, systemImage: systemImage) }
        .overlay(alignment: .topLeading) {
          if let badge {
            StatusChip(badge.text, tone: badge.tone)
              .background(AglynColor.paper, in: Capsule())
              .padding(AglynSpace.half)
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
      Text(title)
        .font(AglynFont.caption)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.horizontal, AglynSpace.half)
    }
    .padding(AglynSpace.half)
    .background(
      selected ? AglynColor.primary.opacity(0.16) : AglynColor.paper,
      in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous)
    )
    .overlay(
      RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous)
        .strokeBorder(selected ? AglynColor.primary : AglynColor.divider, lineWidth: selected ? 2 : 1)
    )
    .contentShape(RoundedRectangle(cornerRadius: AglynRadius.card))
    .accessibilityElement(children: .combine)
    .accessibilityLabel([title, badge?.text].compactMap { $0 }.joined(separator: ", "))
    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
  }
}

/// Placeholder tiles while a grid loads, drawn with the system's redaction.
public struct SkeletonGrid: View {
  let count: Int
  let minimum: CGFloat

  public init(count: Int = 9, minimum: CGFloat = 120) {
    self.count = count
    self.minimum = minimum
  }

  public var body: some View {
    ScrollView {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: AglynSpace.one)], spacing: AglynSpace.one) {
        ForEach(0..<count, id: \.self) { _ in
          AglynMediaTile("Loading a file name", imageURL: nil, systemImage: "photo")
        }
      }
      .padding(AglynSpace.two)
    }
    .redacted(reason: .placeholder)
    .disabled(true)
    .accessibilityLabel("Loading")
  }
}

/// Where a picked file comes from.
public enum PickSource: String, CaseIterable, Identifiable, Sendable {
  case photos, camera, files

  public var id: String { rawValue }

  /// How a source reads in a menu.
  public var label: String {
    switch self {
    case .photos: "Photo library"
    case .camera: "Take a photo"
    case .files: "Choose files"
    }
  }

  public var systemImage: String {
    switch self {
    case .photos: "photo.on.rectangle"
    case .camera: "camera"
    case .files: "folder"
    }
  }

  /// The sources this device offers, in the order a menu lists them: the
  /// camera only where there is one (not on a Mac or in the Simulator).
  @MainActor
  public static var available: [PickSource] {
    #if os(iOS)
      UIImagePickerController.isSourceTypeAvailable(.camera) ? [.photos, .camera, .files] : [.photos, .files]
    #else
      [.photos, .files]
    #endif
  }
}

/// A file the person picked or shot, read whole, with the name and type the device gave it.
public struct PickedFile: Sendable {
  public let name: String
  public let mimeType: String
  public let data: Data

  public init(name: String, mimeType: String, data: Data) {
    self.name = name
    self.mimeType = mimeType
    self.data = data
  }

  public var size: Int { data.count }

  /// A file name's type, as the upload route takes it.
  public static func mimeType(forExtension ext: String) -> String {
    UTType(filenameExtension: ext.lowercased())?.preferredMIMEType ?? "application/octet-stream"
  }

  /// A name for a picture with none of its own: `Photo 2026-10-07 at 21.04.12.jpg`.
  public static func photoName(_ ext: String, date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
    return "Photo \(formatter.string(from: date)).\(ext)"
  }
}

extension View {
  /// The device's own pickers, shown while `source` is set: the photo
  /// library (PhotosPicker), the camera (iPhone and iPad), or the file
  /// browser (fileImporter). `onPicked` gets the files read whole; nothing
  /// when the person backs out.
  public func aglynMediaPicker(
    _ source: Binding<PickSource?>, multiple: Bool = true,
    onPicked: @escaping @MainActor ([PickedFile]) -> Void
  ) -> some View {
    modifier(MediaPickerModifier(source: source, multiple: multiple, onPicked: onPicked))
  }
}

private struct MediaPickerModifier: ViewModifier {
  @Binding var source: PickSource?
  let multiple: Bool
  let onPicked: @MainActor ([PickedFile]) -> Void
  @State private var items: [PhotosPickerItem] = []

  private func showing(_ kind: PickSource) -> Binding<Bool> {
    Binding(get: { source == kind }, set: { if !$0, source == kind { source = nil } })
  }

  func body(content: Content) -> some View {
    content
      .photosPicker(
        isPresented: showing(.photos), selection: $items, maxSelectionCount: multiple ? 20 : 1,
        matching: .any(of: [.images, .videos]))
      .fileImporter(isPresented: showing(.files), allowedContentTypes: [.item], allowsMultipleSelection: multiple) {
        result in
        guard case .success(let urls) = result else { return }
        let files = urls.compactMap(Self.read)
        if !files.isEmpty { onPicked(files) }
      }
      #if os(iOS)
        .fullScreenCover(isPresented: showing(.camera)) {
          CameraCapture { data in
            source = nil
            if let data { onPicked([PickedFile(name: PickedFile.photoName("jpg"), mimeType: "image/jpeg", data: data)]) }
          }
          .ignoresSafeArea()
        }
      #endif
      .onChange(of: items) { _, picked in
        guard !picked.isEmpty else { return }
        items = []
        Task { @MainActor in
          var files: [PickedFile] = []
          for item in picked {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first
            let ext = type?.preferredFilenameExtension ?? "jpg"
            files.append(
              PickedFile(
                name: PickedFile.photoName(ext), mimeType: type?.preferredMIMEType ?? "application/octet-stream",
                data: data))
          }
          if !files.isEmpty { onPicked(files) }
        }
      }
  }

  private static func read(_ url: URL) -> PickedFile? {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return PickedFile(
      name: url.lastPathComponent, mimeType: PickedFile.mimeType(forExtension: url.pathExtension), data: data)
  }
}

#if os(iOS)
  /// The system camera, for one photo; answers its JPEG bytes, or nil when cancelled.
  struct CameraCapture: UIViewControllerRepresentable {
    let onDone: (Data?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.delegate = context.coordinator
      return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
      let onDone: (Data?) -> Void
      init(onDone: @escaping (Data?) -> Void) { self.onDone = onDone }

      func imagePickerController(
        _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
      ) {
        onDone((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.9))
      }

      func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onDone(nil) }
    }
  }
#endif
