import type { FlickObject } from '../types/project'

/** Renders a FlickObject as the corresponding SVG element. */
export function SvgObject({ obj }: { obj: FlickObject }) {
  const { type, id } = obj

  // Extract transform-related attrs, pass the rest to the SVG element
  const { rotation, originX, originY, ...svgAttrs } = obj.attrs as Record<string, unknown> & {
    rotation?: number
    originX?: number
    originY?: number
  }

  const hasTransform = rotation != null && rotation !== 0
  const transform = hasTransform
    ? `rotate(${rotation}, ${originX ?? 0}, ${originY ?? 0})`
    : undefined

  const element = (() => {
    switch (type) {
      case 'rect':
        return <rect data-id={id} {...svgAttrs} />
      case 'ellipse':
        return <ellipse data-id={id} {...svgAttrs} />
      case 'circle':
        return <circle data-id={id} {...svgAttrs} />
      case 'line':
        return <line data-id={id} {...svgAttrs} />
      case 'path':
        return <path data-id={id} {...svgAttrs} />
      case 'text':
        return (
          <text data-id={id} {...svgAttrs}>
            {svgAttrs.text as string}
          </text>
        )
      default:
        return null
    }
  })()

  if (!element) return null

  return transform ? <g transform={transform}>{element}</g> : element
}
