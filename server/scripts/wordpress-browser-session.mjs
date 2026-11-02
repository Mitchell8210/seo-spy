// Explicit local operator bootstrap. The private operator key never reaches the browser.
import process from 'node:process';
import console from 'node:console';
import { parseArgs } from 'node:util';
import { URL } from 'node:url';
const { values } = parseArgs({ strict: true, options: { 'business-id': { type: 'string' }, 'api-origin': { type: 'string', default: 'http://127.0.0.1:3001' } } });
const origin = new URL(values['api-origin']);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username || origin.password || origin.origin !== values['api-origin'] || !values['business-id']) throw new Error('Select the exact loopback API origin and registered business.');
const token = process.env.WORDPRESS_OPERATOR_KEY;
if (!token || token.length < 32) throw new Error('Supply the existing WordPress operator credential privately in the process environment.');
const response = await globalThis.fetch(`${origin.origin}/api/wordpress/browser-tickets`, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ businessId: values['business-id'] }), signal: globalThis.AbortSignal.timeout(15000) });
if (!response.ok) throw new Error('Local session bootstrap failed. No retry or provider call was made.');
const result = await response.json();
if (typeof result.url !== 'string' || !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+\/dashboard#wordpress-session=[A-Za-z0-9_-]{43}$/.test(result.url)) throw new Error('Unexpected bootstrap response.');
console.log('Open this private one-use local link within 60 seconds. Do not save, share or log it. It grants no paid AI or write authorization.');
console.log(result.url);
delete process.env.WORDPRESS_OPERATOR_KEY;
