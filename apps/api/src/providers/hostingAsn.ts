/**
 * A short first-party list of well-known hosting and cloud networks.
 *
 * Used only when the IP intelligence plan does not classify networks
 * itself. It is knowingly incomplete: being on the list is decent
 * evidence of hosting, and not being on it is evidence of nothing.
 */
export const KNOWN_HOSTING_ASNS: ReadonlyMap<string, string> = new Map([
  ['AS16509', 'Amazon AWS'],
  ['AS14618', 'Amazon AWS'],
  ['AS15169', 'Google Cloud'],
  ['AS396982', 'Google Cloud'],
  ['AS8075', 'Microsoft Azure'],
  ['AS13335', 'Cloudflare'],
  ['AS14061', 'DigitalOcean'],
  ['AS16276', 'OVH'],
  ['AS24940', 'Hetzner'],
  ['AS63949', 'Akamai / Linode'],
  ['AS20473', 'Vultr'],
  ['AS31898', 'Oracle Cloud'],
  ['AS45102', 'Alibaba Cloud'],
  ['AS54113', 'Fastly'],
  ['AS9009', 'M247'],
  ['AS60068', 'Datacamp / CDN77'],
  ['AS212238', 'Datacamp / CDN77'],
  ['AS51167', 'Contabo'],
  ['AS12876', 'Scaleway'],
  ['AS36352', 'ColoCrossing'],
]);
