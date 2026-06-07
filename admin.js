/**
 * BR Mods Admin Panel Logic
 */

const TOKEN = localStorage.getItem('br_token');
const USER  = JSON.parse(localStorage.getItem('br_user') || 'null');

// Redirect if not admin
if (!TOKEN || !USER || USER.role !== 'admin') {
    window.location.href = 'index.html';
}

// ── State ────────────────────────────────────────────────────
let currentTab = 0;
let allProducts = [];
let allUsers = [];

// ── API Helper ───────────────────────────────────────────────
async function api(url, opts = {}) {
    const headers = {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {})
    };
    const response = await fetch(url, { ...opts, headers });
    if (response.status === 401) {
        logout();
        return;
    }
    return response.json();
}

// ── Auth ─────────────────────────────────────────────────────
function logout() {
    localStorage.removeItem('br_token');
    localStorage.removeItem('br_user');
    window.location.href = 'index.html';
}

// ── Tabs ─────────────────────────────────────────────────────
function showTab(index) {
    currentTab = index;
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('on', i === index));
    document.querySelectorAll('.panel').forEach((p, i) => p.classList.toggle('on', i === index));
    
    if (index === 0) loadStats();
    if (index === 1) loadProducts();
    if (index === 2) loadUsers();
    if (index === 3) loadAllOrders();
}

// ── Dashboard / Stats ────────────────────────────────────────
async function loadStats() {
    try {
        const stats = await api('/admin/stats');
        const bal = await api('/admin/reseller-balance');
        
        document.getElementById('apiBal').textContent = bal.balance || bal.msg || 'Error';
        document.getElementById('sTotalUsers').textContent = stats.totalUsers;
        document.getElementById('sTotalOrders').textContent = stats.totalOrders;
        document.getElementById('sSuccessOrders').textContent = stats.successOrders;
        document.getElementById('sRevenue').textContent = stats.totalRevenue;
        
        renderRecentOrders(stats.recentOrders);
    } catch (err) {
        console.error('Stats error:', err);
    }
}

function renderRecentOrders(orders) {
    const tbody = document.getElementById('recentOrders');
    if (!orders || orders.length === 0) {
        tbody.innerHTML = '<tr><td class="empty" colspan="7">No orders yet</td></tr>';
        return;
    }
    tbody.innerHTML = orders.map(o => `
        <tr>
            <td>#${o.id}</td>
            <td>${esc(o.username)}</td>
            <td>${esc(o.product_name)}</td>
            <td>${esc(o.duration)}</td>
            <td>৳${o.price_paid}</td>
            <td><span class="badge ${o.status === 'success' ? 'b-g' : 'b-r'}">${o.status.toUpperCase()}</span></td>
            <td style="font-size:0.7rem; color:var(--m)">${new Date(o.created_at).toLocaleString()}</td>
        </tr>
    `).join('');
}

// ── Products ─────────────────────────────────────────────────
async function loadProducts() {
    try {
        const products = await api('/admin/products');
        allProducts = products;
        const tbody = document.getElementById('productsTbl');
        if (!products || products.length === 0) {
            tbody.innerHTML = '<tr><td class="empty" colspan="7">No products yet</td></tr>';
            return;
        }
        tbody.innerHTML = products.map(p => `
            <tr>
                <td>${p.id}</td>
                <td style="font-size:1.5rem">${p.icon}</td>
                <td><strong>${esc(p.name)}</strong></td>
                <td><code>${esc(p.pid)}</code></td>
                <td>${p.prices.map(pr => `<span class="badge b-o" style="margin:2px">${pr.duration}: ৳${pr.price}</span>`).join('')}</td>
                <td><span class="badge ${p.is_active ? 'b-g' : 'b-r'}">${p.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                <td>
                    <button class="btn btn-o btn-sm" onclick="editProduct(${p.id})">Edit</button>
                    <button class="btn btn-r btn-sm" onclick="deleteProduct(${p.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Load products error:', err);
    }
}

function openProductModal() {
    document.getElementById('prodModalTitle').textContent = 'Add Product';
    document.getElementById('editProdId').value = '';
    document.getElementById('pIcon').value = '🎮';
    document.getElementById('pName').value = '';
    document.getElementById('pPid').value = '';
    document.getElementById('pDesc').value = '';
    document.getElementById('pActive').value = '1';
    document.getElementById('priceRows').innerHTML = '';
    addPriceRow();
    document.getElementById('prodOv').classList.add('on');
}

function closeProductModal() {
    document.getElementById('prodOv').classList.remove('on');
}

function addPriceRow(duration = '', price = '') {
    const div = document.createElement('div');
    div.className = 'price-row';
    div.innerHTML = `
        <input type="text" placeholder="Duration (e.g. 1 Day)" value="${duration}" class="p-dur">
        <input type="number" placeholder="Price (৳)" value="${price}" class="p-prc">
        <button class="btn-icon" onclick="this.parentElement.remove()">✕</button>
    `;
    document.getElementById('priceRows').appendChild(div);
}

function editProduct(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    
    document.getElementById('prodModalTitle').textContent = 'Edit Product';
    document.getElementById('editProdId').value = p.id;
    document.getElementById('pIcon').value = p.icon;
    document.getElementById('pName').value = p.name;
    document.getElementById('pPid').value = p.pid;
    document.getElementById('pDesc').value = p.description;
    document.getElementById('pActive').value = p.is_active ? '1' : '0';
    
    const rowContainer = document.getElementById('priceRows');
    rowContainer.innerHTML = '';
    p.prices.forEach(pr => addPriceRow(pr.duration, pr.price));
    if (p.prices.length === 0) addPriceRow();
    
    document.getElementById('prodOv').classList.add('on');
}

async function saveProduct() {
    const id = document.getElementById('editProdId').value;
    const name = document.getElementById('pName').value;
    const pid = document.getElementById('pPid').value;
    const icon = document.getElementById('pIcon').value;
    const description = document.getElementById('pDesc').value;
    const is_active = document.getElementById('pActive').value === '1';
    
    const prices = [];
    document.querySelectorAll('.price-row').forEach(row => {
        const dur = row.querySelector('.p-dur').value;
        const prc = row.querySelector('.p-prc').value;
        if (dur && prc) prices.push({ duration: dur, price: prc });
    });
    
    if (!name || !pid) return toast('⚠️', 'Required', 'Name and PID are required', 'error');
    
    const body = { name, pid, icon, description, is_active, prices };
    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/admin/products/${id}` : '/admin/products';
    
    try {
        const res = await api(url, { method, body: JSON.stringify(body) });
        if (res.id) {
            toast('✅', 'Success', `Product ${id ? 'updated' : 'added'}!`, 'success');
            closeProductModal();
            loadProducts();
        } else {
            toast('❌', 'Error', res.error || 'Failed to save', 'error');
        }
    } catch (err) {
        toast('❌', 'Error', err.message, 'error');
    }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
        const res = await api(`/admin/products/${id}`, { method: 'DELETE' });
        if (res.success) {
            toast('🗑️', 'Deleted', 'Product removed', 'success');
            loadProducts();
        }
    } catch (err) {
        toast('❌', 'Error', err.message, 'error');
    }
}

// ── Users ────────────────────────────────────────────────────
async function loadUsers() {
    try {
        const users = await api('/admin/users');
        allUsers = users;
        const tbody = document.getElementById('usersTbl');
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.id}</td>
                <td><strong>${esc(u.username)}</strong></td>
                <td>${esc(u.email)}</td>
                <td><span class="badge ${u.role === 'admin' ? 'b-o' : 'b-g'}">${u.role.toUpperCase()}</span></td>
                <td>৳${u.balance.toFixed(2)}</td>
                <td><span class="badge ${u.is_active ? 'b-g' : 'b-r'}">${u.is_active ? 'ACTIVE' : 'BANNED'}</span></td>
                <td style="font-size:0.7rem; color:var(--m)">${new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-g btn-sm" onclick="openTopup(${u.id}, '${esc(u.username)}')">Topup</button>
                    <button class="btn btn-o btn-sm" onclick="toggleUserStatus(${u.id}, ${u.is_active})">${u.is_active ? 'Ban' : 'Unban'}</button>
                    <button class="btn btn-r btn-sm" onclick="deleteUser(${u.id})">Del</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Load users error:', err);
    }
}

function openTopup(id, name) {
    document.getElementById('topupUserId').value = id;
    document.getElementById('topupUser').textContent = name;
    document.getElementById('topupAmt').value = '';
    document.getElementById('topupOv').classList.add('on');
}

function closeTopup() {
    document.getElementById('topupOv').classList.remove('on');
}

async function doTopup() {
    const id = document.getElementById('topupUserId').value;
    const amount = document.getElementById('topupAmt').value;
    if (!amount || amount <= 0) return toast('⚠️', 'Error', 'Enter valid amount', 'error');
    
    try {
        const res = await api(`/admin/users/${id}/topup`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: parseFloat(amount) }) 
        });
        
        if (res && res.success) {
            toast('💰', 'Success', `Added ৳${amount} to ${res.username}`, 'success');
            closeTopup();
            loadUsers();
        } else {
            toast('❌', 'Error', (res && res.error) ? res.error : 'Failed', 'error');
        }
    } catch (err) {
        toast('❌', 'Error', err.message, 'error');
    }
}

async function toggleUserStatus(id, current) {
    // Ensure current is boolean
    const activeStatus = String(current) === 'true';
    try {
        const res = await api(`/admin/users/${id}`, { 
            method: 'PATCH', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !activeStatus }) 
        });
        
        if (res && res.id) {
            toast('👤', 'Updated', `User ${!activeStatus ? 'Banned' : 'Activated'}`, 'success');
            loadUsers();
        } else {
            toast('❌', 'Error', (res && res.error) ? res.error : 'Failed to update status', 'error');
        }
    } catch (err) {
        toast('❌', 'Error', err.message, 'error');
    }
}

async function deleteUser(id) {
    if (!confirm('Are you sure? This will delete the user permanently.')) return;
    try {
        const res = await api(`/admin/users/${id}`, { method: 'DELETE' });
        if (res.success) {
            toast('🗑️', 'Deleted', 'User removed', 'success');
            loadUsers();
        } else {
            toast('❌', 'Error', res.error, 'error');
        }
    } catch (err) {
        toast('❌', 'Error', err.message, 'error');
    }
}

// ── All Orders ───────────────────────────────────────────────
async function loadAllOrders() {
    try {
        const orders = await api('/admin/orders');
        const tbody = document.getElementById('allOrdersTbl');
        if (!orders || orders.length === 0) {
            tbody.innerHTML = '<tr><td class="empty" colspan="8">No orders yet</td></tr>';
            return;
        }
        tbody.innerHTML = orders.map(o => `
            <tr>
                <td>#${o.id}</td>
                <td>${esc(o.username)}</td>
                <td>${esc(o.product_name)}</td>
                <td><code>${esc(o.pid)}</code></td>
                <td>${esc(o.duration)}</td>
                <td>৳${o.price_paid}</td>
                <td><span class="badge ${o.status === 'success' ? 'b-g' : 'b-r'}">${o.status.toUpperCase()}</span></td>
                <td style="font-size:0.7rem; color:var(--m)">${new Date(o.created_at).toLocaleString()}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Load all orders error:', err);
    }
}

// ── Helpers ──────────────────────────────────────────────────
function toast(icon, title, sub, type) {
    const toasts = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderLeft = `3px solid ${type === 'success' ? '#10B981' : '#EF4444'}`;
    t.innerHTML = `
        <span class="t-ico">${icon}</span>
        <div>
            <div class="t-msg">${title}</div>
            <div class="t-sub">${sub}</div>
        </div>
    `;
    toasts.prepend(t);
    setTimeout(() => {
        t.classList.add('hide');
        setTimeout(() => t.remove(), 400);
    }, 4000);
}

function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Init ─────────────────────────────────────────────────────
showTab(0);
setInterval(loadStats, 60000);
