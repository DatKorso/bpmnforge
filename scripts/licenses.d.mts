import type { Metafile } from 'esbuild';
export function collectBrowserLicenses(metafile: Metafile, cwd?: string): Promise<string>;
