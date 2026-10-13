// Entry point that imports the built browser distribution exactly like a React
// Native / Expo app would. `lib/` is a copy of `dist/browser` created by
// scripts/verify-rn-bundle.js before Metro runs.
import { getProcessor, getSupportedExtensions } from './lib/index.browser.js';

const processor = getProcessor('.gridset');
const extensions = getSupportedExtensions();

// Keep the import side-effectful so Metro cannot skip the graph.
if (typeof console !== 'undefined') {
  console.log('aac-processors browser entry bundle probe', typeof processor, extensions.length);
}
