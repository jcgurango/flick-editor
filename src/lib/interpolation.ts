import { interpolate } from 'd3-interpolate';

/** Inject missing namespace declarations so DOMParser's strict XML mode doesn't choke */
const NS_DECLS: [string, string][] = [
  ['inkscape', 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'],
  ['sodipodi', 'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"'],
  ['xlink', 'xmlns:xlink="http://www.w3.org/1999/xlink"'],
];

function ensureNamespaces(svg: string): string {
  const tagMatch = svg.match(/<svg[^>]*>/);
  if (!tagMatch) return svg;
  const svgTag = tagMatch[0];
  let patched = svgTag;
  for (const [prefix, decl] of NS_DECLS) {
    if (svg.includes(`${prefix}:`) && !svgTag.includes(`xmlns:${prefix}`)) {
      patched = patched.replace('>', ` ${decl}>`);
    }
  }
  return patched === svgTag ? svg : svg.replace(svgTag, patched);
}

/**
 * Interpolate between two SVG strings at parameter t (0..1).
 *
 * Strategy:
 * 1. Parse both SVGs, collect elements by ID
 * 2. Matched elements (same ID in both): interpolate all attributes with d3-interpolate
 * 3. A-only elements: fade out (opacity 1-t)
 * 4. B-only elements: fade in (opacity t)
 */
export function interpolateSvg(svgA: string, svgB: string, t: number): string {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const docA = parser.parseFromString(ensureNamespaces(svgA), 'image/svg+xml');
  const docB = parser.parseFromString(ensureNamespaces(svgB), 'image/svg+xml');

  const rootA = docA.documentElement;
  const rootB = docB.documentElement;

  // Collect elements with IDs from both SVGs
  const mapA = collectElementsById(rootA);
  const mapB = collectElementsById(rootB);

  // Create output document based on A's structure
  const output = docA.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // Copy root attributes from A
  for (const attr of Array.from(rootA.attributes)) {
    output.setAttribute(attr.name, attr.value);
  }

  const processedIds = new Set<string>();

  // Process matched elements (present in both A and B)
  // Walk A's tree to preserve order, interpolating where matched
  processNode(rootA, output, docA, mapA, mapB, t, processedIds, serializer);

  // Add B-only elements (fade in)
  for (const [id, elemB] of mapB) {
    if (processedIds.has(id)) continue;
    const clone = docA.importNode(elemB, true);
    clone.setAttribute('opacity', String(t));
    output.appendChild(clone);
  }

  // Serialize children individually so each carries its own namespace
  // declarations — avoids losing them when the caller embeds the result
  // inside a parent <g> or <svg>.
  let result = '';
  for (const child of Array.from(output.childNodes)) {
    result += serializer.serializeToString(child);
  }
  return result;
}

function collectElementsById(root: Element): Map<string, Element> {
  const map = new Map<string, Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Element | null = walker.currentNode as Element;
  while (node) {
    const id = node.getAttribute('id');
    if (id) {
      map.set(id, node);
    }
    node = walker.nextNode() as Element | null;
  }
  return map;
}

function processNode(
  nodeA: Node,
  parent: Element,
  doc: Document,
  mapA: Map<string, Element>,
  mapB: Map<string, Element>,
  t: number,
  processedIds: Set<string>,
  serializer: XMLSerializer
): void {
  for (const child of Array.from(nodeA.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parent.appendChild(doc.importNode(child, false));
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const elemA = child as Element;
    const id = elemA.getAttribute('id');

    if (id && mapB.has(id)) {
      // Matched element — interpolate attributes
      const elemB = mapB.get(id)!;
      processedIds.add(id);

      const interpolated = doc.createElementNS(
        elemA.namespaceURI || 'http://www.w3.org/2000/svg',
        elemA.tagName
      );

      // Collect all attribute names from both
      const attrNames = new Set<string>();
      for (const attr of Array.from(elemA.attributes)) attrNames.add(attr.name);
      for (const attr of Array.from(elemB.attributes)) attrNames.add(attr.name);

      for (const name of attrNames) {
        const valA = elemA.getAttribute(name);
        const valB = elemB.getAttribute(name);

        if (valA !== null && valB !== null) {
          // Both have the attribute — interpolate
          if (valA === valB) {
            interpolated.setAttribute(name, valA);
          } else {
            try {
              const interp = interpolate(valA, valB);
              interpolated.setAttribute(name, interp(t));
            } catch {
              // If interpolation fails, snap
              interpolated.setAttribute(name, t < 0.5 ? valA : valB);
            }
          }
        } else if (valA !== null) {
          // Only in A
          interpolated.setAttribute(name, valA);
        } else if (valB !== null) {
          // Only in B — fade in
          interpolated.setAttribute(name, valB);
        }
      }

      // Recurse into children
      processNode(elemA, interpolated, doc, mapA, mapB, t, processedIds, serializer);

      parent.appendChild(interpolated);
    } else if (id) {
      // A-only element — fade out
      processedIds.add(id);
      const clone = doc.importNode(elemA, true);
      clone.setAttribute('opacity', String(1 - t));
      parent.appendChild(clone);
    } else {
      // No ID — clone as-is
      const clone = doc.importNode(elemA, true);
      parent.appendChild(clone);
    }
  }
}

/**
 * Extract inner content from an SVG string (everything inside the root <svg> tag)
 */
export function extractSvgInnerContent(svgString: string): string {
  const match = svgString.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  return match ? match[1].trim() : '';
}
