const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const SODIPODI_NS = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';

/**
 * Normalize an SVG string for structural comparison.
 * Strips Inkscape/Sodipodi metadata attributes so that two SVGs
 * with the same visible content compare as equal.
 */
export function normalizeSvgForDiff(svg: string): string {
  if (!svg) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;

  stripMetadata(doc.documentElement);

  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc.documentElement).trim();
}

function stripMetadata(el: Element): void {
  // Remove inkscape:* and sodipodi:* attributes
  const toRemove: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.namespaceURI === INKSCAPE_NS || attr.namespaceURI === SODIPODI_NS) {
      toRemove.push(attr.name);
    }
    // Also catch un-namespaced inkscape:/sodipodi: prefixed attrs
    if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') || attr.name.startsWith("xmlns")) {
      toRemove.push(attr.name);
    }
  }
  for (const name of toRemove) {
    el.removeAttribute(name);
  }

  // Recurse into children
  for (const child of Array.from(el.children)) {
    stripMetadata(child);
  }
}
