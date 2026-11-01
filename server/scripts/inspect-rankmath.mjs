/* global URL, console, fetch, AbortSignal, Buffer */
// Read-only plugin inventory. Credentials and unrelated plugins are never printed.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import process from 'node:process';
const env = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
const username = env.WORDPRESS_USERNAME || env.WP_USERNAME;
const password = env.WORDPRESS_APPLICATION_PASSWORD || env.WP_APPLICATION_PASSWORD;
if (!username || !password) { console.error('WordPress credentials are missing.'); process.exit(1); }
try {
  const response = await fetch('https://guzmantaxaccounting.com/wp-json/wp/v2/plugins?context=edit', {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password.replace(/\s/g, '')}`).toString('base64')}` },
  });
  const parts = []; let bytes = 0;
  if (response.body) for await (const part of response.body) { bytes += part.length; if (bytes > 2 * 1024 * 1024) throw new Error('Response too large'); parts.push(part); }
  if (!response.ok) { console.error(`Plugin inventory request failed: HTTP ${response.status}`); process.exitCode = 1; }
  else {
    const plugins = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!Array.isArray(plugins)) throw new Error('Unexpected response');
    const matched = plugins.filter(item => /rank.?math|seo-by-rank-math/i.test(`${item.name} ${item.plugin} ${item.textdomain}`));
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), method: 'GET', plugins: matched.map(item => ({ name: item.name, plugin: item.plugin, version: item.version, status: item.status })), paidSubscriptionTier: 'Not established by plugin inventory' }, null, 2));
  }
} catch { console.error('Could not inspect the plugin inventory safely; no credentials were logged.'); process.exitCode = 1; }
