import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { detectDevice, issueCertificate, verifyCertificate, makeShareURL, exportCertificateJSON } from '../dist/core.mjs';

const macSafari = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  platform: 'MacIntel', maxTouchPoints: 0,
};
const macChrome = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  platform: 'MacIntel', maxTouchPoints: 0,
  userAgentData: { platform: 'macOS', mobile: false, brands: [{ brand: 'Google Chrome', version: '143' }] },
};
const device = detectDevice(macSafari);
const currentDate = new Date();

function encode(value) { return Buffer.from(typeof value === 'string' ? value : canonical(value)).toString('base64url'); }
function canonical(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return JSON.stringify(value);
}
function decodePayload(token) { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
function mutatePayload(token, mutate, canonicalEncoding = true) {
  const parts = token.split('.');
  const payload = decodePayload(token);
  mutate(payload);
  parts[1] = encode(canonicalEncoding ? canonical(payload) : JSON.stringify(payload));
  return parts.join('.');
}

test('recognizes Safari, Chrome and Firefox macOS without inventing a model/version', () => {
  const safari = detectDevice(macSafari);
  assert.equal(safari.isMac, true);
  assert.equal(safari.os, 'macOS');
  assert.equal(safari.browser, 'Safari');
  assert.equal(safari.source, 'platform-and-user-agent');
  assert.equal(safari.assurance, 'browser');
  assert.equal(safari.signals.length, 4);
  assert.equal('model' in safari, false);
  assert.equal('version' in safari, false);
  const chrome = detectDevice(macChrome);
  assert.equal(chrome.isMac, true);
  assert.equal(chrome.browser, 'Chrome');
  assert.equal(chrome.source, 'user-agent-client-hints');
  const firefox = detectDevice({ ...macSafari, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:138.0) Gecko/20100101 Firefox/138.0' });
  assert.equal(firefox.isMac, true);
  assert.equal(firefox.browser, 'Firefox');
});

test('rejects Windows, Linux, Android, iPhone, iPad desktop mode and absent signals', () => {
  const cases = [
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/143.0.0.0 Safari/537.36', platform: 'Win32' }, 'Windows'],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/138.0', platform: 'Linux x86_64' }, 'Linux'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/143.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', userAgentData: { platform: 'Android', mobile: true } }, 'Android'],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }, 'iOS'],
    [{ ...macSafari, maxTouchPoints: 5 }, 'iPadOS'],
    [{}, 'Unknown'],
  ];
  for (const [nav, expectedOS] of cases) {
    const result = detectDevice(nav);
    assert.equal(result.isMac, false);
    assert.equal(result.os, expectedOS);
  }
});

test('rejects contradictory hints and mobile-reported Macs', () => {
  assert.equal(detectDevice({ ...macChrome, userAgentData: { platform: 'Windows', mobile: false } }).isMac, false);
  assert.equal(detectDevice({ ...macChrome, userAgentData: { platform: 'macOS', mobile: true } }).isMac, false);
  assert.equal(detectDevice({ ...macSafari, platform: 'Win32' }).isMac, false);
  assert.equal(detectDevice({ ...macChrome, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }).isMac, false);
});

test('can use hints-only or user-agent-only Macs; blocked navigator getters stay safe', () => {
  assert.equal(detectDevice({ userAgentData: { platform: 'macOS', mobile: false } }).isMac, true);
  const fallback = detectDevice({ userAgent: macSafari.userAgent });
  assert.equal(fallback.isMac, true);
  assert.equal(fallback.platform, 'macOS');
  assert.equal(fallback.source, 'user-agent');
  const locked = new Proxy({}, { get() { throw new Error('blocked'); } });
  assert.equal(detectDevice(locked).isMac, false);
});

test('issues and verifies a portable Unicode certificate; keeps no private key or raw UA', async () => {
  const issued = await issueCertificate({ name: '  Ngô Tấn Phúc 🌱  ', device, now: currentDate });
  assert.match(issued.token, /^IUM1\.[\w-]+\.[\w-]+$/);
  assert.match(issued.id, /^MAC-(?:[0-9A-F]{4}-){4}[0-9A-F]{4}$/);
  assert.equal(issued.certificate.name, 'Ngô Tấn Phúc 🌱');
  assert.equal(issued.certificate.issuedAt, currentDate.toISOString());
  assert.deepEqual(Object.keys(issued.certificate.publicKey).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal('userAgent' in issued.certificate, false);
  assert.equal('privateKey' in issued, false);
  const result = await verifyCertificate(issued.token);
  assert.equal(result.valid, true);
  assert.equal(result.id, issued.id);
  assert.deepEqual(result.certificate, issued.certificate);
  assert.equal(result.assurance, 'self-issued');
  assert.deepEqual(result.warnings, []);
});

test('verification works in a separate process with no saved key or local state', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device });
  const engineURL = new URL('../dist/core.mjs', import.meta.url).href;
  const script = `import { verifyCertificate } from ${JSON.stringify(engineURL)}; let input = ''; for await (const c of process.stdin) input += c; const result = await verifyCertificate(input); process.stdout.write(JSON.stringify({ valid: result.valid, id: result.id }));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: issued.token, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { valid: true, id: issued.id });
});

test('rejects changed content and changed signature', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device });
  const changedName = mutatePayload(issued.token, payload => { payload.name = 'Another person'; });
  assert.equal((await verifyCertificate(changedName)).code, 'INVALID_SIGNATURE');
  const parts = issued.token.split('.');
  const signature = Buffer.from(parts[2], 'base64url');
  signature[0] ^= 1;
  parts[2] = signature.toString('base64url');
  assert.equal((await verifyCertificate(parts.join('.'))).code, 'INVALID_SIGNATURE');
});

test('derives different IDs for independent certificates with the same visible details', async () => {
  const a = await issueCertificate({ name: 'Phúc', device, now: currentDate });
  const b = await issueCertificate({ name: 'Phúc', device, now: currentDate });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.certificate.nonce, b.certificate.nonce);
  assert.notDeepEqual(a.certificate.publicKey, b.certificate.publicKey);
});

test('accepts a GitHub Pages subpath share link and portable JSON export', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device });
  const link = makeShareURL(issued.token, 'https://philngt.github.io/iamusingmac/?old=yes#old');
  assert.ok(link.startsWith('https://philngt.github.io/iamusingmac/#verify=IUM1.'));
  assert.equal((await verifyCertificate(link)).id, issued.id);
  const exported = exportCertificateJSON(issued.token);
  assert.deepEqual(Object.keys(JSON.parse(exported)).sort(), ['format', 'token', 'version']);
  assert.equal((await verifyCertificate(exported)).id, issued.id);
  assert.equal((await verifyCertificate(` \n${issued.token}\n `)).valid, true);
});

test('identifies a short code without claiming a nonexistent global lookup', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device });
  const result = await verifyCertificate(issued.id.toLowerCase());
  assert.equal(result.valid, false);
  assert.equal(result.code, 'SHORT_CODE');
});

test('rejects malformed, oversized, unknown-version, wrong-schema and invalid UTF-8 inputs', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device });
  const badInputs = [
    ['', 'EMPTY_INPUT'],
    [null, 'INVALID_INPUT'],
    ['x'.repeat(12001), 'INPUT_TOO_LARGE'],
    ['no certificate', 'INVALID_FORMAT'],
    [issued.token.replace('IUM1.', 'IUM2.'), 'UNSUPPORTED_VERSION'],
    [mutatePayload(issued.token, payload => { payload.v = 2; }), 'UNSUPPORTED_VERSION'],
    [mutatePayload(issued.token, payload => { payload.extra = true; }), 'INVALID_CERTIFICATE'],
    [mutatePayload(issued.token, payload => { payload.os = 'Windows'; }), 'INVALID_CERTIFICATE'],
    [mutatePayload(issued.token, payload => { payload.method = 'hardware-attestation'; }), 'INVALID_CERTIFICATE'],
    [mutatePayload(issued.token, payload => { payload.issuedAt = '2026-02-30T12:00:00.000Z'; }), 'INVALID_DATE'],
    [mutatePayload(issued.token, payload => { payload.publicKey.crv = 'P-384'; }), 'INVALID_KEY'],
    [mutatePayload(issued.token, payload => { payload.publicKey.d = 'private-key'; }), 'INVALID_KEY'],
    [mutatePayload(issued.token, payload => { payload.publicKey.x = encode('short'); }), 'INVALID_KEY'],
    [mutatePayload(issued.token, payload => { payload.nonce = 'invalid@'; }), 'INVALID_ENCODING'],
    [mutatePayload(issued.token, payload => { payload.name = 'bad\nname'; }), 'INVALID_NAME'],
    ['https://example.com/#verify=x&verify=y', 'INVALID_LINK'],
    ['https://example.com/', 'INVALID_LINK'],
    ['{"format":"else","version":1,"token":"x"}', 'INVALID_FILE'],
    ['{broken', 'INVALID_FILE'],
    [`IUM1.${Buffer.from([0xc3, 0x28]).toString('base64url')}.${issued.token.split('.')[2]}`, 'INVALID_CERTIFICATE'],
  ];
  for (const [input, code] of badInputs) {
    const result = await verifyCertificate(input);
    assert.equal(result.valid, false);
    assert.equal(result.code, code, `Expected ${code} for ${String(input).slice(0, 90)}`);
  }
});

test('rejects noncanonical JSON, base64 variants and malformed signature lengths', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device });
  const noncanonical = mutatePayload(issued.token, payload => { payload.name = payload.name; }, false);
  // Parsed payload already follows canonical key order; adding whitespace must fail.
  const parts = noncanonical.split('.');
  parts[1] = encode(` ${Buffer.from(parts[1], 'base64url').toString('utf8')}`);
  assert.equal((await verifyCertificate(parts.join('.'))).code, 'INVALID_ENCODING');
  parts[1] = issued.token.split('.')[1];
  parts[2] = 'A';
  assert.equal((await verifyCertificate(parts.join('.'))).code, 'INVALID_ENCODING');
  parts[2] = encode('short');
  assert.equal((await verifyCertificate(parts.join('.'))).code, 'INVALID_SIGNATURE');
  assert.equal((await verifyCertificate(`${issued.token}=`)).code, 'INVALID_FORMAT');
});

test('validates issuance inputs and normalizes composed Unicode names', async () => {
  for (const name of ['', ' ', 'a'.repeat(61), 'bad\nname', '\ud800', 'name\u202e']) {
    await assert.rejects(issueCertificate({ name, device }), error => error.code === 'INVALID_NAME');
  }
  await assert.rejects(issueCertificate({ name: 'Phúc', device: detectDevice({ platform: 'Win32' }) }), error => error.code === 'NOT_MAC');
  await assert.rejects(issueCertificate({ name: 'Phúc', device, now: new Date('invalid') }), error => error.code === 'INVALID_DATE');
  const issued = await issueCertificate({ name: 'Phu\u0301c', device });
  assert.equal(issued.certificate.name, 'Phúc');
  assert.equal((await verifyCertificate(issued.token)).valid, true);
});

test('does not mistake a valid self-issued future clock value for trusted time', async () => {
  const issued = await issueCertificate({ name: 'Phúc', device, now: new Date(Date.now() + 86400000) });
  const result = await verifyCertificate(issued.token);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
});

test('rejects non-web share destinations and embedded credentials', async () => {
  const { token } = await issueCertificate({ name: 'Phúc', device });
  for (const url of ['file:///tmp/index.html', 'javascript:alert(1)', 'https://user:pass@example.com/']) {
    assert.throws(() => makeShareURL(token, url), error => error.code === 'INVALID_LINK');
  }
});
