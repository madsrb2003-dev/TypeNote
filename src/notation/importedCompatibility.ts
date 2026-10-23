/** A disposable engraving input. Never save this over the document's XML. */
export function prepareMusicXmlForRendering(xml: string): { xml: string; diagnostics: string[] } {
  if (!xml.includes('chord') || !xml.includes('beam')) return { xml, diagnostics: [] };
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) return { xml, diagnostics: [] };
  if (parsed.documentElement.localName !== 'score-partwise') return { xml, diagnostics: [] };
  const children = (element: Element, name: string) => Array.from(element.children)
    .filter(child => child.localName === name && child.namespaceURI === element.namespaceURI);
  const text = (element: Element, name: string, fallback = '') => children(element, name)[0]?.textContent ?? fallback;
  let removed = 0;
  for (const measure of Array.from(parsed.getElementsByTagNameNS('*', 'measure'))) {
    if (measure.namespaceURI !== parsed.documentElement.namespaceURI) continue;
    let anchor: Element | undefined;
    for (const element of Array.from(measure.children)) {
      if (element.localName !== 'note' || element.namespaceURI !== measure.namespaceURI) { anchor = undefined; continue; }
      if (!children(element, 'chord').length) { anchor = element; continue; }
      if (!anchor || text(anchor, 'voice', '1') !== text(element, 'voice', '1')
        || text(anchor, 'staff', '1') !== text(element, 'staff', '1')
        || text(anchor, 'duration') !== text(element, 'duration')
        || children(anchor, 'grace').length !== children(element, 'grace').length
        || children(anchor, 'cue').length !== children(element, 'cue').length) continue;
      // Audiveris repeats the same beam on every chord member. Verovio 6.3
      // starts a second beam and can lose the chord and later notes. Remove
      // only exact duplicates; distinct/cross-staff beam instructions survive.
      for (const beam of children(element, 'beam')) {
        if (children(anchor, 'beam').some(original => original.isEqualNode(beam))) {
          beam.remove(); removed++;
        }
      }
    }
  }
  return removed ? {
    xml: new XMLSerializer().serializeToString(parsed),
    diagnostics: ['Adjusted duplicate chord beaming for engraving. The original MusicXML source is unchanged.'],
  } : { xml, diagnostics: [] };
}
