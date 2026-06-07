/* ================================================
   BR Mods Reseller Panel — Frontend Logic (app.js)
   ================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
const STATE = {
  currentPid:      '',
  currentName:     '',
  currentDuration: '1 Day',
  orderCount:      0,
  successCount:    0,
  orders:          [],
};

// ── DOM Refs ─────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const balanceVal    = $('balanceVal');
const totalOrders   = $('totalOrders');
const successOrders = $('successOrders');
const orderHistory  = $('orderHistory');
const modalOverlay  = $('modalOverlay');
const confirmBtn    = $('confirmBtn');
const btnText       = $('btnText');
const modalResult   = $('modalResult');
const modalFooter   = $('modalFooter');
const toastContainer= $('toastContainer');

// ── Duration Button Logic ─────────────────────────────────────
document.querySelectorAll('.duration-selector').forEach(selector => {
  selector.querySelectorAll('.dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selector.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update STATE if this card's pid matches the current modal pid
      const pid = selector.getAttribute('data-pid');
      if (pid === STATE.currentPid || pid === 'CUSTOM') {
        STATE.currentDuration = btn.dataset.dur;
      }
    });
  });
});

// ── Open Modal for predefined products ───────────────────────
function openBuyModal(pid, name) {
  STATE.currentPid  = pid;
  STATE.currentName = name;

  // Get selected duration from that card's duration selector
  const selector = document.querySelector(`.duration-selector[data-pid="${pid}"]`);
  const activeBtn = selector ? selector.querySelector('.dur-btn.active') : null;
  STATE.currentDuration = activeBtn ? activeBtn.dataset.dur : '1 Day';

  $('modalTitle').textContent      = '🛒 Confirm Purchase';
  $('confirmProduct').textContent  = name;
  $('confirmPid').textContent      = pid;
  $('confirmDuration').textContent = STATE.currentDuration;

  resetModalResult();
  enableConfirmBtn();
  modalOverlay.classList.add('active');
}

// ── Open Modal for custom PID ─────────────────────────────────
function openCustomBuyModal() {
  const pid = $('customPid').value.trim();
  if (!pid) {
    showToast('⚠️', 'PID Required', 'Please enter a Product ID first.', 'warn');
    $('customPid').focus();
    return;
  }

  STATE.currentPid  = pid;
  STATE.currentName = 'Custom — ' + pid;

  const selector = document.querySelector('.duration-selector[data-pid="CUSTOM"]');
  const activeBtn = selector ? selector.querySelector('.dur-btn.active') : null;
  STATE.currentDuration = activeBtn ? activeBtn.dataset.dur : '1 Day';

  $('modalTitle').textContent      = '🛒 Confirm Purchase';
  $('confirmProduct').textContent  = 'Custom Product';
  $('confirmPid').textContent      = pid;
  $('confirmDuration').textContent = STATE.currentDuration;

  resetModalResult();
  enableConfirmBtn();
  modalOverlay.classList.add('active');
}

// ── Close Modal ───────────────────────────────────────────────
function closeModal() {
  modalOverlay.classList.remove('active');
  setTimeout(resetModalResult, 350);
}

function resetModalResult() {
  modalResult.className = 'modal-result hidden';
  modalResult.textContent = '';
}

function enableConfirmBtn() {
  confirmBtn.disabled = false;
  btnText.innerHTML   = '✅ Confirm Buy';
}

function disableConfirmBtn(msg = 'Processing…') {
  confirmBtn.disabled = true;
  btnText.innerHTML   = `<span class="spinner"></span>${msg}`;
}

// ── Execute Buy ───────────────────────────────────────────────
async function executeBuy() {
  disableConfirmBtn('Placing Order…');

  const pid      = STATE.currentPid;
  const name     = STATE.currentName;
  const duration = STATE.currentDuration;
  const time     = new Date().toLocaleTimeString('en-GB', { hour12:false });

  try {
    const response = await fetch('/api/buy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ product_id: pid, duration }),
    });

    const data = await response.json();
    handleBuyResponse(data, pid, name, duration, time);

  } catch (err) {
    // If backend server not running, show a helpful demo error
    const errData = { status: 'error', msg: 'Cannot connect to local server. Run: node server.js' };
    handleBuyResponse(errData, pid, name, duration, time);
  }
}

function handleBuyResponse(data, pid, name, duration, time) {
  const isSuccess = data.status === 'success' || (data.status !== 'error' && !data.msg?.toLowerCase().includes('error'));

  // Update modal
  modalResult.className  = `modal-result ${isSuccess ? 'success' : 'error'}`;
  modalResult.textContent = isSuccess
    ? `✅ Success! ${data.msg || JSON.stringify(data)}`
    : `❌ Error: ${data.msg || JSON.stringify(data)}`;

  // Update footer — hide cancel, show close
  modalFooter.innerHTML = `
    <button class="btn-cancel" style="flex:1" onclick="closeModal()">Close</button>
  `;

  // Toast
  if (isSuccess) {
    showToast('✅', 'Order Placed!', `${name} · ${duration}`, 'success');
    STATE.successCount++;
  } else {
    showToast('❌', 'Order Failed', data.msg || 'Unknown error', 'error');
  }

  // Add to history
  STATE.orderCount++;
  STATE.orders.unshift({ id: STATE.orderCount, name, pid, duration, time, isSuccess, raw: JSON.stringify(data) });
  totalOrders.textContent   = STATE.orderCount;
  successOrders.textContent = STATE.successCount;
  renderHistory();
  saveOrders();
}

// ── Render Order History ──────────────────────────────────────
function renderHistory() {
  if (STATE.orders.length === 0) {
    orderHistory.innerHTML = `<tr class="empty-row"><td colspan="7">No orders yet. Buy something above!</td></tr>`;
    return;
  }

  orderHistory.innerHTML = STATE.orders.map(o => `
    <tr>
      <td><strong>#${o.id}</strong></td>
      <td>${escHtml(o.name)}</td>
      <td><code style="background:rgba(124,58,237,.15);color:#A78BFA;padding:2px 8px;border-radius:6px;font-size:.78rem">${escHtml(o.pid)}</code></td>
      <td>${escHtml(o.duration)}</td>
      <td style="color:var(--muted);font-size:.82rem">${o.time}</td>
      <td>
        <span class="status-badge ${o.isSuccess ? 'status-success' : 'status-error'}">
          ${o.isSuccess ? '✅ Success' : '❌ Failed'}
        </span>
      </td>
      <td><span class="resp-code" title="${escHtml(o.raw)}">${escHtml(o.raw)}</span></td>
    </tr>
  `).join('');
}

// ── Clear History ─────────────────────────────────────────────
function clearHistory() {
  if (STATE.orders.length === 0) return;
  STATE.orders       = [];
  STATE.orderCount   = 0;
  STATE.successCount = 0;
  totalOrders.textContent   = '0';
  successOrders.textContent = '0';
  renderHistory();
  localStorage.removeItem('brOrders');
  showToast('🗑️', 'History Cleared', 'All order records removed.', 'warn');
}

// ── Load Balance ──────────────────────────────────────────────
async function loadBalance() {
  balanceVal.textContent = 'Loading…';
  try {
    const res  = await fetch('/api/balance');
    const data = await res.json();
    if (data.balance !== undefined) {
      balanceVal.textContent = `৳ ${data.balance}`;
    } else if (data.msg) {
      balanceVal.textContent = data.msg;
    } else {
      balanceVal.textContent = JSON.stringify(data).substring(0, 30);
    }
  } catch {
    balanceVal.textContent = 'Server offline';
  }
}

// ── Refresh Balance button ────────────────────────────────────
$('refreshBalance').addEventListener('click', loadBalance);

// ── Toast Notifications ───────────────────────────────────────
function showToast(icon, title, sub, type) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div>
      <div class="toast-msg">${escHtml(title)}</div>
      <div class="toast-sub">${escHtml(sub)}</div>
    </div>
  `;
  // Border color by type
  const colors = { success:'#10B981', error:'#EF4444', warn:'#F59E0B' };
  t.style.borderLeftColor = colors[type] || '#7C3AED';
  t.style.borderLeftWidth = '3px';

  toastContainer.prepend(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 400);
  }, 4000);
}

// ── Persist & Restore Orders ──────────────────────────────────
function saveOrders() {
  try {
    localStorage.setItem('brOrders', JSON.stringify({
      orders:  STATE.orders,
      count:   STATE.orderCount,
      success: STATE.successCount,
    }));
  } catch {}
}

function restoreOrders() {
  try {
    const saved = JSON.parse(localStorage.getItem('brOrders') || 'null');
    if (saved && Array.isArray(saved.orders)) {
      STATE.orders       = saved.orders;
      STATE.orderCount   = saved.count   || saved.orders.length;
      STATE.successCount = saved.success || 0;
      totalOrders.textContent   = STATE.orderCount;
      successOrders.textContent = STATE.successCount;
      renderHistory();
    }
  } catch {}
}

// ── Escape HTML ───────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Keyboard — close modal on Escape ─────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    closeModal();
  }
});

// ── Init ──────────────────────────────────────────────────────
(function init() {
  restoreOrders();
  loadBalance();
  // Auto-refresh balance every 60 s
  setInterval(loadBalance, 60_000);
})();
