/**
 * A deliberately small User-Agent reader.
 *
 * The header is whatever the client chose to send, so this is labelling,
 * not identification. It recognises the common families and says
 * "unknown" for everything else.
 */
export interface ParsedUa {
  family: string;
  major: string | null;
  os: string;
  mobile: boolean;
}

const BROWSERS: readonly (readonly [string, RegExp])[] = [
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+)[.\d]* (?:Mobile\/\w+ )?Safari/],
];
const TOOLS = /\b(curl|wget|python-requests|python-urllib|Go-http-client|node|axios|okhttp|Java|libwww|HeadlessChrome|PhantomJS|bot|crawler|spider)\b/i;

export function parseUserAgent(ua: string | undefined): ParsedUa {
  if (!ua) return { family: 'none', major: null, os: 'unknown', mobile: false };
  const tool = TOOLS.exec(ua);
  let family = 'unknown';
  let major: string | null = null;
  if (tool && !/Mozilla\/5\.0/.test(ua)) {
    family = 'HTTP client';
  } else if (/HeadlessChrome/.test(ua)) {
    family = 'Headless Chrome';
    major = /HeadlessChrome\/(\d+)/.exec(ua)?.[1] ?? null;
  } else if (tool && /bot|crawler|spider/i.test(tool[0])) {
    family = 'Crawler';
  } else {
    for (const [name, pattern] of BROWSERS) {
      const match = pattern.exec(ua);
      if (match) {
        family = name;
        major = match[1] ?? null;
        break;
      }
    }
  }
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown';
  return { family, major, os, mobile: /Mobi|iPhone|Android.+Mobile/.test(ua) };
}
