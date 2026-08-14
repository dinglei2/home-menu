const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8088;

/* ================= Cloud Storage (Upstash Redis) =================
 * Render.com 免费版文件系统是临时的（重启后丢失），
 * 使用 Upstash Redis REST API 做持久化存储。
 * 本地开发无需配置，自动使用 data.json。
 * 配置方法：设置环境变量
 *   UPSTASH_REDIS_REST_URL  = https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN = xxx
 */
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = 'homeMenuData';
const useCloud = !!(UPSTASH_URL && UPSTASH_TOKEN);

/* ================= Data Storage ================= */
const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return { menu: null, orders: [], lastMenuUpdate: 0, lastOrderUpdate: 0 };
}

/* 从 Upstash Redis 加载数据 */
async function cloudLoad() {
  try {
    const r = await fetch(UPSTASH_URL + '/get/' + REDIS_KEY, {
      headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.result) {
      return JSON.parse(data.result);
    }
    return defaultData();
  } catch (e) {
    console.error('Cloud load failed:', e.message);
    return defaultData();
  }
}

/* 保存数据到 Upstash Redis */
async function cloudSave() {
  try {
    const json = JSON.stringify(serverData);
    const r = await fetch(UPSTASH_URL + '/pipeline', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + UPSTASH_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([['SET', REDIS_KEY, json]])
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.error('Cloud save failed:', e.message);
  }
}

/* 从本地文件加载 */
function localLoad() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return defaultData();
  }
}

/* 保存到本地文件 */
function localSave() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(serverData, null, 2));
  } catch (e) {
    console.error('Local save failed:', e.message);
  }
}

/* 统一的保存接口 */
let saveTimer = null;
function saveData() {
  if (useCloud) {
    /* 防抖：500ms 内多次写入只保存一次 */
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { cloudSave(); saveTimer = null; }, 500);
  } else {
    localSave();
  }
}

/* 启动时加载数据 */
let serverData = defaultData();

async function initData() {
  if (useCloud) {
    console.log('☁️ 使用 Upstash Redis 云端存储');
    serverData = await cloudLoad();
  } else {
    console.log('📁 使用本地文件存储 (data.json)');
    serverData = localLoad();
  }
}

/* ================= Middleware ================= */
app.use(express.json({ limit: '60mb' }));
app.use(express.static(__dirname, { maxAge: 0 }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ================= API Routes ================= */

// Get full state (menu + orders + timestamps)
app.get('/api/state', (req, res) => {
  res.json({
    menu: serverData.menu,
    orders: serverData.orders,
    lastMenuUpdate: serverData.lastMenuUpdate,
    lastOrderUpdate: serverData.lastOrderUpdate
  });
});

// Shop pushes menu updates
app.post('/api/menu', (req, res) => {
  const { menu } = req.body;
  if (!menu) return res.status(400).json({ error: 'menu is required' });
  serverData.menu = menu;
  serverData.lastMenuUpdate = Date.now();
  saveData();
  res.json({ ok: true, lastMenuUpdate: serverData.lastMenuUpdate });
});

// Customer pushes a new order
app.post('/api/order', (req, res) => {
  const { order } = req.body;
  if (!order) return res.status(400).json({ error: 'order is required' });
  if (!order.id) {
    order.id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  const existing = serverData.orders.find(o => o.id === order.id);
  if (!existing) {
    serverData.orders.push(order);
    serverData.lastOrderUpdate = Date.now();
    saveData();
  }
  res.json({ ok: true, order, lastOrderUpdate: serverData.lastOrderUpdate });
});

// Fetch all orders (for polling)
app.get('/api/orders', (req, res) => {
  res.json({
    orders: serverData.orders,
    lastOrderUpdate: serverData.lastOrderUpdate,
    lastMenuUpdate: serverData.lastMenuUpdate
  });
});

// Delete a single order by ID
app.post('/api/orders/delete', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });
  const before = serverData.orders.length;
  serverData.orders = serverData.orders.filter(o => o.id !== id);
  if (serverData.orders.length !== before) {
    serverData.lastOrderUpdate = Date.now();
    saveData();
  }
  res.json({ ok: true, lastOrderUpdate: serverData.lastOrderUpdate });
});

// Delete all orders for a specific date
app.post('/api/orders/deleteByDate', (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ 'error': 'date is required' });
  const before = serverData.orders.length;
  serverData.orders = serverData.orders.filter(o => o.date !== date);
  if (serverData.orders.length !== before) {
    serverData.lastOrderUpdate = Date.now();
    saveData();
  }
  res.json({ ok: true, lastOrderUpdate: serverData.lastOrderUpdate });
});

// Update an existing order (for editing)
app.post('/api/orders/update', (req, res) => {
  const { order } = req.body;
  if (!order || !order.id) return res.status(400).json({ error: 'order.id is required' });
  const idx = serverData.orders.findIndex(o => o.id === order.id);
  if (idx >= 0) {
    serverData.orders[idx] = order;
  } else {
    serverData.orders.push(order);
  }
  serverData.lastOrderUpdate = Date.now();
  saveData();
  res.json({ ok: true, lastOrderUpdate: serverData.lastOrderUpdate });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    orders: serverData.orders.length,
    hasMenu: !!serverData.menu,
    storage: useCloud ? 'cloud' : 'local'
  });
});

/* ================= Start Server ================= */
initData().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ========================================`);
    console.log(`  🍲 家常小厨房服务器已启动`);
    console.log(`  ========================================`);
    console.log(`  存储: ${useCloud ? '☁️ Upstash Redis (云端持久化)' : '📁 本地文件 (data.json)'}`);
    console.log(`  本机访问:  http://localhost:${PORT}`);
    console.log(`  API健康检查: http://localhost:${PORT}/api/health`);
    console.log(`  ========================================\n`);
  });
});
