/**
 * Turning a document into pixels: the contract, not an implementation.
 *
 * Separated from everything else in this directory because it is the one place
 * a browser is genuinely required, and keeping that behind a function type is
 * what lets the rest of the preview — the markup, the stylesheets, the asset
 * URLs, the composition into an `AgentImage` — be tested without launching
 * anything.
 *
 * It is deliberately *not* a general screenshot service. The request says a
 * document, a logical size and a device scale, and nothing about slides: a
 * rasterizer that knew what a slide was would be a second place a slide is
 * described.
 */

export interface RasterRequest {
  /** A complete, self-contained HTML document. */
  html: string
  /** The logical size to lay out at, in CSS pixels. */
  width: number
  height: number
  /** Device pixels per CSS pixel. The picture comes back `width * scale` wide. */
  scale: number
  /**
   * Web-font families the document is waiting for.
   *
   * Passed so the rasterizer can wait for the faces rather than for a
   * heuristic amount of time, and report honestly when they never arrived.
   */
  fontFamilies: string[]
}

export interface RasterImage {
  bytes: Uint8Array
  /** Device pixels, so `width * scale`. */
  width: number
  height: number
  /** Whether every requested family was usable when the shot was taken. */
  fontsReady: boolean
  warnings: string[]
}

export type SlideRasterizer = (request: RasterRequest) => Promise<RasterImage>

/** The only format. PNG because a slide is flat colour and type, not a photo. */
export const PREVIEW_MIME_TYPE = 'image/png'

/**
 * The largest picture that is answered at all.
 *
 * Not a guess: serverless platforms cut a response off around four and a half
 * megabytes, and the JSON and MCP framings base64-encode the bytes, which adds a
 * third. Three megabytes therefore leaves room for the envelope in the worst of
 * the three shapes — and a slide at the default scale is twenty to two hundred
 * kilobytes, so this only ever bites a photo-heavy slide asked for at `scale: 2`.
 *
 * The point of having it here rather than discovering it in production is what an
 * agent is told: "ask for a smaller one", with the numbers, instead of a platform
 * error page it cannot parse.
 */
export const MAX_PREVIEW_BYTES = 3 * 1024 * 1024

/**
 * The pixel size a PNG declares, read from its own header.
 *
 * Eight bytes, thirty-three into the file: the signature, then the first chunk,
 * which the format requires to be `IHDR`. Worth reading rather than trusting
 * the arithmetic, because the size is the one thing an agent uses the metadata
 * for — whether what it is looking at is the whole slide — and a device scale
 * factor that the browser rounded differently would make that number a small,
 * confident lie.
 *
 * `null` for anything that is not a PNG, so a caller falls back rather than
 * throwing on a byte string it did not produce.
 */
export function pngPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  if (SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Bytes 12–15 are the chunk type; IHDR is required to be first.
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
