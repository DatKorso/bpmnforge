import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await mkdir('assets', { recursive: true });
await build({ entryPoints: ['src/viewer.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: 'assets/viewer.js', minify: true, legalComments: 'inline' });
await copyFile('node_modules/bpmn-js/dist/assets/diagram-js.css', 'assets/viewer.css');
await copyFile('node_modules/bpmn-js/LICENSE', 'assets/bpmn-js-LICENSE.txt');
// Node intentionally refuses native TS stripping inside node_modules. Publish
// compiled ESM so the same bin works when installed in a consumer project.
await rm('dist', { recursive: true, force: true });
await build({ entryPoints: ['src/cli.ts', 'src/build.ts', 'src/domain.ts', 'src/validate.ts', 'src/layout.ts', 'src/bpmn.ts', 'src/html.ts'], bundle: true, splitting: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24', outdir: 'dist' });
