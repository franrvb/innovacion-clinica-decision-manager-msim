// Builds a single self-contained page: index.html with core.js inlined.
// Run: node build.mjs   →   dist/innovacion-clinica-management.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const core = readFileSync(join(here, 'core.js'), 'utf8');
const tag = '<script src="core.js"></script>';
if (!html.includes(tag)) throw new Error('core.js script tag not found in index.html');
mkdirSync(join(here, 'dist'), { recursive: true });
const out = join(here, 'dist', 'innovacion-clinica-management.html');
writeFileSync(out, html.replace(tag, () => '<script>\n' + core + '\n</script>'));
console.log('Built', out);
