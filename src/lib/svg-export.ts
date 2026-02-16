import type { Project, FlickObject } from '../types/project'
import { resolveFrame } from './interpolate'
import { computeBBox, absoluteOrigin } from './bbox'

const CAMEL_TO_KEBAB: Record<string, string> = {
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  clipRule: 'clip-rule',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  textAnchor: 'text-anchor',
  dominantBaseline: 'dominant-baseline',
}

function escapeAttr(val: unknown): string {
  return String(val).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function flickObjectToSvg(obj: FlickObject): string {
  const { type, attrs } = obj
  const { rotation, ...rest } = attrs as Record<string, unknown> & { rotation?: number }

  // Build transform
  const transforms: string[] = []

  const rot = rotation as number | undefined
  if (rot != null && rot !== 0) {
    const bbox = computeBBox(obj)
    if (bbox) {
      const [ox, oy] = absoluteOrigin(obj, bbox)
      transforms.push(`rotate(${rot}, ${ox}, ${oy})`)
    }
  }

  let svgAttrs: Record<string, unknown> = rest
  if (type === 'path') {
    const { x, y, ...pathAttrs } = rest as Record<string, unknown> & { x?: number; y?: number }
    svgAttrs = pathAttrs
    const px = (x as number) ?? 0
    const py = (y as number) ?? 0
    if (px || py) {
      transforms.push(`translate(${px}, ${py})`)
    }
  }

  // Skip non-SVG attrs
  const skipKeys = new Set(['text'])
  const elementName = type === 'circle' ? 'circle' : type

  // Build attribute string
  const attrParts: string[] = []
  for (const [key, val] of Object.entries(svgAttrs)) {
    if (val == null || skipKeys.has(key)) continue
    const svgKey = CAMEL_TO_KEBAB[key] ?? key
    attrParts.push(`${svgKey}="${escapeAttr(val)}"`)
  }

  const transformAttr = transforms.length > 0 ? ` transform="${transforms.join(' ')}"` : ''

  if (type === 'text') {
    const textContent = (attrs.text as string) ?? ''
    const escaped = textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<g${transformAttr}><text ${attrParts.join(' ')}>${escaped}</text></g>`
  }

  const selfClose = `<${elementName} ${attrParts.join(' ')}/>`
  return transformAttr ? `<g${transformAttr}>${selfClose}</g>` : selfClose
}

export function renderFrameToSvg(project: Project, frame: number): string {
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${project.width}" height="${project.height}" viewBox="0 0 ${project.width} ${project.height}">`)

  // Layers in reverse order (bottom-up, same as canvas rendering)
  const visibleLayers = project.layers.filter((l) => l.visible).slice().reverse()

  for (const layer of visibleLayers) {
    const objects = resolveFrame(layer, frame)
    if (objects.length === 0) continue
    parts.push(`  <g>`)
    for (const obj of objects) {
      parts.push(`    ${flickObjectToSvg(obj)}`)
    }
    parts.push(`  </g>`)
  }

  parts.push(`</svg>`)
  return parts.join('\n')
}
