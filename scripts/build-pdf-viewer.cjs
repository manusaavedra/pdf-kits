const fs = require('node:fs');
const esbuild = require('esbuild');
async function build() {
  const main = await esbuild.build({ entryPoints: ['scripts/pdf-viewer-entry.js'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false, logLevel: 'error' });
  const worker = fs.readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), 'utf8');
  fs.mkdirSync('src/generated', { recursive: true });
  fs.writeFileSync('src/generated/pdf-viewer.json', JSON.stringify({ main: main.outputFiles[0].text, worker }));
  console.log('Visor PDF local generado.');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
