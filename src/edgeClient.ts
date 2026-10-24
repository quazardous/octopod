/**
 * HTTP to the edge, as a browser on the machine would: to 127.0.0.1 on the edge's port, the
 * host named in the request (a `*.localhost` name need not resolve on the host), its cookies
 * kept from one response to the next. What `octopod oidc session` runs an app's sign-in with.
 */
import { request } from 'node:http';

export interface Cookie {
  name: string;
  value: string;
  /** The host it was set by, or the domain it names (then its subdomains too). */
  domain: string;
  path: string;
  /** Set with a Domain: sent to the subdomains. */
  wide: boolean;
}

export interface EdgeAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Only the edge's names: octopod sends nothing elsewhere. */
export function edgeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !(url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))) {
    throw new Error(`${raw}: an address of the edge is needed (http://….localhost)`);
  }
  return url;
}

export function edgeRequest(url: URL, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<EdgeAnswer> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: Number(url.port || 80), path: `${url.pathname}${url.search}`, method: options.method ?? 'GET', headers: { host: url.host, ...options.headers }, timeout: 30_000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${url.host} did not answer in 30 s`)));
    req.on('error', reject);
    req.end(options.body);
  });
}

export class CookieJar {
  readonly cookies: Cookie[] = [];

  /** The cookies a response sets, kept; one emptied or expired, dropped. */
  take(url: URL, setCookie: string | string[] | undefined): void {
    for (const line of [setCookie ?? []].flat()) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim());
      const at = pair!.indexOf('=');
      if (at < 1) continue;
      const name = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      const attr = (k: string) => attrs.find((a) => a.toLowerCase().startsWith(`${k}=`))?.slice(k.length + 1);
      const domain = attr('domain')?.replace(/^\./, '').toLowerCase();
      const cookie: Cookie = { name, value, domain: domain ?? url.hostname, path: attr('path') ?? '/', wide: Boolean(domain) };
      const i = this.cookies.findIndex((c) => c.name === name && c.domain === cookie.domain && c.path === cookie.path);
      if (i >= 0) this.cookies.splice(i, 1);
      if (value !== '' && attr('max-age') !== '0') this.cookies.push(cookie);
    }
  }

  /** What a request to this URL carries. */
  for(url: URL): Cookie[] {
    return this.cookies.filter(
      (c) => (c.domain === url.hostname || (c.wide && url.hostname.endsWith(`.${c.domain}`))) && url.pathname.startsWith(c.path),
    );
  }

  header(url: URL): string {
    return this.for(url)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** curl's and Playwright's cookie file (Netscape). */
  netscape(): string {
    return [
      '# Netscape HTTP Cookie File',
      ...this.cookies.map((c) => [c.wide ? `.${c.domain}` : c.domain, c.wide ? 'TRUE' : 'FALSE', c.path, 'FALSE', '0', c.name, c.value].join('\t')),
      '',
    ].join('\n');
  }
}

/**
 * GET a URL and follow its redirects, the jar kept; `rewrite` may change where a redirect
 * goes (a sign-in ticket added at the provider). Where it ends, and the jar.
 */
export async function follow(start: URL, jar: CookieJar, rewrite: (next: URL) => URL = (u) => u, max = 15): Promise<{ url: URL; answer: EdgeAnswer }> {
  let url = start;
  for (let i = 0; i < max; i++) {
    const cookie = jar.header(url);
    const answer = await edgeRequest(url, { headers: cookie ? { cookie } : {} });
    jar.take(url, answer.headers['set-cookie']);
    const location = answer.headers.location;
    if (answer.status < 300 || answer.status >= 400 || typeof location !== 'string') return { url, answer };
    url = rewrite(edgeUrl(new URL(location, url).toString()));
  }
  throw new Error(`more than ${max} redirects from ${start}`);
}
