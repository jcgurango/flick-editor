/**
 * Path morphing: parse two SVG path `d` strings, normalize to matched
 * cubic bezier segments, and interpolate between them.
 */

type Point = [number, number]

interface CubicSegment {
  /** Start point (inherited from previous segment or M command) */
  from: Point
  /** Control point 1 */
  cp1: Point
  /** Control point 2 */
  cp2: Point
  /** End point */
  to: Point
}

// ── Path Parsing ──

interface RawCmd {
  type: string
  args: number[]
}

const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g
const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi

function parsePath(d: string): RawCmd[] {
  const cmds: RawCmd[] = []
  for (const match of d.matchAll(CMD_RE)) {
    const type = match[1]
    const argStr = match[2]
    const args = argStr.match(NUM_RE)?.map(Number) ?? []
    cmds.push({ type, args })
  }
  return cmds
}

// ── Convert all commands to absolute cubic beziers ──

function toCubicSegments(cmds: RawCmd[]): CubicSegment[] {
  const segments: CubicSegment[] = []
  let cx = 0, cy = 0       // current point
  let sx = 0, sy = 0       // subpath start
  let lastCp: Point | null = null // for S/T shorthand
  let lastQCp: Point | null = null

  for (const cmd of cmds) {
    const { type, args } = cmd
    const isRel = type === type.toLowerCase()
    const abs = type.toUpperCase()
    const ox = isRel ? cx : 0
    const oy = isRel ? cy : 0

    switch (abs) {
      case 'M': {
        cx = args[0] + ox
        cy = args[1] + oy
        sx = cx; sy = cy
        // Extra coordinate pairs are implicit linetos
        for (let i = 2; i < args.length; i += 2) {
          const x = args[i] + ox, y = args[i + 1] + oy
          segments.push(lineToCubic([cx, cy], [x, y]))
          cx = x; cy = y
        }
        lastCp = null; lastQCp = null
        break
      }
      case 'L': {
        for (let i = 0; i < args.length; i += 2) {
          const x = args[i] + ox, y = args[i + 1] + oy
          segments.push(lineToCubic([cx, cy], [x, y]))
          cx = x; cy = y
        }
        lastCp = null; lastQCp = null
        break
      }
      case 'H': {
        for (const a of args) {
          const x = a + ox
          segments.push(lineToCubic([cx, cy], [x, cy]))
          cx = x
        }
        lastCp = null; lastQCp = null
        break
      }
      case 'V': {
        for (const a of args) {
          const y = a + oy
          segments.push(lineToCubic([cx, cy], [cx, y]))
          cy = y
        }
        lastCp = null; lastQCp = null
        break
      }
      case 'C': {
        for (let i = 0; i < args.length; i += 6) {
          const cp1: Point = [args[i] + ox, args[i + 1] + oy]
          const cp2: Point = [args[i + 2] + ox, args[i + 3] + oy]
          const to: Point = [args[i + 4] + ox, args[i + 5] + oy]
          segments.push({ from: [cx, cy], cp1, cp2, to })
          lastCp = cp2
          cx = to[0]; cy = to[1]
        }
        lastQCp = null
        break
      }
      case 'S': {
        for (let i = 0; i < args.length; i += 4) {
          const cp1: Point = lastCp
            ? [2 * cx - lastCp[0], 2 * cy - lastCp[1]]
            : [cx, cy]
          const cp2: Point = [args[i] + ox, args[i + 1] + oy]
          const to: Point = [args[i + 2] + ox, args[i + 3] + oy]
          segments.push({ from: [cx, cy], cp1, cp2, to })
          lastCp = cp2
          cx = to[0]; cy = to[1]
        }
        lastQCp = null
        break
      }
      case 'Q': {
        for (let i = 0; i < args.length; i += 4) {
          const qp: Point = [args[i] + ox, args[i + 1] + oy]
          const to: Point = [args[i + 2] + ox, args[i + 3] + oy]
          segments.push(quadToCubic([cx, cy], qp, to))
          lastQCp = qp
          cx = to[0]; cy = to[1]
        }
        lastCp = null
        break
      }
      case 'T': {
        for (let i = 0; i < args.length; i += 2) {
          const qp: Point = lastQCp
            ? [2 * cx - lastQCp[0], 2 * cy - lastQCp[1]]
            : [cx, cy]
          const to: Point = [args[i] + ox, args[i + 1] + oy]
          segments.push(quadToCubic([cx, cy], qp, to))
          lastQCp = qp
          cx = to[0]; cy = to[1]
        }
        lastCp = null
        break
      }
      case 'A': {
        for (let i = 0; i < args.length; i += 7) {
          const rx = args[i], ry = args[i + 1]
          const xRot = args[i + 2]
          const largeArc = args[i + 3]
          const sweep = args[i + 4]
          const x = args[i + 5] + ox, y = args[i + 6] + oy
          const arcSegs = arcToCubic([cx, cy], rx, ry, xRot, !!largeArc, !!sweep, [x, y])
          segments.push(...arcSegs)
          cx = x; cy = y
        }
        lastCp = null; lastQCp = null
        break
      }
      case 'Z': {
        if (cx !== sx || cy !== sy) {
          segments.push(lineToCubic([cx, cy], [sx, sy]))
        }
        cx = sx; cy = sy
        lastCp = null; lastQCp = null
        break
      }
    }
  }

  return segments
}

// ── Conversion helpers ──

function lineToCubic(from: Point, to: Point): CubicSegment {
  return {
    from,
    cp1: [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3],
    cp2: [from[0] + 2 * (to[0] - from[0]) / 3, from[1] + 2 * (to[1] - from[1]) / 3],
    to,
  }
}

function quadToCubic(from: Point, qp: Point, to: Point): CubicSegment {
  return {
    from,
    cp1: [from[0] + 2 / 3 * (qp[0] - from[0]), from[1] + 2 / 3 * (qp[1] - from[1])],
    cp2: [to[0] + 2 / 3 * (qp[0] - to[0]), to[1] + 2 / 3 * (qp[1] - to[1])],
    to,
  }
}

// Approximate arc with cubic beziers
function arcToCubic(
  from: Point, rx: number, ry: number,
  xRotDeg: number, largeArc: boolean, sweep: boolean,
  to: Point,
): CubicSegment[] {
  if (rx === 0 || ry === 0) return [lineToCubic(from, to)]

  const xRot = (xRotDeg * Math.PI) / 180
  const cosR = Math.cos(xRot), sinR = Math.sin(xRot)

  // Step 1: compute center parameterization
  const dx = (from[0] - to[0]) / 2, dy = (from[1] - to[1]) / 2
  const x1p = cosR * dx + sinR * dy
  const y1p = -sinR * dx + cosR * dy

  let rxSq = rx * rx, rySq = ry * ry
  const x1pSq = x1p * x1p, y1pSq = y1p * y1p

  // Correct radii if needed
  const lambda = x1pSq / rxSq + y1pSq / rySq
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s; ry *= s
    rxSq = rx * rx; rySq = ry * ry
  }

  let sq = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq)
  if (sq < 0) sq = 0
  const sign = largeArc === sweep ? -1 : 1
  const k = sign * Math.sqrt(sq)
  const cxp = k * (rx * y1p) / ry
  const cyp = k * -(ry * x1p) / rx

  const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2
  const _cx = cosR * cxp - sinR * cyp + mx
  const _cy = sinR * cxp + cosR * cyp + my

  // Angles
  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
  let dTheta = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - theta1
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI

  // Split into segments of at most pi/2
  const nSegs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)))
  const segAngle = dTheta / nSegs
  const segments: CubicSegment[] = []

  let prevPt = from
  for (let i = 0; i < nSegs; i++) {
    const a1 = theta1 + i * segAngle
    const a2 = theta1 + (i + 1) * segAngle
    const alpha = (4 / 3) * Math.tan((a2 - a1) / 4)

    const cos1 = Math.cos(a1), sin1 = Math.sin(a1)
    const cos2 = Math.cos(a2), sin2 = Math.sin(a2)

    const ep1x = rx * cos1, ep1y = ry * sin1
    const ep2x = rx * cos2, ep2y = ry * sin2

    const cp1x = ep1x - alpha * rx * sin1
    const cp1y = ep1y + alpha * ry * cos1
    const cp2x = ep2x + alpha * rx * sin2
    const cp2y = ep2y - alpha * ry * cos2

    const transformPt = (px: number, py: number): Point => [
      cosR * px - sinR * py + _cx,
      sinR * px + cosR * py + _cy,
    ]

    const endPt = transformPt(ep2x, ep2y)
    segments.push({
      from: prevPt,
      cp1: transformPt(cp1x, cp1y),
      cp2: transformPt(cp2x, cp2y),
      to: endPt,
    })
    prevPt = endPt
  }

  return segments
}

// ── Segment Matching ──

/** Subdivide a cubic bezier at t=0.5, returning two segments */
function subdivideCubic(seg: CubicSegment): [CubicSegment, CubicSegment] {
  const [x0, y0] = seg.from
  const [x1, y1] = seg.cp1
  const [x2, y2] = seg.cp2
  const [x3, y3] = seg.to

  const mx01 = (x0 + x1) / 2, my01 = (y0 + y1) / 2
  const mx12 = (x1 + x2) / 2, my12 = (y1 + y2) / 2
  const mx23 = (x2 + x3) / 2, my23 = (y2 + y3) / 2
  const mx012 = (mx01 + mx12) / 2, my012 = (my01 + my12) / 2
  const mx123 = (mx12 + mx23) / 2, my123 = (my12 + my23) / 2
  const mid: Point = [(mx012 + mx123) / 2, (my012 + my123) / 2]

  return [
    { from: seg.from, cp1: [mx01, my01], cp2: [mx012, my012], to: mid },
    { from: mid, cp1: [mx123, my123], cp2: [mx23, my23], to: seg.to },
  ]
}

/** Approximate arc length of a cubic segment (chord + control polygon average) */
function segLength(seg: CubicSegment): number {
  const chord = dist(seg.from, seg.to)
  const poly = dist(seg.from, seg.cp1) + dist(seg.cp1, seg.cp2) + dist(seg.cp2, seg.to)
  return (chord + poly) / 2
}

function dist(a: Point, b: Point): number {
  const dx = a[0] - b[0], dy = a[1] - b[1]
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Match segment counts by subdividing the longest segments in the
 * shorter array until both arrays have equal length.
 */
function matchSegmentCounts(a: CubicSegment[], b: CubicSegment[]): [CubicSegment[], CubicSegment[]] {
  let shorter = a.length <= b.length ? [...a] : [...b]
  const longer = a.length <= b.length ? b : a
  const target = longer.length

  while (shorter.length < target) {
    // Find the longest segment and subdivide it
    let longestIdx = 0
    let longestLen = 0
    for (let i = 0; i < shorter.length; i++) {
      const l = segLength(shorter[i])
      if (l > longestLen) {
        longestLen = l
        longestIdx = i
      }
    }
    const [s1, s2] = subdivideCubic(shorter[longestIdx])
    shorter = [...shorter.slice(0, longestIdx), s1, s2, ...shorter.slice(longestIdx + 1)]
  }

  return a.length <= b.length ? [shorter, longer] : [longer, shorter]
}

// ── Interpolation ──

function lerpPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function interpolateSegments(a: CubicSegment[], b: CubicSegment[], t: number): CubicSegment[] {
  return a.map((segA, i) => {
    const segB = b[i]
    return {
      from: lerpPoint(segA.from, segB.from, t),
      cp1: lerpPoint(segA.cp1, segB.cp1, t),
      cp2: lerpPoint(segA.cp2, segB.cp2, t),
      to: lerpPoint(segA.to, segB.to, t),
    }
  })
}

function segmentsToD(segments: CubicSegment[]): string {
  if (segments.length === 0) return ''
  const parts: string[] = []
  const fmt = (n: number) => Math.round(n * 100) / 100

  parts.push(`M${fmt(segments[0].from[0])},${fmt(segments[0].from[1])}`)
  for (const seg of segments) {
    parts.push(
      `C${fmt(seg.cp1[0])},${fmt(seg.cp1[1])} ${fmt(seg.cp2[0])},${fmt(seg.cp2[1])} ${fmt(seg.to[0])},${fmt(seg.to[1])}`,
    )
  }
  return parts.join(' ')
}

// ── Public API ──

/** Interpolate between two SVG path `d` strings at parameter t (0-1). */
export function interpolatePath(dA: string, dB: string, t: number): string {
  if (t <= 0) return dA
  if (t >= 1) return dB

  const segsA = toCubicSegments(parsePath(dA))
  const segsB = toCubicSegments(parsePath(dB))

  if (segsA.length === 0 || segsB.length === 0) return t < 0.5 ? dA : dB

  const [matchedA, matchedB] = matchSegmentCounts(segsA, segsB)
  const result = interpolateSegments(matchedA, matchedB, t)
  return segmentsToD(result)
}
