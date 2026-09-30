// Regenerates the app icon (mark only, opaque 1024px) and the transparent in-app
// logo from a full brand lockup PNG (mark above wordmark, light background):
//   cd apps/ios-client/AppResources/Assets.xcassets
//   swift ../../scripts/make-brand-assets.swift <logo.png> AppIcon.appiconset BrandLogo.imageset
import AppKit
import CoreImage

// Logo pixels are purple; the textured paper is near-neutral. Classify by
// saturation, not brightness, so paper grain never survives as specks.
let a = CommandLine.arguments
let srcCG = NSImage(contentsOf: URL(fileURLWithPath: a[1]))!.cgImage(forProposedRect: nil, context: nil, hints: nil)!
let w = srcCG.width, h = srcCG.height
let rgb = CGColorSpaceCreateDeviceRGB()
var px = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: rgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(srcCG, in: CGRect(x: 0, y: 0, width: w, height: h))

// Pass 1: rows containing purple -> find wordmark gap (first long empty band below the mark).
var rowHasInk = [Bool](repeating: false, count: h)
var minX = w, maxX = 0, minY = h, maxY = 0
for y in 0..<h { for x in 0..<w {
    let i = (y * w + x) * 4
    let r = Int(px[i]), g = Int(px[i + 1]), b = Int(px[i + 2])
    if max(r, g, b) - min(r, g, b) > 30 && b > g {
        rowHasInk[y] = true
        minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
    }
}}
// Mark ends at the first gap of >= 1.5% of height after the mark's top.
var markBottom = maxY
var run = 0
for y in minY..<h {
    if rowHasInk[y] { run = 0 } else { run += 1; if run >= h / 66 { markBottom = y - run; break } }
}
print("logo bbox x \(minX)-\(maxX) y \(minY)-\(maxY); mark bottom \(markBottom)")

// Pass 2: alpha from "distance from paper": unmultiply against white for ink, transparent for paper.
var mMinX = w, mMaxX = 0
for y in 0..<h { for x in 0..<w {
    let i = (y * w + x) * 4
    let r = Double(px[i]), g = Double(px[i + 1]), b = Double(px[i + 2])
    let sat = max(r, g, b) - min(r, g, b)
    let lightest = min(r, g, b)
    if sat < 18 && lightest > 200 { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; continue }
    let alpha = max(0.0, min(1.0, 1 - lightest / 255 * 0.92))
    px[i] = UInt8(max(0, r - (1 - alpha) * 255)); px[i + 1] = UInt8(max(0, g - (1 - alpha) * 255))
    px[i + 2] = UInt8(max(0, b - (1 - alpha) * 255)); px[i + 3] = UInt8(alpha * 255)
    if y >= minY && y <= markBottom { mMinX = min(mMinX, x); mMaxX = max(mMaxX, x) }
}}
let cleaned = ctx.makeImage()!
let ci = CIContext()

func scaled(_ cg: CGImage, to height: Int) -> CGImage {
    let f = CIFilter(name: "CILanczosScaleTransform")!
    f.setValue(CIImage(cgImage: cg), forKey: kCIInputImageKey)
    f.setValue(CGFloat(height) / CGFloat(cg.height), forKey: kCIInputScaleKey)
    f.setValue(1.0, forKey: kCIInputAspectRatioKey)
    let img = f.outputImage!
    return ci.createCGImage(img, from: img.extent.integral, format: .RGBA8, colorSpace: rgb)!
}
func write(_ cg: CGImage, _ path: String) {
    let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(d, cg, nil); CGImageDestinationFinalize(d)
}

// In-app logo: full lockup, transparent, trimmed with a small margin.
let pad = 8
let logo = cleaned.cropping(to: CGRect(x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad))!
for (scale, hgt) in [(1, 90), (2, 180), (3, 270)] {
    write(scaled(logo, to: hgt), a[3] + "/Logo\(scale == 1 ? "" : "@\(scale)x").png")
}

// App icon: mark only, square, 74% of 1024, centred on opaque white (no alpha).
let side = max(mMaxX - mMinX, markBottom - minY) + 2 * pad
let cx = (mMinX + mMaxX) / 2, cy = (minY + markBottom) / 2
let mark = cleaned.cropping(to: CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side))!
let markImg = scaled(mark, to: 760)
let octx = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: rgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
octx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); octx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
let off = (1024 - markImg.width) / 2
octx.draw(markImg, in: CGRect(x: off, y: (1024 - markImg.height) / 2, width: markImg.width, height: markImg.height))
write(octx.makeImage()!, a[2] + "/AppIcon-1024.png")
