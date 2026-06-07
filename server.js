'use strict';
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Config ───────────────────────────────────────────────────
const JWT_SECRET = 'br-mods-super-secret-2026';
const API_KEY    = 'fe9a8ece32ad0b63767d283ee5f70d1e';
const API_URL    = 'https://adminpanels.shop/api/reseller_v1.php';

// Telegram Bot Config
const TG_BOT_TOKEN = '8839131717:AAEeJh87apBMnh14xFlr8JI_uMBDJetFUpU'; // User should replace this
const TG_CHANNEL_ID = '-1003747014152'; // User's channel ID
const SERVER_URL = 'http://localhost:3000'; // Replace with your public URL (e.g. ngrok) for webhook to work

// ── Database (lowdb JSON file) ────────────────────────────────
const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
const dbPath = isVercel ? '/tmp/db.json' : path.join(__dirname, 'db.json');

// Copy original db.json to /tmp if on Vercel and doesn't exist
if (isVercel && !fs.existsSync(dbPath)) {
  try {
    const originalDbPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(originalDbPath)) {
      fs.copyFileSync(originalDbPath, dbPath);
    }
  } catch (err) {
    console.error('Failed to copy db.json to /tmp:', err);
  }
}

const adapter = new FileSync(dbPath);
const db      = low(adapter);

db.defaults({
  users:    [],
  products: [],
  prices:   [],
  orders:   [],
  deposits: [], // New table for tracking deposits
  _nextId:  { users:1, products:1, prices:1, orders:1, deposits:1 }
}).write();

function nextId(table) {
  const id = db.get(`_nextId.${table}`).value();
  db.set(`_nextId.${table}`, id + 1).write();
  return id;
}

// ── Seed default admin ────────────────────────────────────────
if (!db.get('users').find({ username: 'admin' }).value()) {
  db.get('users').push({
    id:         nextId('users'),
    username:   'admin',
    email:      'admin@brpanel.com',
    password:   bcrypt.hashSync('admin123', 10),
    role:       'admin',
    balance:    0,
    is_active:  true,
    created_at: new Date().toISOString()
  }).write();
  console.log('✅ Admin created → username: admin | password: admin123');
}

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Auth Middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { 
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.get('users').find({ id: decoded.id }).value();
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!user.is_active) return res.status(403).json({ error: 'Your account has been banned' });
    req.user = decoded; 
    next(); 
  }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

// ════════════════════════════════════════════════════════════
//  TELEGRAM BOT HELPERS
// ════════════════════════════════════════════════════════════

async function sendTgNotification(deposit) {
  const message = `💰 *New Deposit Request*\n\n` +
    `👤 *User:* ${deposit.username} (ID: ${deposit.user_id})\n` +
    `💵 *Amount:* ৳${deposit.amount}\n` +
    `💳 *Method:* ${deposit.method.toUpperCase()}\n` +
    `🧾 *TrxID:* \`${deposit.trx_id}\`\n\n` +
    `Please Approve or Reject this request.`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `dep_approve_${deposit.id}` },
        { text: "❌ Reject", callback_data: `dep_reject_${deposit.id}` }
      ]
    ]
  };

  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHANNEL_ID,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      })
    });
  } catch (err) {
    console.error('Telegram notification error:', err);
  }
}

// Telegram Webhook Handler
app.post('/api/tg-webhook', async (req, res) => {
  const { callback_query } = req.body;
  if (!callback_query) return res.sendStatus(200);

  const { data, message, id: callback_id } = callback_query;
  const parts = data.split('_');
  if (parts[0] !== 'dep') return res.sendStatus(200);

  const action = parts[1]; // approve or reject
  const depId = parseInt(parts[2]);

  const deposit = db.get('deposits').find({ id: depId }).value();
  if (!deposit) {
    return fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callback_id, text: "Deposit not found!" })
    });
  }

  if (deposit.status !== 'pending') {
    return fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callback_id, text: "Already processed!" })
    });
  }

  if (action === 'approve') {
    // Update balance
    const user = db.get('users').find({ id: deposit.user_id }).value();
    if (user) {
      const newBal = +(user.balance + deposit.amount).toFixed(2);
      db.get('users').find({ id: user.id }).assign({ balance: newBal }).write();
      db.get('deposits').find({ id: depId }).assign({ status: 'approved', processed_at: new Date().toISOString() }).write();
      
      // Update TG message
      await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHANNEL_ID,
          message_id: message.message_id,
          text: message.text + `\n\n✅ *Status: Approved*`,
          parse_mode: 'Markdown'
        })
      });
    }
  } else {
    db.get('deposits').find({ id: depId }).assign({ status: 'rejected', processed_at: new Date().toISOString() }).write();
    
    // Update TG message
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHANNEL_ID,
        message_id: message.message_id,
        text: message.text + `\n\n❌ *Status: Rejected*`,
        parse_mode: 'Markdown'
      })
    });
  }

  res.sendStatus(200);
});

// ════════════════════════════════════════════════════════════
//  DEPOSIT ROUTE
// ════════════════════════════════════════════════════════════

app.post('/api/deposit', auth, async (req, res) => {
  const { amount, trx_id, method } = req.body;
  if (!amount || !trx_id || !method) return res.status(400).json({ error: 'Missing required fields' });

  const deposit = {
    id: nextId('deposits'),
    user_id: req.user.id,
    username: req.user.username,
    amount: parseFloat(amount),
    trx_id,
    method,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  db.get('deposits').push(deposit).write();
  await sendTgNotification(deposit);

  res.json({ success: true, message: 'Deposit request submitted successfully' });
});

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

// Register
app.post('/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.get('users').find({ username }).value()) return res.status(400).json({ error: 'Username already taken' });
  if (db.get('users').find({ email }).value())    return res.status(400).json({ error: 'Email already registered' });

  const user = {
    id: nextId('users'), username, email,
    password:   bcrypt.hashSync(password, 10),
    role:       'user',
    balance:    0,
    is_active:  true,
    created_at: new Date().toISOString()
  };
  db.get('users').push(user).write();
  const token = jwt.sign({ id: user.id, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = user;
  res.json({ success: true, token, user: safe });
});

// Login
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.get('users').find({ username }).value();
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password' });
  if (!user.is_active)
    return res.status(403).json({ error: 'Your account has been banned' });
  const token = jwt.sign({ id: user.id, username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = user;
  res.json({ success: true, token, user: safe });
});

// Me
app.get('/auth/me', auth, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ════════════════════════════════════════════════════════════
//  PRODUCT ROUTES (public)
// ════════════════════════════════════════════════════════════

app.get('/api/products', (req, res) => {
  const products = db.get('products').filter({ is_active: true }).value();
  const prices   = db.get('prices').value();
  const result   = products.map(p => ({
    ...p,
    prices: prices.filter(pr => pr.product_id === p.id)
  }));
  res.json(result);
});

// ════════════════════════════════════════════════════════════
//  BUY ROUTE
// ════════════════════════════════════════════════════════════

app.post('/api/buy', auth, async (req, res) => {
  const { product_id, duration } = req.body || {};
  const user    = db.get('users').find({ id: req.user.id }).value();
  const product = db.get('products').find({ id: product_id, is_active: true }).value();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const priceRow = db.get('prices').find({ product_id, duration }).value();
  if (!priceRow) return res.status(400).json({ error: 'Invalid duration selected' });

  if (user.balance < priceRow.price)
    return res.status(400).json({ error: `Insufficient balance. Need ৳${priceRow.price}, you have ৳${user.balance.toFixed(2)}` });

  // Deduct balance
  db.get('users').find({ id: user.id }).assign({ balance: +(user.balance - priceRow.price).toFixed(2) }).write();

  try {
    const form = new FormData();
    form.append('api_key',    API_KEY);
    form.append('action',     'buy');
    form.append('product_id', product.pid);
    form.append('duration',   duration);
    const apiRes  = await fetch(API_URL, { method:'POST', body:form });
    const text    = await apiRes.text();
    let apiData; try { apiData = JSON.parse(text); } catch { apiData = { raw: text }; }
    const success = apiData.status === 'success';

    if (!success) {
      // Refund
      const cur = db.get('users').find({ id: user.id }).value().balance;
      db.get('users').find({ id: user.id }).assign({ balance: +(cur + priceRow.price).toFixed(2) }).write();
    }

    const order = {
      id:           nextId('orders'),
      user_id:      user.id,
      username:     user.username,
      product_id,
      product_name: product.name,
      pid:          product.pid,
      duration,
      price_paid:   priceRow.price,
      status:       success ? 'success' : 'failed',
      api_response: JSON.stringify(apiData),
      created_at:   new Date().toISOString()
    };
    db.get('orders').push(order).write();
    const newBalance = db.get('users').find({ id: user.id }).value().balance;
    res.json({ success, order_id: order.id, api_response: apiData, new_balance: newBalance, refunded: !success });
  } catch (err) {
    const cur = db.get('users').find({ id: user.id }).value().balance;
    db.get('users').find({ id: user.id }).assign({ balance: +(cur + priceRow.price).toFixed(2) }).write();
    res.status(500).json({ error: err.message });
  }
});

// User orders
app.get('/api/orders', auth, (req, res) => {
  const orders = db.get('orders')
    .filter({ user_id: req.user.id, status: 'success' })
    .sortBy('id')
    .reverse()
    .take(50)
    .value();
  res.json(orders);
});

// ════════════════════════════════════════════════════════════
//  ADMIN — STATS
// ════════════════════════════════════════════════════════════

app.get('/admin/stats', auth, adminOnly, (req, res) => {
  const users         = db.get('users').filter({ role:'user' }).value();
  const orders        = db.get('orders').value();
  const successOrders = orders.filter(o => o.status === 'success');
  const revenue       = successOrders.reduce((s, o) => s + (o.price_paid || 0), 0);
  const recent        = db.get('orders').sortBy('id').reverse().take(8).value();
  res.json({
    totalUsers:    users.length,
    totalOrders:   orders.length,
    successOrders: successOrders.length,
    totalRevenue:  +revenue.toFixed(2),
    recentOrders:  recent
  });
});

// Reseller API balance
app.get('/admin/reseller-balance', auth, adminOnly, async (req, res) => {
  for (const action of ['balance','get_balance','info']) {
    try {
      const form = new FormData();
      form.append('api_key', API_KEY);
      form.append('action', action);
      const r    = await fetch(API_URL, { method:'POST', body:form });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
      if (!j.msg?.toLowerCase().includes('invalid action')) return res.json(j);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ balance: 'N/A', msg: 'Balance action not supported by API' });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — USERS
// ════════════════════════════════════════════════════════════

app.get('/admin/users', auth, adminOnly, (req, res) => {
  const users = db.get('users').map(u => { const { password:_, ...s } = u; return s; }).value();
  res.json(users);
});

app.patch('/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = +req.params.id;
  const { balance, role, is_active } = req.body;
  const user = db.get('users').find({ id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const update = {};
  if (balance   !== undefined) update.balance   = +balance;
  if (role      !== undefined) update.role      = role;
  if (is_active !== undefined) update.is_active = is_active;
  db.get('users').find({ id }).assign(update).write();
  const { password:_, ...safe } = db.get('users').find({ id }).value();
  res.json(safe);
});

app.post('/admin/users/:id/topup', auth, adminOnly, (req, res) => {
  const id     = +req.params.id;
  const amount = +req.body.amount;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const user = db.get('users').find({ id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newBal = +(user.balance + amount).toFixed(2);
  db.get('users').find({ id }).assign({ balance: newBal }).write();
  res.json({ success: true, username: user.username, new_balance: newBal });
});

app.delete('/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.get('users').remove({ id }).write();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — PRODUCTS
// ════════════════════════════════════════════════════════════

app.get('/admin/products', auth, adminOnly, (req, res) => {
  const products = db.get('products').value();
  const allPrices = db.get('prices').value();
  res.json(products.map(p => ({ ...p, prices: allPrices.filter(pr => pr.product_id === p.id) })));
});

app.post('/admin/products', auth, adminOnly, (req, res) => {
  const { name, pid, icon, description, prices } = req.body;
  if (!name || !pid) return res.status(400).json({ error: 'Name and PID are required' });
  const product = { id: nextId('products'), name, pid, icon: icon||'🎮', description: description||'', is_active: true, created_at: new Date().toISOString() };
  db.get('products').push(product).write();
  const savedPrices = [];
  if (Array.isArray(prices)) {
    prices.forEach(p => {
      if (p.duration && p.price) {
        const pr = { id: nextId('prices'), product_id: product.id, duration: p.duration, price: +p.price };
        db.get('prices').push(pr).write();
        savedPrices.push(pr);
      }
    });
  }
  res.json({ ...product, prices: savedPrices });
});

app.patch('/admin/products/:id', auth, adminOnly, (req, res) => {
  const id = +req.params.id;
  const { name, pid, icon, description, is_active, prices } = req.body;
  if (!db.get('products').find({ id }).value()) return res.status(404).json({ error: 'Product not found' });
  const update = {};
  if (name        !== undefined) update.name        = name;
  if (pid         !== undefined) update.pid         = pid;
  if (icon        !== undefined) update.icon        = icon;
  if (description !== undefined) update.description = description;
  if (is_active   !== undefined) update.is_active   = is_active;
  db.get('products').find({ id }).assign(update).write();
  if (Array.isArray(prices)) {
    db.get('prices').remove({ product_id: id }).write();
    prices.forEach(p => {
      if (p.duration && p.price)
        db.get('prices').push({ id: nextId('prices'), product_id: id, duration: p.duration, price: +p.price }).write();
    });
  }
  const prod   = db.get('products').find({ id }).value();
  const pPrices = db.get('prices').filter({ product_id: id }).value();
  res.json({ ...prod, prices: pPrices });
});

app.delete('/admin/products/:id', auth, adminOnly, (req, res) => {
  const id = +req.params.id;
  db.get('products').remove({ id }).write();
  db.get('prices').remove({ product_id: id }).write();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — ALL ORDERS
// ════════════════════════════════════════════════════════════

app.get('/admin/orders', auth, adminOnly, (req, res) => {
  const orders = db.get('orders').sortBy('id').reverse().take(100).value();
  res.json(orders);
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  BR Mods Panel → http://localhost:${PORT}`);
  console.log(`   Admin login: admin / admin123\n`);
});

module.exports = app;
