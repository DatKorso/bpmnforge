import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// esbuild reports the contribution of each input to the emitted browser bundle.
// Walking to the owning package also handles scoped and nested dependencies.
export async function collectBrowserLicenses(metafile, cwd = process.cwd()) {
  const inputs = new Set(Object.values(metafile.outputs).flatMap(output =>
    Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name)));
  const packages = new Map();
  for (const input of [...inputs].sort()) {
    if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
    let directory = dirname(resolve(cwd, input));
    for (;;) {
      let pkg;
      try { pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (pkg) {
        if (!pkg.name || !pkg.version || !pkg.license) throw new Error(`Missing license metadata: ${input}`);
        const files = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(name)).sort();
        if (!files.some(name => /^(licen[cs]e|copying)([.-].*)?$/i.test(name))) throw new Error(`Missing license text: ${pkg.name}@${pkg.version}`);
        const texts = await Promise.all(files.map(async name => {
          const body = (await readFile(join(directory, name), 'utf8')).replace(/\r\n/g, '\n').trim();
          if (!body) throw new Error(`Empty license text: ${pkg.name}/${name}`);
          return `${name}\n${body}`;
        }));
        const key = `${pkg.name}@${pkg.version}`;
        const notice = `${key}\nLicense: ${pkg.license}\n\n${texts.join('\n\n')}`;
        if (packages.has(key) && packages.get(key) !== notice) throw new Error(`Conflicting licenses: ${key}`);
        packages.set(key, notice);
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`Cannot identify package: ${input}`);
      directory = parent;
    }
  }
  if (!packages.size) throw new Error('Browser bundle contains no licensed dependencies');
  return 'Third-party components included in the BPLM browser bundle.\nTheir respective license terms continue to apply.\n\n' +
    [...packages].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, notice]) => notice).join('\n\n' + '='.repeat(72) + '\n\n') + '\n';
}
