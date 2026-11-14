// Static hosts have no idea about client-side routes. Copy the built
// index.html to every route so deep links load directly, plus a 404.html
// fallback for hosts (like GitHub Pages) that serve it for unknown paths.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = 'dist';
const routes = ['avalanche', 'work/bivvi', 'work/txr-studio', 'work/summa'];

for (const route of routes) {
  const target = join(dist, route, 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(dist, 'index.html'), target);
}
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
console.log(`postbuild: wrote ${routes.length} route entry points + 404.html`);
