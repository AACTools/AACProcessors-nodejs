import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Shared XML parser for the format validators.
 *
 * The validators previously used `xml2js`, whose output shape is convenient but
 * pulls Node core modules into the browser bundle (`xml2js` requires `events`
 * and `timers`; its `sax` dependency requires `stream`). Those modules cannot
 * be resolved by Metro/Hermes in React Native/Expo, so the browser distribution
 * could not be bundled. `fast-xml-parser` is already a dependency, is pure
 * JavaScript, and has no Node core dependencies.
 *
 * These options keep the parsed shape close to `xml2js` so the validator logic
 * reads the same:
 *   - attributes are grouped under `$` (e.g. `node.$?.id`)
 *   - every non-root element is always an array (`explicitArray` behaviour)
 *   - values stay strings rather than being coerced to numbers/booleans
 *
 * `fast-xml-parser` is permissive (it will happily parse malformed XML), so
 * well-formedness is checked explicitly and invalid XML throws, matching the
 * previous `xml2js` behaviour that the validators rely on.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributesGroupName: '$',
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  jPath: true,
  isArray: (_name, jPath, _isLeafNode, isAttribute) => {
    if (isAttribute) {
      return false;
    }
    const path = typeof jPath === 'string' ? jPath : jPath.toString();
    return path.includes('.');
  },
});

export interface XmlParseError extends Error {
  line?: number;
  column?: number;
}

/**
 * Parse an XML string, throwing on malformed input.
 *
 * @param xml XML document as a string
 * @returns Parsed XML object (xml2js-compatible shape)
 */
export function parseXmlString(xml: string): any {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const err = (validation as { err?: { msg?: string; line?: number; col?: number } })?.err;
    const error = new Error(err?.msg ? `Invalid XML: ${err.msg}` : 'Invalid XML') as XmlParseError;
    error.line = err?.line;
    error.column = err?.col;
    throw error;
  }
  return parser.parse(xml);
}
