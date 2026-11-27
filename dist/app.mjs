import { detectDevice, issueCertificate, verifyCertificate, makeShareURL, exportCertificateJSON } from './core.mjs';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'iamusingmac.certificates.v1';
const MAX_HISTORY = 10;
const canUseCrypto = Boolean(globalThis.crypto?.subtle);
let device;
let currentCertificate = null;
let savedCertificates = [];
let toastTimer;
let verificationSequence = 0;
let issuing = false;
let historyReady = false;
let historyLoaded = Promise.resolve();
const ISSUE_LABEL = 'Cấp giấy cho tôi ✦';
const VERIFY_LABEL = 'Soi xem nào 🔍';
const ROASTS = [
  'Có Mac mà không khoe thì cũng như chưa có.',
  'Windows: “Máy sẽ khởi động lại sau 5 phút.” Mac: “Cứ làm việc đi.”',
  'Đứa bạn dùng Windows sẽ hỏi “rồi sao?”. Gửi nó link. Rồi im lặng.',
  'Linux tự build được cả giấy này. Nhưng hội không cấp.',
  'Notch không phải lỗi. Notch là cá tính.',
  'Hội không kỳ thị. Hội chỉ lọc hồ sơ rất kỹ.',
  'Bạn không cần Mac để sống. Nhưng cần giấy này để chứng minh là có.',
  'Mac không chơi được game? Đúng rồi, vì người dùng Mac bận flex.',
  'Mua Mac xong ăn mì gói cả tháng. Xứng đáng.',
  'Hub USB-C là phụ kiện, cái giấy này là bản lĩnh.',
];
let roastIndex = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value, withTime = false) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

function feedback(message, isError = false) {
  $('#issue-feedback').textContent = message;
  $('#issue-feedback').className = `form-feedback ${isError ? 'error' : 'success'}`;
}

function selectMode(mode, { scroll = false, updateHash = true, focus = false } = {}) {
  for (const item of ['create', 'verify']) {
    const active = item === mode;
    $(`#tab-${item}`).setAttribute('aria-selected', String(active));
    $(`#tab-${item}`).tabIndex = active ? 0 : -1;
    $(`#tab-${item}`).classList.toggle('active', active);
    $(`#panel-${item}`).hidden = !active;
  }
  if (updateHash) history.replaceState(null, '', `#${mode}`);
  if (scroll) $('#workspace').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  if (focus) $(`#tab-${mode}`).focus();
}

function inspectDevice() {
  device = detectDevice();
  const copy = device.isMac
    ? { title: 'Chuẩn Mac. Hội gật đầu.', description: 'Trình duyệt khai báo macOS. Giờ chỉ thiếu một cái tên để in lên giấy.', symbol: '⌘', eyebrow: '✓ HỒ SƠ HỢP LỆ' }
    : device.os === 'Windows'
      ? { title: 'Ồ… Windows.', description: 'Hồ sơ gia nhập bị từ chối một cách rất lịch sự. Bạn vẫn được soi giấy của đứa bạn — đó là quyền con người.', symbol: '⊞', eyebrow: 'PHÁT HIỆN CỬA SỔ' }
      : device.os === 'Linux'
        ? { title: 'Linux à? Kính nể. Nhưng không.', description: 'Bạn compile được cả kernel, nhưng giấy này cần một chiếc Mac. sudo cũng không cứu được lần này.', symbol: '>_', eyebrow: 'PERMISSION DENIED' }
        : ['iPadOS', 'iOS'].includes(device.os)
          ? { title: 'Có Táo. Nhưng là táo con.', description: 'iPhone và iPad dễ thương thật. Hội đang tuyển Mac. Bạn vẫn soi được mọi mã.', symbol: '▯', eyebrow: 'GẦN ĐÚNG RỒI ĐÓ' }
          : device.os === 'Android'
            ? { title: 'Robot xanh ghé chơi.', description: 'Bạn đang đứng bên kia hàng rào vườn Táo. Muốn nhận giấy thì mở trên Mac, còn soi mã thì cứ tự nhiên.', symbol: '◉', eyebrow: 'KHÁCH TỪ HỆ KHÁC' }
            : device.os === 'ChromeOS'
              ? { title: 'Chromebook? Hội tưởng đây là một tab Chrome.', description: 'Đáng yêu, nhẹ nhàng, nhưng không phải Mac. Soi mã thì vẫn thoải mái.', symbol: '◎', eyebrow: 'TAB THỨ 47' }
              : { title: 'Máy gì đây? Hội chịu.', description: 'Trình duyệt không khai rõ macOS. Tắt giả lập rồi bấm soi lại nhé.', symbol: '?', eyebrow: 'HỒ SƠ MẬP MỜ' };
  $('#device-status').className = `device-status ${device.isMac ? 'mac' : 'non-mac'}`;
  $('#device-title').textContent = copy.title;
  $('#device-description').textContent = copy.description;
  $('#device-symbol').textContent = copy.symbol;
  $('#device-eyebrow').textContent = copy.eyebrow;
  const facts = $('#device-facts');
  facts.replaceChildren();
  for (const [label, value] of [['Hệ điều hành', device.os === 'Unknown' ? 'Chưa xác định' : device.os], ['Trình duyệt', device.browser], ...device.signals.map(s => [s.label, s.value])]) {
    const row = element('div');
    row.append(element('dt', '', label), element('dd', '', value));
    facts.append(row);
  }
  updateWatermark();
  $('#issue-button').disabled = !historyReady || !device.isMac || !canUseCrypto || issuing;
  if (!canUseCrypto) feedback('Cần trình duyệt hiện đại và HTTPS (hoặc localhost) để cấp, kiểm tra giấy. Không mở trực tiếp file HTML.', true);
  else if (!device.isMac) feedback('Nút này chỉ mở khi có Mac. Soi mã thì máy nào cũng được.');
  else feedback(historyReady ? 'Đủ điều kiện. Hội đang chờ tên của bạn.' : 'Hội đang lục sổ. Chờ xíu.');
}

function updateWatermark() {
  const marks = {
    Windows: ['Kích hoạt macOS', 'Mua một chiếc Mac để ẩn dòng chữ này.', false],
    Linux: ['$ sudo apt install macos', 'E: Unable to locate package macos', true],
    ChromeOS: ['Kích hoạt macOS', 'Chromebook không đủ điều kiện. Rất tiếc.', false],
  };
  const mark = !device.isMac && marks[device.os];
  $('#os-watermark').hidden = !mark;
  if (!mark) return;
  $('#os-watermark-title').textContent = mark[0];
  $('#os-watermark-text').textContent = mark[1];
  $('#os-watermark').classList.toggle('terminal', mark[2]);
}

function nextRoast() {
  roastIndex = (roastIndex + 1) % ROASTS.length;
  $('#roast-line').textContent = ROASTS[roastIndex];
  $('#roast-index').textContent = String(roastIndex + 1);
}

function tickClock() {
  try {
    $('#menubar-clock').textContent = new Intl.DateTimeFormat('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch { /* The clock is decoration only. */ }
}

function showCertificate(result) {
  currentCertificate = result;
  $('#cert-name').textContent = result.certificate.name;
  $('#cert-os').textContent = result.certificate.os;
  $('#cert-date').textContent = formatDate(result.certificate.issuedAt);
  $('#cert-id').textContent = result.id;
  $('#preview-label').textContent = 'CHÚC MỪNG. GIỜ ĐI KHOE ĐI.';
  $('#preview-state').textContent = 'Đã tự cấp';
  $('#preview-state').classList.add('issued');
  $('#certificate-card').classList.add('issued');
  $('#certificate-actions').hidden = false;
  $('#preview-note').hidden = true;
}

function resetCertificatePreview() {
  currentCertificate = null;
  $('#cert-name').textContent = $('#certificate-name').value.trim() || 'Tên của bạn';
  $('#cert-date').textContent = 'Sau khi cấp giấy';
  $('#cert-id').textContent = 'BẢN MẪU · CHƯA PHÁT HÀNH';
  $('#preview-label').textContent = 'GIẤY TƯƠNG LAI CỦA BẠN';
  $('#preview-state').textContent = 'Xem trước';
  $('#preview-state').classList.remove('issued');
  $('#certificate-card').classList.remove('issued');
  $('#certificate-actions').hidden = true;
  $('#preview-note').hidden = false;
}

function persistHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCertificates.map(item => item.token)));
    return true;
  } catch {
    toast('Trình duyệt không lưu được lịch sử. Hãy tải file hoặc sao chép link để giữ chứng nhận.');
    return false;
  }
}

async function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 150000) return;
    const tokens = JSON.parse(raw);
    if (!Array.isArray(tokens)) return;
    const checked = await Promise.all(tokens.slice(0, MAX_HISTORY).filter(t => typeof t === 'string').map(t => verifyCertificate(t)));
    savedCertificates = checked.filter(r => r.valid);
    renderHistory();
  } catch { /* Storage can be blocked; portable certificates still work. */ }
}

function renderHistory() {
  $('#history-section').hidden = savedCertificates.length === 0;
  $('#history-list').replaceChildren();
  for (const record of savedCertificates) {
    const item = element('article', 'history-item');
    const info = element('div', 'history-info');
    info.append(element('h3', 'history-name', record.certificate.name), element('p', 'history-meta', `${formatDate(record.certificate.issuedAt, true)} · ${record.id}`));
    const actions = element('div', 'history-actions');
    const view = element('button', 'text-button', 'Ngắm lại');
    view.type = 'button';
    view.addEventListener('click', () => { showCertificate(record); selectMode('create', { scroll: true }); });
    const check = element('button', 'button button-white', 'Soi giấy');
    check.type = 'button';
    check.addEventListener('click', () => { selectMode('verify', { scroll: true }); $('#verify-input').value = record.token; runVerification(record.token); });
    actions.append(view, check);
    const avatar = element('span', 'history-avatar', '⌘');
    avatar.setAttribute('aria-hidden', 'true');
    item.append(avatar, info, actions);
    $('#history-list').append(item);
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    $('#copy-fallback').value = text;
    $('#copy-dialog').showModal();
    $('#copy-fallback').focus();
    $('#copy-fallback').select();
  }
}

function shareURL(record) { return makeShareURL(record.token, location.href); }

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function downloadJSON(record) {
  download(new Blob([exportCertificateJSON(record.token)], { type: 'application/json;charset=utf-8' }), `${record.id}.json`);
  toast('Đã chuẩn bị file chứng nhận. Gửi file này để bạn bè kiểm tra.');
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line.trim()); line = ''; }
    line += char;
  }
  if (line) lines.push(line.trim());
  return lines;
}

async function downloadPNG(record) {
  try {
    const W = 1800, H = 1260;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const mono = 'ui-monospace, Menlo, Consolas, monospace';
    const ink = '#141414', paper = '#fffdf7', blue = '#2f55ff', yellow = '#ffd94a', pink = '#ff7eb6', muted = '#5d5a52', soft = '#8a857a';
    // Dotted cream desk.
    ctx.fillStyle = '#f4efe3'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ddd4c0';
    for (let y = 11; y < H; y += 30) for (let x = 11; x < W; x += 30) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
    // Window with a hard shadow.
    roundRect(ctx, 96, 76, 1640, 1120, 34, ink);
    ctx.lineWidth = 6;
    roundRect(ctx, 80, 60, 1640, 1120, 34, paper, ink);
    ctx.save(); ctx.beginPath(); ctx.roundRect(83, 63, 1634, 92, [31, 31, 0, 0]); ctx.clip();
    for (let y = 63, i = 0; y < 155; y += 4, i++) { ctx.fillStyle = i % 2 ? '#e2dac6' : '#efe9da'; ctx.fillRect(83, y, 1634, 4); }
    ctx.restore();
    ctx.fillStyle = ink; ctx.fillRect(80, 152, 1640, 6);
    [['#ff5f57', 140], ['#febc2e', 186], ['#28c840', 232]].forEach(([color, x]) => { ctx.beginPath(); ctx.arc(x, 107, 15, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = ink; ctx.stroke(); });
    ctx.textAlign = 'center'; ctx.fillStyle = ink; ctx.font = `700 26px ${mono}`; ctx.fillText(`${record.id}.png — hội-táo.app`, 900, 116);
    // Header row.
    roundRect(ctx, 160, 205, 84, 84, 20, ink);
    ctx.fillStyle = yellow; ctx.font = `48px ${font}`; ctx.fillText('⌘', 202, 264);
    ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.font = `800 30px ${font}`; ctx.fillText('HỘI NGƯỜI ĐANG DÙNG MAC', 272, 243);
    ctx.fillStyle = soft; ctx.font = `22px ${mono}`; ctx.fillText('THE VERY UNOFFICIAL MAC CLUB', 272, 279);
    ctx.textAlign = 'right'; ctx.fillStyle = blue; ctx.font = `800 30px ${font}`; ctx.fillText('i’m using a mac.', 1640, 258);
    ctx.fillStyle = ink; ctx.fillRect(160, 325, 1480, 4);
    // Name block.
    ctx.textAlign = 'center'; ctx.fillStyle = soft; ctx.font = `700 24px ${mono}`; ctx.fillText('TRÂN TRỌNG XÁC NHẬN', 900, 410);
    let nameSize = 96;
    ctx.font = `900 ${nameSize}px ${font}`;
    while (ctx.measureText(record.certificate.name).width > 1400 && nameSize > 54) { nameSize -= 2; ctx.font = `900 ${nameSize}px ${font}`; }
    const nameLines = wrapCanvasText(ctx, record.certificate.name, 1400);
    ctx.fillStyle = blue;
    nameLines.slice(0, 2).forEach((line, index) => ctx.fillText(line, 900, nameLines.length > 1 ? 490 + index * 72 : 520));
    ctx.font = `700 50px ${font}`;
    const statement = 'đang dùng Mac.';
    const sw = ctx.measureText(statement).width;
    ctx.fillStyle = yellow; ctx.fillRect(900 - sw / 2 - 14, 612, sw + 28, 62);
    ctx.fillStyle = ink; ctx.fillText(statement, 900, 660);
    ctx.fillStyle = muted; ctx.font = `30px ${font}`; ctx.fillText('Và sẽ nhắc chuyện đó ít nhất 3 lần mỗi ngày.', 900, 728);
    // Meta + stamp.
    ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = ink;
    ctx.beginPath(); ctx.moveTo(160, 790); ctx.lineTo(1640, 790); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = soft; ctx.font = `700 21px ${mono}`;
    ctx.fillText('HỆ ĐIỀU HÀNH', 160, 852); ctx.fillText('NGÀY GIA NHẬP', 560, 852);
    ctx.fillStyle = ink; ctx.font = `800 34px ${font}`;
    ctx.fillText('macOS', 160, 900); ctx.fillText(formatDate(record.certificate.issuedAt, true), 560, 900);
    ctx.save(); ctx.translate(1480, 880); ctx.rotate(0.22);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(0, 0, 104, 0, Math.PI * 2); ctx.fillStyle = pink; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = ink; ctx.stroke();
    ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 86, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = `900 40px ${font}`; ctx.fillText('100%', 0, -4); ctx.font = `900 26px ${font}`; ctx.fillText('THIÊN VỊ', 0, 34);
    ctx.restore();
    ctx.setLineDash([]);
    // Footer.
    ctx.fillStyle = ink; ctx.fillRect(160, 990, 1480, 4);
    ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.font = `700 26px ${mono}`; ctx.fillText(record.id, 160, 1046);
    ctx.fillStyle = muted; ctx.font = `23px ${font}`; ctx.fillText('Mã đối chiếu · Soi bằng link chia sẻ hoặc file chứng nhận đi kèm.', 160, 1090);
    ctx.fillStyle = soft; ctx.font = `21px ${font}`; ctx.fillText('Chứng nhận vui từ trình duyệt. Không liên quan đến Apple. Người dùng Windows vui lòng không ghen tị.', 160, 1136);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG unavailable');
    download(blob, `${record.id}.png`);
    toast('Ảnh xong. Nhớ gửi kèm link để đứa bạn còn soi.');
  } catch { toast('Chưa tải được ảnh trên trình duyệt này. Bạn vẫn có thể tải file chứng nhận hoặc sao chép link.'); }
}

function resultField(parent, label, value, className = '') {
  const row = element('div', className);
  row.append(element('dt', '', label), element('dd', '', value));
  parent.append(row);
}

function renderVerification(result) {
  const panel = $('#verification-result');
  panel.replaceChildren();
  panel.className = `verification-result ${result.valid ? 'is-valid' : 'is-invalid'}`;
  const icon = element('div', 'result-icon', result.valid ? '✓' : '!');
  icon.setAttribute('aria-hidden', 'true');
  panel.append(icon, element('p', 'result-eyebrow', result.valid ? 'GIẤY KHỚP. CHO PHÉP FLEX TIẾP.' : 'HỘI NGHI NGỜ'), element('h3', 'result-title', result.valid ? 'Chữ ký hợp lệ. Giấy chưa bị sửa.' : result.code === 'SHORT_CODE' ? 'Mã ngắn thôi chưa đủ đâu.' : 'Mã này trượt vòng gửi xe.'));
  if (!result.valid) {
    panel.append(element('p', 'result-description', result.message), element('p', 'result-footnote', 'Có thể đứa bạn copy thiếu, hoặc nó đang “sáng tạo”. Thử lại bằng link chia sẻ hoặc file .json.'));
    return;
  }
  panel.append(element('p', 'result-description', 'Nội dung khớp với chữ ký tự tạo đi kèm. Còn nó có Mac thật không thì… hỏi lương tâm nó.'));
  const details = element('dl', 'result-details');
  resultField(details, 'Chủ nhân màn flex', result.certificate.name);
  resultField(details, 'Hệ điều hành ghi nhận', result.certificate.os);
  resultField(details, 'Trình duyệt lúc tạo', result.certificate.browser);
  resultField(details, 'Thời gian trên máy tạo', formatDate(result.certificate.issuedAt, true));
  resultField(details, 'Mã đối chiếu', result.id, 'result-id');
  panel.append(details);
  for (const warning of result.warnings || []) panel.append(element('p', 'result-warning', warning));
  panel.append(element('p', 'result-footnote', 'Chứng nhận vui, tự tạo từ tín hiệu trình duyệt. Không chứng minh danh tính, phần cứng thật hay thiết bị đang dùng lúc này.'));
  const actions = element('div', 'result-actions');
  const share = element('button', 'button button-dark', 'Sao chép link');
  const png = element('button', 'button button-white', 'Tải ảnh PNG');
  const file = element('button', 'text-button', 'Tải file chứng nhận');
  for (const button of [share, png, file]) button.type = 'button';
  share.addEventListener('click', () => copyText(shareURL(result), 'Đã sao chép link. Flex có trách nhiệm nhé.'));
  png.addEventListener('click', () => downloadPNG(result));
  file.addEventListener('click', () => downloadJSON(result));
  actions.append(share, png, file); panel.append(actions);
}

async function runVerification(input, sequence = ++verificationSequence) {
  $('#verify-button').disabled = true;
  $('#verify-button').textContent = 'Hội đang soi kính lúp…';
  await historyLoaded;
  if (sequence !== verificationSequence) return;
  let candidate = input.trim();
  if (/^MAC-(?:[0-9A-F]{4}-){4}[0-9A-F]{4}$/i.test(candidate)) {
    const local = savedCertificates.find(record => record.id === candidate.toUpperCase());
    if (local) candidate = local.token;
  }
  const result = await verifyCertificate(candidate);
  if (sequence !== verificationSequence) return;
  renderVerification(result);
  $('#verify-button').disabled = false;
  $('#verify-button').textContent = VERIFY_LABEL;
}

$('#issue-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (issuing || !historyReady) return;
  inspectDevice();
  if (!device.isMac || !canUseCrypto) return;
  issuing = true;
  $('#issue-button').disabled = true;
  $('#issue-button').textContent = 'Hội đang đóng dấu… cộp!';
  try {
    const record = await issueCertificate({ name: $('#certificate-name').value, device });
    showCertificate(record);
    savedCertificates = [record, ...savedCertificates.filter(item => item.id !== record.id)].slice(0, MAX_HISTORY);
    const saved = persistHistory();
    renderHistory();
    feedback(saved ? 'Đã cấp giấy. Chính thức có thêm lý do để nhắn vào group.' : 'Đã cấp giấy. Hãy tải file hoặc sao chép link vì trình duyệt không lưu được lịch sử.');
    if (saved) toast('Chúc mừng. Bạn có Mac. Giờ có cả giấy. Đứa bạn thì không.');
  } catch (error) { feedback(error.message || 'Hội gặp trục trặc. Hãy thử lại nhé.', true); }
  finally {
    issuing = false;
    $('#issue-button').disabled = !device.isMac || !canUseCrypto;
    $('#issue-button').textContent = ISSUE_LABEL;
  }
});

$('#certificate-name').addEventListener('input', () => { if (!currentCertificate) $('#cert-name').textContent = $('#certificate-name').value.trim() || 'Tên của bạn'; });
$('#recheck-button').addEventListener('click', () => { inspectDevice(); toast(device.isMac ? 'Đúng là Mac. Hội đã ghi nhận.' : `Soi lại rồi. Vẫn là ${device.os === 'Unknown' ? 'một hệ bí ẩn' : device.os}. Hội không đổi ý đâu.`); });
$('#copy-link').addEventListener('click', () => { if (currentCertificate) copyText(shareURL(currentCertificate), 'Đã sao chép link. Giờ dán vào group và chờ phản ứng.'); });
$('#copy-code').addEventListener('click', () => { if (currentCertificate) copyText(currentCertificate.token, 'Đã sao chép mã đầy đủ. Máy nào cũng kiểm tra được.'); });
$('#download-json').addEventListener('click', () => { if (currentCertificate) downloadJSON(currentCertificate); });
$('#download-image').addEventListener('click', () => { if (currentCertificate) downloadPNG(currentCertificate); });
$('#verify-form').addEventListener('submit', event => { event.preventDefault(); runVerification($('#verify-input').value); });
$('#verify-input').addEventListener('input', () => {
  verificationSequence++;
  $('#verify-button').disabled = false;
  $('#verify-button').textContent = VERIFY_LABEL;
});
$('#certificate-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';
  const sequence = ++verificationSequence;
  $('#verify-button').disabled = true;
  $('#verify-button').textContent = 'Hội đang đọc file…';
  if (file.size > 24000) {
    $('#verify-button').disabled = false;
    $('#verify-button').textContent = VERIFY_LABEL;
    renderVerification({ valid: false, message: 'File quá lớn. Hãy chọn file chứng nhận .json dưới 24 KB.' });
  } else {
    try {
      const text = await file.text();
      if (sequence !== verificationSequence) return;
      $('#verify-input').value = text;
      await runVerification(text, sequence);
    } catch {
      if (sequence !== verificationSequence) return;
      $('#verify-button').disabled = false;
      $('#verify-button').textContent = VERIFY_LABEL;
      renderVerification({ valid: false, message: 'Chưa đọc được file. Hãy chọn lại hoặc dán mã đầy đủ.' });
    }
  }
});

for (const link of document.querySelectorAll('[data-mode]')) link.addEventListener('click', event => { event.preventDefault(); selectMode(link.dataset.mode, { scroll: true }); });
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => selectMode(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (['ArrowRight', 'ArrowLeft'].includes(event.key)) next = tab.dataset.tab === 'create' ? 'verify' : 'create';
    else if (event.key === 'Home') next = 'create';
    else if (event.key === 'End') next = 'verify';
    if (next) { event.preventDefault(); selectMode(next, { focus: true }); }
  });
}

$('#clear-history').addEventListener('click', () => {
  $('#clear-dialog').returnValue = '';
  $('#clear-dialog').showModal();
});
$('#clear-dialog').addEventListener('close', () => {
  if ($('#clear-dialog').returnValue !== 'confirm') return;
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { toast('Chưa xóa được dữ liệu lưu. Hãy xóa dữ liệu trang trong cài đặt trình duyệt.'); return; }
  savedCertificates = []; renderHistory(); resetCertificatePreview();
  toast('Đã xóa lịch sử trên trình duyệt này. Link đã chia sẻ vẫn dùng được.');
});

async function routeHash() {
  if (location.hash.startsWith('#verify=')) {
    selectMode('verify', { updateHash: false, scroll: true });
    $('#verify-input').value = location.href;
    await runVerification(location.href);
  } else if (location.hash === '#verify' || location.hash === '#create') {
    selectMode(location.hash.slice(1), { updateHash: false, scroll: true });
  }
}

$('#roast-button').addEventListener('click', nextRoast);
$('#motion-toggle').addEventListener('click', () => {
  const paused = document.body.classList.toggle('motion-paused');
  $('#motion-toggle').setAttribute('aria-pressed', String(paused));
  $('#motion-toggle').setAttribute('aria-label', paused ? 'Chạy tiếp chuyển động' : 'Tạm dừng chuyển động');
  $('#motion-toggle').textContent = paused ? 'Chạy tiếp' : 'Tạm dừng';
});
tickClock();
setInterval(tickClock, 30000);
inspectDevice();
historyLoaded = loadHistory();
await historyLoaded;
historyReady = true;
inspectDevice();
await routeHash();
window.addEventListener('hashchange', routeHash);
