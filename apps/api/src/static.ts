import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The built web app, split into what anyone may fetch and what needs a session.
 *
 * Vite's manifest says which files the gate entry point depends on. Those,
 * and nothing else, are public. Every other file in the build, including
 * all of the portfolio's code and content, is served only to a request
 * that carries a valid session.
 *
 * Files are indexed once at boot, so a request can only ever resolve to a
 * path that was in the build. There is no path arithmetic on user input.
 */

export interface StaticSite {
  /** URL path -> absolute file. */
  files: ReadonlyMap<string, string>;
  publicPaths: ReadonlySet<string>;
  gateHtml: string;
  appHtml: string;
}

interface ManifestEntry {
  file: string;
  css?: string[];
  assets?: string[];
  imports?: string[];
}

const ALWAYS_PUBLIC = ['/assets/favicon.svg', '/robots.txt'];

export function loadStaticSite(directory: string): StaticSite | null {
  const manifestPath = join(directory, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, ManifestEntry>;

  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(`/${relative(directory, full).split(sep).join('/')}`, full);
    }
  };
  walk(directory);

  const publicPaths = new Set<string>(ALWAYS_PUBLIC.filter((path) => files.has(path)));
  const visit = (key: string, seen = new Set<string>()): void => {
    const entry = manifest[key];
    if (!entry || seen.has(key)) return;
    seen.add(key);
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) publicPaths.add(`/${file}`);
    for (const imported of entry.imports ?? []) visit(imported, seen);
  };
  visit('gate.html');

  const gate = files.get('/gate.html');
  const app = files.get('/index.html');
  if (!gate || !app) return null;
  // The HTML documents are served by route, never as files.
  files.delete('/gate.html');
  files.delete('/index.html');
  publicPaths.delete('/gate.html');
  return { files, publicPaths, gateHtml: readFileSync(gate, 'utf8'), appHtml: readFileSync(app, 'utf8') };
}

const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json',
};

export const contentType = (path: string): string => TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
