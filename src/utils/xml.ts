import { XMLParser, XMLValidator } from 'fast-xml-parser';

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
