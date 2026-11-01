/* global URL, console, fetch, AbortSignal, Buffer */
// Explicit read-only diagnostic. Never prints credentials or sends write requests.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const server = fileURLToPath(new URL('../', import.meta.url));
const env = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
if (process.argv.includes('--config-only')) {
  console.log(JSON.stringify(Object.entries(env).filter(([key]) => /^[A-Z][A-Z0-9_]{1,80}$/.test(key)).map(([key, value]) => ({ key, configured: Boolean(value.trim()) })), null, 2));
  process.exit(0);
}

// Credentials are resolved below after configuration names have been verified.
const username = env.WORDPRESS_USERNAME || env.WP_USERNAME;
const password = env.WORDPRESS_APPLICATION_PASSWORD || env.WP_APPLICATION_PASSWORD;
if (!username || !password) { console.error('WordPress username/application password configuration is missing.'); process.exit(1); }
const allowed = new Set(['https://guzmantaxaccounting.com', 'https://www.guzmantaxaccounting.com']);
const credentials = Buffer.from(`${username}:${password.replace(/\s/g, '')}`).toString('base64');
const report = { checkedAt: new Date().toISOString(), policy: 'GET and OPTIONS only; credentials never forwarded across redirects', requests: [], results: {} };
let origin;
async function read(url, authenticated = false, method = 'GET') {
  if (!['GET', 'OPTIONS'].includes(method) || !allowed.has(new URL(url).origin) || (authenticated && new URL(url).origin !== origin)) throw new Error('Diagnostic request policy rejected the destination.');
  const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { accept: 'application/json', ...(authenticated ? { Authorization: `Basic ${credentials}` } : {}) } });
  const chunks = []; let bytes = 0;
  if (response.body) for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 3 * 1024 * 1024) throw new Error('Diagnostic response exceeded size limit.'); chunks.push(chunk); }
  let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Do not print untrusted response bodies. */ }
  report.requests.push({ method, path: new URL(url).pathname, authenticated, status: response.status, code: typeof data?.code === 'string' ? data.code : undefined });
  return { response, data };
}
try {
  let index;
  for (const candidate of allowed) {
    const result = await read(`${candidate}/wp-json/`);
    if (result.response.status === 200 && result.data?.routes) { origin = candidate; index = result.data; break; }
  }
  if (!origin) throw new Error('No usable WordPress REST index found on the approved site origins.');
  report.origin = origin;
  report.results.discovery = { namespaces: index.namespaces, applicationPasswordsAdvertised: Boolean(index.authentication?.['application-passwords']) };
  const me = await read(`${origin}/wp-json/wp/v2/users/me?context=edit`, true);
  report.results.authentication = { verified: me.response.status === 200 && Number.isInteger(me.data?.id), userId: me.data?.id, roles: me.data?.roles, capabilities: me.data?.capabilities };
  if (!report.results.authentication.verified) throw new Error('Authenticated current-user lookup failed. See sanitized request status.');
  const introspection = await read(`${origin}/wp-json/wp/v2/users/me/application-passwords/introspect`, true);
  report.results.applicationPassword = { verified: introspection.response.status === 200, created: introspection.data?.created };
  for (const resource of ['pages', 'posts', 'media', 'types', 'taxonomies', 'settings', 'plugins', 'themes']) {
    const list = ['pages', 'posts', 'media'].includes(resource);
    const result = await read(`${origin}/wp-json/wp/v2/${resource}?context=edit${list ? '&per_page=3' : ''}`, true);
    report.results[resource] = { status: result.response.status, total: result.response.headers.get('x-wp-total'), ...(list && Array.isArray(result.data) ? { samples: result.data.map(item => ({ id: item.id, slug: item.slug, status: item.status, link: item.link, metaKeys: Object.keys(item.meta ?? {}), extraFields: Object.keys(item).filter(key => /yoast|rank|seo|acf/i.test(key)), availableActions: Object.keys(item._links ?? {}).filter(key => key.startsWith('https://api.w.org/action-')) })) } : {}) };
    const options = await read(`${origin}/wp-json/wp/v2/${resource}`, true, 'OPTIONS');
    report.results[resource].schemaMethods = options.data?.endpoints?.map(item => item.methods);
    report.results[resource].schemaFields = Object.keys(options.data?.schema?.properties ?? {});
  }
  report.results.seoRoutes = Object.keys(index.routes).filter(route => /yoast|rankmath|rank-math|aioseo|seopress|seo-framework/i.test(route));
} catch (error) {
  report.failure = error?.message === 'fetch failed' ? 'Network request failed; no credentials were logged.' : error instanceof Error ? error.message : 'Diagnostic failed.';
  process.exitCode = 1;
}
mkdirSync(`${server}/reports/wordpress`, { recursive: true });
writeFileSync(`${server}/reports/wordpress/access-verification.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
