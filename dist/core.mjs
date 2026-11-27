/**
 * I’m using a Mac. — dependency-free certificate engine.
 *
 * A certificate is self-issued. Its embedded public key verifies consistency
 * of its contents, NOT the identity of its author or the physical device.
 * Browser signals and the local clock are assertions, not attestation.
 */

const VERSION = 1;
const PREFIX = 'IUM1';
const FORMAT = 'iamusingmac-certificate';
const MAX_INPUT_LENGTH = 12000;
const SOURCES = new Set(['user-agent-client-hints', 'platform-and-user-agent', 'platform', 'user-agent']);
const BROWSERS = new Set(['Chrome', 'Chromium', 'Safari', 'Firefox', 'Edge', 'Opera', 'Brave', 'Other']);
const MAC_PLATFORMS = new Set(['MacIntel', 'MacPPC', 'Mac68K', 'Macintosh', 'macOS']);
const PAYLOAD_KEYS = ['v', 'name', 'os', 'browser', 'issuedAt', 'method', 'platform', 'source', 'nonce', 'publicKey'];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const signingAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };

class CertificateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CertificateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CertificateError(code, message);
}

function safelyRead(object, key, fallback = '') {
  try { return object?.[key] ?? fallback; } catch { return fallback; }
}

function shortString(value, length = 4096) {
  return typeof value === 'string' ? value.slice(0, length) : '';
}

function uaOS(ua) {
  if (/iPad/i.test(ua)) return 'iPadOS';
  if (/iPhone|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows|Win32|Win64/i.test(ua)) return 'Windows';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux|X11/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function platformOS(platform) {
  if (/iPad/i.test(platform)) return 'iPadOS';
  if (/iPhone|iPod|^iOS$/i.test(platform)) return 'iOS';
  if (/Android/i.test(platform)) return 'Android';
  if (/^Win|Windows/i.test(platform)) return 'Windows';
  if (/CrOS|Chrome\s?OS/i.test(platform)) return 'ChromeOS';
  if (/^Mac|^Darwin$/i.test(platform)) return 'macOS';
  if (/Linux|X11/i.test(platform)) return 'Linux';
  return 'Unknown';
}

function browserName(ua, hints) {
  const brandList = safelyRead(hints, 'brands', []);
  const brands = Array.isArray(brandList)
    ? brandList.map(item => shortString(safelyRead(item, 'brand'), 80)).join(' ')
    : '';
  if (/Brave/i.test(brands)) return 'Brave';
  if (/Edg(?:e|A|iOS)?\//i.test(ua) || /Microsoft Edge/i.test(brands)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua) || /Opera/i.test(brands)) return 'Opera';
  if (/Firefox\/|FxiOS\//i.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//i.test(ua) || /Google Chrome/i.test(brands)) return 'Chrome';
  if (/Chromium\//i.test(ua) || /Chromium/i.test(brands)) return 'Chromium';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Other';
}

/** Inspect only low-entropy browser signals; never asks for model/serial/IP. */
export function detectDevice(nav = globalThis.navigator) {
  const ua = shortString(safelyRead(nav, 'userAgent'));
  const legacyPlatform = shortString(safelyRead(nav, 'platform'), 80);
  const hints = safelyRead(nav, 'userAgentData', null);
  const hintedPlatform = shortString(safelyRead(hints, 'platform'), 80);
  const touchPoints = Number(safelyRead(nav, 'maxTouchPoints', 0)) || 0;
  const mobileHint = safelyRead(hints, 'mobile', false) === true;
  const agentOS = uaOS(ua);
  const legacyOS = platformOS(legacyPlatform);
  const hintedOS = platformOS(hintedPlatform);
  // Android and ChromeOS commonly expose a Linux navigator.platform value.
  // Those expected kernel/platform aliases are not contradictory OS evidence.
  const linuxAlias = [agentOS, hintedOS].find(os => os === 'Android' || os === 'ChromeOS');
  const comparableLegacyOS = legacyOS === 'Linux' && linuxAlias ? linuxAlias : legacyOS;
  const reported = [agentOS, comparableLegacyOS, hintedOS].filter(os => os !== 'Unknown');
  const macEvidence = reported.includes('macOS');
  const iPadDesktop = macEvidence && touchPoints > 1;
  const isMobile = iPadDesktop || mobileHint || /iPhone|iPod|iPad|Android|Mobile/i.test(ua);
  const conflict = new Set(reported).size > 1 || (mobileHint && macEvidence);
  const isMac = macEvidence && !isMobile && !conflict;

  let os = iPadDesktop ? 'iPadOS' : hintedOS !== 'Unknown' ? hintedOS : agentOS !== 'Unknown' ? agentOS : legacyOS;
  if (conflict && !iPadDesktop) os = 'Unknown';
  let source = 'unavailable';
  if (hintedOS !== 'Unknown') source = 'user-agent-client-hints';
  else if (agentOS !== 'Unknown' && legacyOS !== 'Unknown') source = 'platform-and-user-agent';
  else if (legacyOS !== 'Unknown') source = 'platform';
  else if (agentOS !== 'Unknown') source = 'user-agent';

  const platform = isMac
    ? (MAC_PLATFORMS.has(legacyPlatform) ? legacyPlatform : 'macOS')
    : (hintedPlatform || legacyPlatform || 'Unknown');
  let reason;
  if (isMac) reason = 'Trình duyệt báo đang chạy trên macOS. Đây không phải xác thực phần cứng.';
  else if (iPadDesktop) reason = 'Đây có thể là iPad ở chế độ desktop, không phải máy Mac.';
  else if (conflict) reason = 'Các tín hiệu thiết bị không khớp nhau. Chưa thể nhận diện đây là máy Mac.';
  else if (os !== 'Unknown') reason = `Trình duyệt báo hệ điều hành ${os}. Hãy mở trang này trên máy Mac để tạo chứng nhận.`;
  else reason = 'Chưa đủ thông tin để nhận diện macOS trong trình duyệt này.';

  return {
    isMac, os, browser: browserName(ua, hints), source, platform, reason,
    assurance: 'browser',
    signals: [
      { label: 'Nền tảng trình duyệt', value: hintedPlatform || legacyPlatform || 'Không cung cấp', pass: hintedOS === 'macOS' || legacyOS === 'macOS' },
      { label: 'Hệ điều hành được khai báo', value: agentOS === 'Unknown' ? 'Không xác định' : agentOS, pass: agentOS === 'macOS' },
      { label: 'Loại thiết bị', value: iPadDesktop ? 'iPad · chế độ desktop' : isMobile ? 'Thiết bị di động' : 'Máy tính', pass: !isMobile && macEvidence },
      { label: 'Tín hiệu nhất quán', value: conflict ? 'Không nhất quán' : reported.length ? 'Nhất quán' : 'Chưa đủ dữ liệu', pass: !conflict && macEvidence && !iPadDesktop },
    ],
  };
}

function requireCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') {
    fail('CRYPTO_UNAVAILABLE', 'Trình duyệt chưa hỗ trợ xác minh mật mã. Hãy dùng trình duyệt hiện đại và mở trang qua HTTPS hoặc localhost.');
  }
  return crypto;
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(text) {
  if (typeof text !== 'string' || !text || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) {
    fail('INVALID_ENCODING', 'Mã chứng nhận có dữ liệu mã hóa không hợp lệ.');
  }
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    if (base64url(bytes) !== text) fail('INVALID_ENCODING', 'Mã chứng nhận có dữ liệu mã hóa không hợp lệ.');
    return bytes;
  } catch (error) {
    if (error instanceof CertificateError) throw error;
    fail('INVALID_ENCODING', 'Mã chứng nhận có dữ liệu mã hóa không hợp lệ.');
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(object, keys) {
  if (!isRecord(object)) return false;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function normalizeName(name) {
  if (typeof name !== 'string') fail('INVALID_NAME', 'Hãy nhập tên hiển thị trên chứng nhận.');
  const clean = name.normalize('NFC').trim();
  if (!clean || [...clean].length > 60 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(clean)) {
    fail('INVALID_NAME', 'Tên cần có từ 1 đến 60 ký tự, không chứa xuống dòng hoặc ký tự điều khiển.');
  }
  if (decoder.decode(encoder.encode(clean)) !== clean) fail('INVALID_NAME', 'Tên chứa ký tự Unicode không hợp lệ.');
  return clean;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validatePayload(payload) {
  if (!isRecord(payload)) fail('INVALID_CERTIFICATE', 'Dữ liệu chứng nhận không đúng định dạng.');
  if (payload.v !== VERSION) fail('UNSUPPORTED_VERSION', 'Phiên bản chứng nhận này chưa được hỗ trợ.');
  if (!exactKeys(payload, PAYLOAD_KEYS)) fail('INVALID_CERTIFICATE', 'Cấu trúc chứng nhận không hợp lệ.');
  if (normalizeName(payload.name) !== payload.name) fail('INVALID_NAME', 'Tên trong chứng nhận không hợp lệ.');
  if (payload.os !== 'macOS' || payload.method !== 'browser-signals'
      || !BROWSERS.has(payload.browser) || !SOURCES.has(payload.source) || !MAC_PLATFORMS.has(payload.platform)) {
    fail('INVALID_CERTIFICATE', 'Thông tin nền tảng hoặc phương thức chứng nhận không hợp lệ.');
  }
  if (!validDate(payload.issuedAt)) fail('INVALID_DATE', 'Ngày tạo chứng nhận không hợp lệ.');
  if (fromBase64url(payload.nonce).length !== 16) fail('INVALID_CERTIFICATE', 'Mã ngẫu nhiên trong chứng nhận không hợp lệ.');
  const key = payload.publicKey;
  if (!exactKeys(key, ['kty', 'crv', 'x', 'y']) || key.kty !== 'EC' || key.crv !== 'P-256') {
    fail('INVALID_KEY', 'Khóa công khai của chứng nhận không hợp lệ.');
  }
  if (fromBase64url(key.x).length !== 32 || fromBase64url(key.y).length !== 32) {
    fail('INVALID_KEY', 'Khóa công khai của chứng nhận không hợp lệ.');
  }
}

async function certificateID(payloadBytes, crypto = requireCrypto()) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes));
  const hex = Array.from(digest.slice(0, 10), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `MAC-${hex.match(/.{4}/g).join('-')}`;
}

function extractToken(input) {
  if (typeof input !== 'string') fail('INVALID_INPUT', 'Hãy dán mã đầy đủ, đường dẫn xác minh hoặc nội dung tệp chứng nhận.');
  if (input.length > MAX_INPUT_LENGTH) fail('INPUT_TOO_LARGE', 'Nội dung vượt quá giới hạn 12.000 ký tự.');
  let text = input.trim();
  if (!text) fail('EMPTY_INPUT', 'Hãy nhập mã chứng nhận hoặc đường dẫn cần xác minh.');
  if (/^MAC-(?:[0-9A-F]{4}-){4}[0-9A-F]{4}$/i.test(text)) {
    fail('SHORT_CODE', 'Đây là mã định danh rút gọn. Hãy dùng mã đầy đủ, link xác minh hoặc tệp chứng nhận; mã rút gọn chỉ tra cứu được nếu đã lưu trên trình duyệt này.');
  }
  if (text.startsWith('{')) {
    let envelope;
    try { envelope = JSON.parse(text); } catch { fail('INVALID_FILE', 'Tệp chứng nhận không phải JSON hợp lệ.'); }
    if (!exactKeys(envelope, ['format', 'version', 'token']) || envelope.format !== FORMAT || envelope.version !== VERSION || typeof envelope.token !== 'string') {
      fail('INVALID_FILE', 'Tệp này không đúng định dạng chứng nhận I’m using a Mac.');
    }
    text = envelope.token;
  } else if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { fail('INVALID_LINK', 'Đường dẫn xác minh không hợp lệ.'); }
    const fragment = new URLSearchParams(url.hash.slice(1));
    const tokens = fragment.getAll('verify');
    if (tokens.length !== 1 || !tokens[0]) fail('INVALID_LINK', 'Đường dẫn không chứa một mã xác minh đầy đủ.');
    text = tokens[0];
  }
  if (text.length > MAX_INPUT_LENGTH) fail('INPUT_TOO_LARGE', 'Mã chứng nhận quá dài.');
  if (!/^IUM1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
    if (/^IUM\d+\./.test(text) && !text.startsWith(`${PREFIX}.`)) fail('UNSUPPORTED_VERSION', 'Phiên bản chứng nhận này chưa được hỗ trợ.');
    fail('INVALID_FORMAT', 'Mã đầy đủ cần bắt đầu bằng IUM1. và có đủ phần dữ liệu cùng chữ ký.');
  }
  return text;
}

/** Create a fresh key pair in memory; the private key is never exported/stored. */
export async function issueCertificate({ name, device = detectDevice(), now = new Date() } = {}) {
  if (!device || device.isMac !== true || device.os !== 'macOS' || device.assurance !== 'browser') {
    fail('NOT_MAC', 'Chỉ có thể tạo chứng nhận khi trình duyệt hiện tại được nhận diện là macOS.');
  }
  const cleanName = normalizeName(name);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !validDate(now.toISOString())) {
    fail('INVALID_DATE', 'Đồng hồ của thiết bị chưa cung cấp thời gian hợp lệ.');
  }
  const crypto = requireCrypto();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  // WebCrypto keeps an asymmetric public key exportable even when its private
  // key is generated as non-extractable.
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const certificate = {
    v: VERSION,
    name: cleanName,
    os: 'macOS',
    browser: device.browser,
    issuedAt: now.toISOString(),
    method: 'browser-signals',
    platform: device.platform,
    source: device.source,
    nonce: base64url(crypto.getRandomValues(new Uint8Array(16))),
    publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  };
  validatePayload(certificate);
  const bytes = encoder.encode(canonicalJSON(certificate));
  const signature = new Uint8Array(await crypto.subtle.sign(signingAlgorithm, pair.privateKey, bytes));
  const token = `${PREFIX}.${base64url(bytes)}.${base64url(signature)}`;
  const id = await certificateID(bytes, crypto);
  return { token, certificate, id };
}

/**
 * Verify a self-issued token on any device, without fetching anything.
 * No central issuer, revocation service or trusted timestamp is implied.
 */
export async function verifyCertificate(input) {
  try {
    const token = extractToken(input);
    const [, payloadPart, signaturePart] = token.split('.');
    const bytes = fromBase64url(payloadPart);
    const signature = fromBase64url(signaturePart);
    if (signature.length !== 64) fail('INVALID_SIGNATURE', 'Chữ ký chứng nhận không hợp lệ hoặc bị thiếu.');
    let text;
    let certificate;
    try {
      text = decoder.decode(bytes);
      certificate = JSON.parse(text);
    } catch {
      fail('INVALID_CERTIFICATE', 'Không đọc được dữ liệu chứng nhận.');
    }
    validatePayload(certificate);
    if (canonicalJSON(certificate) !== text) fail('INVALID_ENCODING', 'Dữ liệu chứng nhận không ở định dạng chuẩn.');
    const crypto = requireCrypto();
    let key;
    try {
      key = await crypto.subtle.importKey('jwk', certificate.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch {
      fail('INVALID_KEY', 'Không thể đọc khóa công khai của chứng nhận.');
    }
    const valid = await crypto.subtle.verify(signingAlgorithm, key, signature, bytes);
    if (!valid) fail('INVALID_SIGNATURE', 'Nội dung không khớp chữ ký. Mã có thể đã bị sửa hoặc sao chép thiếu.');
    const id = await certificateID(bytes, crypto);
    const warnings = new Date(certificate.issuedAt).getTime() > Date.now() + 5 * 60 * 1000
      ? ['Thời gian tạo nằm trong tương lai theo đồng hồ hiện tại. Thời gian do thiết bị tạo tự khai báo.']
      : [];
    return {
      valid: true, certificate, id, token, assurance: 'self-issued', warnings,
      message: 'Nội dung khớp chữ ký tự tạo. Đây không phải xác thực danh tính hoặc phần cứng từ bên thứ ba.',
    };
  } catch (error) {
    return {
      valid: false,
      code: error instanceof CertificateError ? error.code : 'VERIFICATION_FAILED',
      message: error instanceof CertificateError ? error.message : 'Không thể xác minh chứng nhận trong trình duyệt này.',
      assurance: 'self-issued',
    };
  }
}

/** Preserve repository subpaths so links work on GitHub project Pages. */
export function makeShareURL(token, baseURL = globalThis.location?.href) {
  const cleanToken = extractToken(token);
  let url;
  try { url = new URL(baseURL); } catch { fail('INVALID_LINK', 'Địa chỉ trang hiện tại không hợp lệ.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    fail('INVALID_LINK', 'Đường dẫn chia sẻ cần sử dụng HTTP hoặc HTTPS.');
  }
  url.search = '';
  url.hash = `verify=${cleanToken}`;
  return url.href;
}

/** A portable JSON string suitable for a user-initiated file download. */
export function exportCertificateJSON(token) {
  return JSON.stringify({ format: FORMAT, version: VERSION, token: extractToken(token) }, null, 2);
}
