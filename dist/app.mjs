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
    ? { title: 'Đúng hệ rồi. Mời bạn vào hội.', description: 'Trình duyệt báo macOS. Chỉ còn thiếu tên bạn trên giấy.', symbol: '⌘', eyebrow: 'MAC ĐÃ ĐƯỢC NHẬN DIỆN' }
    : device.os === 'Windows'
      ? { title: 'Phát hiện Windows. Rất tiếc.', description: 'Hồ sơ gia nhập hội Táo tạm thời bị từ chối. Bạn vẫn được kiểm tra giấy của đứa bạn.', symbol: '⊞', eyebrow: 'CỬA SỔ NÀY CHƯA CÓ TÁO' }
      : device.os === 'Linux'
        ? { title: 'Linux à? Hội rất tôn trọng.', description: 'Bạn có thể tự build cả hệ điều hành. Nhưng giấy này vẫn cần một chiếc Mac.', symbol: '>_', eyebrow: 'SUDO KHÔNG GIÚP ĐƯỢC LẦN NÀY' }
        : ['iPadOS', 'iOS'].includes(device.os)
          ? { title: 'Có Táo. Nhưng chưa đúng loại.', description: 'iPhone và iPad dễ thương đấy. Hội này đang tuyển Mac. Bạn vẫn kiểm tra được mọi mã.', symbol: '▯', eyebrow: 'GẦN ĐÚNG RỒI ĐÓ' }
          : device.os === 'Android'
            ? { title: 'Android gửi lời chào.', description: 'Bạn đang ở bên kia vườn Táo. Hãy dùng Mac để nhận giấy, hoặc kiểm tra mã của bạn bè.', symbol: '◉', eyebrow: 'KHÁCH QUÝ TỪ HỆ KHÁC' }
            : { title: 'Hội chưa nhận ra máy bạn.', description: 'Trình duyệt chưa cung cấp tín hiệu macOS nhất quán. Thử tắt giả lập rồi kiểm tra lại nhé.', symbol: '?', eyebrow: 'CHƯA ĐỦ DỮ KIỆN' };
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
  $('#issue-button').disabled = !historyReady || !device.isMac || !canUseCrypto || issuing;
  if (!canUseCrypto) feedback('Cần trình duyệt hiện đại và HTTPS (hoặc localhost) để cấp, kiểm tra giấy. Không mở trực tiếp file HTML.', true);
  else if (!device.isMac) feedback('Mở trang này trên Mac để nhận chứng nhận. Xác minh mã thì máy nào cũng được.');
  else feedback(historyReady ? 'Đã đủ điều kiện. Hội đang chờ tên của bạn.' : 'Hội đang mở sổ chứng nhận. Chờ một chút nhé.');
}

function showCertificate(result) {
  currentCertificate = result;
  $('#cert-name').textContent = result.certificate.name;
  $('#cert-os').textContent = result.certificate.os;
  $('#cert-date').textContent = formatDate(result.certificate.issuedAt);
  $('#cert-id').textContent = result.id;
  $('#preview-label').textContent = 'CHÚC MỪNG. BẠN ĐÃ CÓ GIẤY.';
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
  $('#preview-label').textContent = 'CHỨNG NHẬN TƯƠNG LAI CỦA BẠN';
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
    const view = element('button', 'text-button', 'Xem giấy');
    view.type = 'button';
    view.addEventListener('click', () => { showCertificate(record); selectMode('create', { scroll: true }); });
    const check = element('button', 'button button-white', 'Xác minh');
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
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1260;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const bg = ctx.createLinearGradient(0, 0, 1800, 1260);
    bg.addColorStop(0, '#eef0ff'); bg.addColorStop(1, '#e1ebff');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1800, 1260);
    roundRect(ctx, 80, 70, 1640, 1120, 38, '#ffffff');
    ctx.strokeStyle = '#e5e7f2'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(160, 270); ctx.lineTo(1640, 270); ctx.stroke();
    roundRect(ctx, 160, 140, 82, 82, 20, '#3e5aef');
    ctx.fillStyle = '#ffffff'; ctx.font = `50px ${font}`; ctx.textAlign = 'center'; ctx.fillText('⌘', 201, 198);
    ctx.textAlign = 'left'; ctx.fillStyle = '#181b29'; ctx.font = `700 28px ${font}`;
    ctx.fillText('HỘI NGƯỜI ĐANG DÙNG MAC', 270, 176);
    ctx.fillStyle = '#777c8f'; ctx.font = `22px ${font}`; ctx.fillText('THE VERY UNOFFICIAL MAC CLUB', 270, 212);
    ctx.textAlign = 'right'; ctx.fillStyle = '#3e5aef'; ctx.font = `700 26px ${font}`; ctx.fillText('i’m using a mac.', 1640, 185);
    ctx.textAlign = 'center'; ctx.fillStyle = '#7a7f93'; ctx.font = `600 23px ${font}`; ctx.fillText('TRÂN TRỌNG XÁC NHẬN', 900, 365);
    let nameSize = 88;
    ctx.font = `700 ${nameSize}px ${font}`;
    while (ctx.measureText(record.certificate.name).width > 1420 && nameSize > 52) { nameSize -= 2; ctx.font = `700 ${nameSize}px ${font}`; }
    const nameLines = wrapCanvasText(ctx, record.certificate.name, 1420);
    ctx.fillStyle = '#3e5aef';
    nameLines.slice(0, 2).forEach((line, index) => ctx.fillText(line, 900, nameLines.length > 1 ? 450 + index * 66 : 480));
    ctx.fillStyle = '#181b29'; ctx.font = `600 48px ${font}`; ctx.fillText('đang dùng Mac.', 900, 620);
    ctx.fillStyle = '#6d7284'; ctx.font = `30px ${font}`; ctx.fillText('Và muốn mọi người biết điều đó.', 900, 675);
    ctx.textAlign = 'left'; ctx.fillStyle = '#7a7f93'; ctx.font = `600 20px ${font}`;
    ctx.fillText('HỆ ĐIỀU HÀNH', 160, 820); ctx.fillText('NGÀY GIA NHẬP', 620, 820);
    ctx.fillStyle = '#181b29'; ctx.font = `600 30px ${font}`;
    ctx.fillText('macOS', 160, 866); ctx.fillText(formatDate(record.certificate.issuedAt, true), 620, 866);
    ctx.save(); ctx.translate(1490, 810); ctx.rotate(-0.18);
    ctx.beginPath(); ctx.arc(0, 0, 90, 0, Math.PI * 2); ctx.fillStyle = '#d7f6b0'; ctx.fill();
    ctx.strokeStyle = '#53802d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 78, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#304b1d'; ctx.textAlign = 'center'; ctx.font = `800 26px ${font}`; ctx.fillText('JUST', 0, -15); ctx.fillText('FOR FUN', 0, 19); ctx.font = `22px ${font}`; ctx.fillText('✦ ✦ ✦', 0, 53); ctx.restore();
    ctx.strokeStyle = '#e5e7f2'; ctx.beginPath(); ctx.moveTo(160, 945); ctx.lineTo(1640, 945); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = '#4e5365'; ctx.font = `23px ui-monospace, monospace`; ctx.fillText(record.id, 160, 997);
    ctx.fillStyle = '#777c8f'; ctx.font = `22px ${font}`; ctx.fillText('Mã đối chiếu · Kiểm tra bằng link chia sẻ hoặc file chứng nhận đi kèm.', 160, 1042);
    ctx.fillStyle = '#989caa'; ctx.font = `21px ${font}`; ctx.fillText('Chứng nhận vui từ trình duyệt. Không liên quan đến Apple.', 160, 1120);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG unavailable');
    download(blob, `${record.id}.png`);
    toast('Ảnh đã sẵn sàng. Nhớ gửi kèm link để đứa bạn còn check.');
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
  panel.append(icon, element('p', 'result-eyebrow', result.valid ? 'GIẤY TỜ KHỚP. MỜI TIẾP TỤC FLEX.' : 'HỘI CẦN KIỂM TRA LẠI'), element('h3', 'result-title', result.valid ? 'Chữ ký hợp lệ.' : result.code === 'SHORT_CODE' ? 'Cần mã đầy đủ nhé.' : 'Mã này chưa qua cửa.'));
  if (!result.valid) {
    panel.append(element('p', 'result-description', result.message), element('p', 'result-footnote', 'Kiểm tra xem bạn đã sao chép đủ mã chưa. Bạn cũng có thể dùng link chia sẻ hoặc file .json.'));
    return;
  }
  panel.append(element('p', 'result-description', 'Nội dung khớp với chữ ký tự tạo đi kèm. Chiếc giấy này đã sẵn sàng để vào nhóm chat.'));
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
  share.addEventListener('click', () => copyText(shareURL(result), 'Đã sao chép link. Xin hãy flex có trách nhiệm.'));
  png.addEventListener('click', () => downloadPNG(result));
  file.addEventListener('click', () => downloadJSON(result));
  actions.append(share, png, file); panel.append(actions);
}

async function runVerification(input, sequence = ++verificationSequence) {
  $('#verify-button').disabled = true;
  $('#verify-button').textContent = 'Hội đang xem giấy…';
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
  $('#verify-button').textContent = 'Kiểm tra xem nào ✓';
}

$('#issue-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (issuing || !historyReady) return;
  inspectDevice();
  if (!device.isMac || !canUseCrypto) return;
  issuing = true;
  $('#issue-button').disabled = true;
  $('#issue-button').textContent = 'Hội đang đóng dấu…';
  try {
    const record = await issueCertificate({ name: $('#certificate-name').value, device });
    showCertificate(record);
    savedCertificates = [record, ...savedCertificates.filter(item => item.id !== record.id)].slice(0, MAX_HISTORY);
    const saved = persistHistory();
    renderHistory();
    feedback(saved ? 'Đã cấp giấy. Chính thức có thêm một thứ để gửi vào nhóm.' : 'Đã cấp giấy. Hãy tải file hoặc sao chép link vì trình duyệt không lưu được lịch sử.');
    if (saved) toast('Chúc mừng. Bạn có Mac. Và bây giờ có cả giấy.');
  } catch (error) { feedback(error.message || 'Hội gặp trục trặc. Hãy thử lại nhé.', true); }
  finally {
    issuing = false;
    $('#issue-button').disabled = !device.isMac || !canUseCrypto;
    $('#issue-button').textContent = 'Tạo chứng nhận của tôi ✦';
  }
});

$('#certificate-name').addEventListener('input', () => { if (!currentCertificate) $('#cert-name').textContent = $('#certificate-name').value.trim() || 'Tên của bạn'; });
$('#recheck-button').addEventListener('click', () => { inspectDevice(); toast(device.isMac ? 'Đúng là Mac. Hội đã ghi nhận.' : `Hội vẫn thấy ${device.os === 'Unknown' ? 'tín hiệu chưa rõ' : device.os}. Chưa nhận diện được Mac nhé.`); });
$('#copy-link').addEventListener('click', () => { if (currentCertificate) copyText(shareURL(currentCertificate), 'Đã sao chép link. Gửi cho đứa bạn thôi.'); });
$('#copy-code').addEventListener('click', () => { if (currentCertificate) copyText(currentCertificate.token, 'Đã sao chép mã đầy đủ. Máy nào cũng kiểm tra được.'); });
$('#download-json').addEventListener('click', () => { if (currentCertificate) downloadJSON(currentCertificate); });
$('#download-image').addEventListener('click', () => { if (currentCertificate) downloadPNG(currentCertificate); });
$('#verify-form').addEventListener('submit', event => { event.preventDefault(); runVerification($('#verify-input').value); });
$('#verify-input').addEventListener('input', () => {
  verificationSequence++;
  $('#verify-button').disabled = false;
  $('#verify-button').textContent = 'Kiểm tra xem nào ✓';
});
$('#certificate-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const sequence = ++verificationSequence;
  $('#verify-button').disabled = true;
  $('#verify-button').textContent = 'Hội đang đọc file…';
  if (file.size > 24000) {
    $('#verify-button').disabled = false;
    $('#verify-button').textContent = 'Kiểm tra xem nào ✓';
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
      $('#verify-button').textContent = 'Kiểm tra xem nào ✓';
      renderVerification({ valid: false, message: 'Chưa đọc được file. Hãy chọn lại hoặc dán mã đầy đủ.' });
    }
  }
  event.target.value = '';
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

inspectDevice();
historyLoaded = loadHistory();
await historyLoaded;
historyReady = true;
inspectDevice();
await routeHash();
window.addEventListener('hashchange', routeHash);
