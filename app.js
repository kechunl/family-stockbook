const SUPABASE_URL = 'https://dqrdqwbymxjdynwlzenq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ob-UZorvFy5uh0S7QMPVIw_stUaa4tD';
const STALE_DAYS = 14;

const state = {
  family: '',
  key: '',
  familyName: '',
  items: [],
  tab: 'daily',
  busy: false,
  notice: '',
};

const app = document.querySelector('#app');

async function rpc(name, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || '连接失败，请稍后再试');
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function saveFamily() {
  localStorage.setItem('buhuo-family', JSON.stringify({
    family: state.family,
    key: state.key,
    familyName: state.familyName,
  }));
  const url = new URL(location.href);
  url.searchParams.set('family', state.family);
  url.searchParams.set('key', state.key);
  history.replaceState(null, '', url);
}

function restoreFamily() {
  const query = new URLSearchParams(location.search);
  const saved = JSON.parse(localStorage.getItem('buhuo-family') || '{}');
  state.family = query.get('family') || saved.family || '';
  state.key = query.get('key') || saved.key || '';
  state.familyName = saved.familyName || '我们家';
  if (state.family && state.key) saveFamily();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function isStale(item) {
  return Date.now() - Number(item.updated_at) > STALE_DAYS * 86400000;
}

function statusLabel(status) {
  return { enough: '充足', low: '快用完', out: '用完' }[status] || status;
}

function setBusy(value, notice = '') {
  state.busy = value;
  state.notice = notice;
  render();
}

async function loadItems() {
  if (!state.family || !state.key) return;
  try {
    const rows = await rpc('list_inventory_items', {
      p_family_id: state.family,
      p_key: state.key,
    });
    state.items = Array.isArray(rows) ? rows : [];
    state.notice = '';
  } catch (error) {
    state.notice = error.message;
  }
  render();
}

function onboarding() {
  app.innerHTML = `
    <section class="onboarding">
      <div class="brand-mark">✓</div>
      <h1>补货小本本</h1>
      <p>全家共享库存与购物清单</p>
      <form id="create-form" class="card form-card">
        <h2>创建一个家庭</h2>
        <label>家庭名称<input name="name" maxlength="80" placeholder="例如：我们家" required /></label>
        <button ${state.busy ? 'disabled' : ''}>创建并开始</button>
      </form>
      <form id="join-form" class="card form-card">
        <h2>加入家人的库存</h2>
        <label>邀请码<input name="key" placeholder="粘贴家人发来的邀请码" required /></label>
        <button class="secondary" ${state.busy ? 'disabled' : ''}>加入家庭</button>
      </form>
      ${state.notice ? `<p class="notice error">${escapeHtml(state.notice)}</p>` : ''}
    </section>`;

  document.querySelector('#create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name').trim();
    setBusy(true, '正在创建家庭…');
    try {
      const [result] = await rpc('create_household', { p_name: name });
      state.family = result.family_id;
      state.key = result.family_key;
      state.familyName = result.family_name;
      saveFamily();
      await loadItems();
    } catch (error) {
      setBusy(false, error.message);
    }
  });

  document.querySelector('#join-form').addEventListener('submit', async event => {
    event.preventDefault();
    const key = new FormData(event.currentTarget).get('key').trim();
    setBusy(true, '正在加入家庭…');
    try {
      const rows = await rpc('join_household', { p_key: key });
      if (!rows.length) throw new Error('邀请码不正确');
      state.family = rows[0].family_id;
      state.key = rows[0].family_key;
      state.familyName = rows[0].family_name;
      saveFamily();
      await loadItems();
    } catch (error) {
      setBusy(false, error.message);
    }
  });
}

function itemCard(item, shopping) {
  const stale = isStale(item);
  const date = new Date(Number(item.updated_at)).toLocaleDateString('zh-CN');
  return `<article class="item-card ${stale ? 'stale' : ''}">
    <div class="item-info">
      <div class="item-title">${escapeHtml(item.name)}${stale ? '<span class="dot" title="很久没确认"></span>' : ''}</div>
      <small>${shopping ? (item.category === 'food' ? '食品' : '日用品') : `最后确认：${date}`}</small>
    </div>
    ${shopping
      ? `<button class="bought" data-action="status" data-id="${item.id}" data-status="enough">买到了</button>`
      : `<div class="statuses">${['enough', 'low', 'out'].map(status =>
          `<button data-action="status" data-id="${item.id}" data-status="${status}" class="${item.status === status ? 'selected' : ''}">${statusLabel(status)}</button>`
        ).join('')}</div>`}
  </article>`;
}

function inventory() {
  const needs = state.items.filter(item => item.status !== 'enough');
  const stale = state.items.filter(isStale);
  const visible = state.tab === 'list'
    ? needs
    : state.items.filter(item => item.category === state.tab);

  app.innerHTML = `
    <header class="topbar">
      <div><strong>补货小本本</strong><small>${escapeHtml(state.familyName)}</small></div>
      <button id="share" class="secondary compact">分享给家人</button>
    </header>
    <section class="hero">
      <div><strong>${needs.length}</strong><small>需要购买</small></div>
      <div><strong>${state.items.length - needs.length}</strong><small>库存充足</small></div>
      <div class="stale-count ${stale.length ? 'has-stale' : ''}"><strong>${stale.length}</strong><small>久未确认</small></div>
    </section>
    ${stale.length ? `<div class="stale-banner"><span class="dot"></span>${stale.length} 件物品超过 ${STALE_DAYS} 天没有确认</div>` : ''}
    <nav class="tabs">
      <button data-tab="daily" class="${state.tab === 'daily' ? 'active' : ''}">日用品</button>
      <button data-tab="food" class="${state.tab === 'food' ? 'active' : ''}">食品</button>
      <button data-tab="list" class="${state.tab === 'list' ? 'active' : ''}">购物清单${needs.length ? `<em>${needs.length}</em>` : ''}</button>
    </nav>
    <section class="items">
      ${visible.length ? visible.map(item => itemCard(item, state.tab === 'list')).join('') : '<div class="empty">这里还没有东西</div>'}
      <button id="add" class="add">＋ ${state.tab === 'list' ? '添加想买的东西' : `添加${state.tab === 'food' ? '食品' : '日用品'}`}</button>
    </section>
    ${state.notice ? `<p class="notice ${state.notice.includes('成功') ? '' : 'error'}">${escapeHtml(state.notice)}</p>` : ''}
    <footer><button id="leave" class="text-button">退出这个家庭</button><span>邀请链接只发给信任的家人</span></footer>`;

  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    state.notice = '';
    render();
  }));

  document.querySelectorAll('[data-action="status"]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await rpc('set_inventory_status', {
        p_family_id: state.family,
        p_key: state.key,
        p_item_id: button.dataset.id,
        p_status: button.dataset.status,
      });
      await loadItems();
    } catch (error) {
      state.notice = error.message;
      render();
    }
  }));

  document.querySelector('#add').addEventListener('click', async () => {
    const name = prompt(state.tab === 'list' ? '想买什么？' : `输入${state.tab === 'food' ? '食品' : '日用品'}名称`);
    if (!name?.trim()) return;
    let category = state.tab === 'food' ? 'food' : 'daily';
    if (state.tab === 'list' && confirm('这是食品吗？')) category = 'food';
    try {
      await rpc('add_inventory_item', {
        p_family_id: state.family,
        p_key: state.key,
        p_name: name.trim(),
        p_category: category,
        p_status: state.tab === 'list' ? 'low' : 'enough',
      });
      await loadItems();
    } catch (error) {
      state.notice = error.message;
      render();
    }
  });

  document.querySelector('#share').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.searchParams.set('family', state.family);
    url.searchParams.set('key', state.key);
    await navigator.clipboard.writeText(url.toString());
    state.notice = '邀请链接已复制';
    render();
  });

  document.querySelector('#leave').addEventListener('click', () => {
    if (!confirm('退出后，需要邀请链接才能重新加入。确定退出吗？')) return;
    localStorage.removeItem('buhuo-family');
    history.replaceState(null, '', location.pathname);
    Object.assign(state, { family: '', key: '', familyName: '', items: [], notice: '' });
    render();
  });
}

function render() {
  if (!state.family || !state.key) onboarding();
  else inventory();
}

restoreFamily();
render();
if (state.family && state.key) loadItems();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
