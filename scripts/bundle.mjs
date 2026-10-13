import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('assets', { recursive: true });
await build({ entryPoints: ['src/viewer.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: 'assets/viewer.js', minify: true, legalComments: 'inline' });
await copyFile('node_modules/bpmn-js/dist/assets/diagram-js.css', 'assets/viewer.css');
await copyFile('node_modules/bpmn-js/LICENSE', 'assets/bpmn-js-LICENSE.txt');
