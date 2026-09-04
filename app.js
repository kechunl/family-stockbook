const SUPABASE_URL = 'https://dqrdqwbymxjdynwlzenq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ob-UZorvFy5uh0S7QMPVIw_stUaa4tD';
const STALE_DAYS = 14;

const state = {
  family: '', key: '', familyName: '', items: [], categories: [],
  tab: 'daily', busy: false, notice: '',
};
const app = document.querySelector('#app');

async function rpc(name, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function isStale(item) { return Date.now() - Number(item.updated_at) > STALE_DAYS * 86400000; }
function statusLabel(status) { return { enough: '充足', low: '快用完', out: '用完' }[status] || status; }
function categoryLabel(key) { return state.categories.find(category => category.category_key === key)?.label || key; }

function saveFamily() {
  localStorage.setItem('buhuo-family', JSON.stringify({ family: state.family, key: state.key, familyName: state.familyName }));
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

async function loadAll() {
  if (!state.family || !state.key) return;
  try {
    const [items, categories, family] = await Promise.all([
      rpc('list_inventory_items', { p_family_id: state.family, p_key: state.key }),
      rpc('list_household_categories', { p_family_id: state.family, p_key: state.key }),
      rpc('join_household', { p_key: state.key }),
    ]);
    state.items = Array.isArray(items) ? items : [];
    state.categories = Array.isArray(categories) ? categories : [];
    if (family?.[0]?.family_name) state.familyName = family[0].family_name;
    if (state.tab !== 'list' && !state.categories.some(category => category.category_key === state.tab)) {
      state.tab = state.categories[0]?.category_key || 'daily';
    }
    state.notice = '';
    saveFamily();
  } catch (error) { state.notice = error.message; }
  render();
}

function openModal(content) {
  document.querySelector('.modal-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  document.body.appendChild(layer);
  layer.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => layer.remove()));
  return layer;
}

function setNotice(message) { state.notice = message; render(); }

async function imageToDataUrl(file) {
  if (!file) return null;
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = source;
  });
  const scale = Math.min(1, 900 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/jpeg', 0.72);
  if (result.length > 750000) throw new Error('图片仍然太大，请换一张较小的照片');
  return result;
}

function onboarding() {
  app.innerHTML = `<section class="onboarding">
    <div class="brand-mark">✓</div><h1>补货小本本</h1><p>全家共享库存与购物清单</p>
    <form id="create-form" class="card form-card"><h2>创建一个家庭</h2>
      <label>家庭名称<input name="name" maxlength="80" placeholder="例如：我们家" required /></label>
      <button>创建并开始</button></form>
    <form id="join-form" class="card form-card"><h2>加入家人的库存</h2>
      <label>邀请码<input name="key" placeholder="粘贴家人发来的邀请码" required /></label>
      <button class="secondary">加入家庭</button></form>
    ${state.notice ? `<p class="notice error">${escapeHtml(state.notice)}</p>` : ''}</section>`;

  document.querySelector('#create-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try {
      const [result] = await rpc('create_household', { p_name: new FormData(form).get('name').trim() });
      Object.assign(state, { family: result.family_id, key: result.family_key, familyName: result.family_name });
      saveFamily(); await loadAll();
    } catch (error) { button.disabled = false; setNotice(error.message); }
  });
  document.querySelector('#join-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try {
      const rows = await rpc('join_household', { p_key: new FormData(form).get('key').trim() });
      if (!rows.length) throw new Error('邀请码不正确');
      Object.assign(state, { family: rows[0].family_id, key: rows[0].family_key, familyName: rows[0].family_name });
      saveFamily(); await loadAll();
    } catch (error) { button.disabled = false; setNotice(error.message); }
  });
}

function itemCard(item, shopping) {
  const stale = isStale(item);
  const date = new Date(Number(item.updated_at)).toLocaleDateString('zh-CN');
  return `<article class="item-card ${stale ? 'stale' : ''}">
    ${item.image_data ? `<img class="item-photo" src="${item.image_data}" alt="${escapeHtml(item.name)}" />` : ''}
    <div class="item-info"><div class="item-title">${escapeHtml(item.name)}${stale ? '<span class="dot" title="很久没确认"></span>' : ''}</div>
      <small>${shopping ? categoryLabel(item.category) : `最后确认：${date}`}</small></div>
    ${shopping ? `<button class="bought" data-action="status" data-id="${item.id}" data-status="enough">买到了</button>`
      : `<div class="statuses">${['enough', 'low', 'out'].map(status => `<button data-action="status" data-id="${item.id}" data-status="${status}" class="${item.status === status ? 'selected' : ''}">${statusLabel(status)}</button>`).join('')}</div>`}
  </article>`;
}

function showAddModal() {
  const defaultCategory = state.tab === 'list' ? state.categories[0]?.category_key : state.tab;
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>${state.tab === 'list' ? '添加想买的东西' : '添加用品'}</h2>
    <form id="add-item-form" class="modal-form">
      <label>名称<input name="name" maxlength="120" autocomplete="off" required autofocus /></label>
      <label>分类<select name="category">${state.categories.map(category => `<option value="${category.category_key}" ${category.category_key === defaultCategory ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}</select></label>
      <label class="photo-picker"><span>照片（可选）</span><input id="photo-input" name="photo" type="file" accept="image/*" capture="environment" /><span class="photo-button">📷 拍照或选择照片</span></label>
      <img id="photo-preview" class="photo-preview" hidden alt="照片预览" />
      <div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button type="submit">添加</button></div>
    </form>`);
  const photoInput = layer.querySelector('#photo-input'); const preview = layer.querySelector('#photo-preview');
  photoInput.addEventListener('change', () => { const file = photoInput.files[0]; if (file) { preview.src = URL.createObjectURL(file); preview.hidden = false; } });
  layer.querySelector('#add-item-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = '添加中…';
    try {
      const data = new FormData(form); const image = await imageToDataUrl(data.get('photo'));
      await rpc('add_inventory_item', { p_family_id: state.family, p_key: state.key, p_name: data.get('name').trim(), p_category: data.get('category'), p_status: state.tab === 'list' ? 'low' : 'enough', p_image_data: image });
      layer.remove(); await loadAll();
    } catch (error) { submit.disabled = false; submit.textContent = '添加'; layer.querySelector('.modal-form').insertAdjacentHTML('beforeend', `<p class="notice error">${escapeHtml(error.message)}</p>`); }
  });
}

function showCategoryManager() {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>管理分类</h2>
    <div class="category-list">${state.categories.map(category => `<div><span>${escapeHtml(category.label)}</span><button class="secondary compact" data-rename="${category.category_key}" data-label="${escapeHtml(category.label)}">改名</button></div>`).join('')}</div>
    <form id="add-category-form" class="modal-form inline-form"><input name="label" maxlength="30" placeholder="例如：宠物用品" required /><button>新增</button></form>`);
  layer.querySelectorAll('[data-rename]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.rename; const oldLabel = button.dataset.label;
    const renameLayer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>修改分类名称</h2><form id="rename-form" class="modal-form"><label>名称<input name="label" maxlength="30" value="${escapeHtml(oldLabel)}" required autofocus /></label><div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button>保存</button></div></form>`);
    renameLayer.querySelector('#rename-form').addEventListener('submit', async event => { event.preventDefault(); const label = new FormData(event.currentTarget).get('label').trim(); try { await rpc('rename_household_category', { p_family_id: state.family, p_key: state.key, p_category_key: key, p_label: label }); renameLayer.remove(); await loadAll(); showCategoryManager(); } catch (error) { setNotice(error.message); } });
  }));
  layer.querySelector('#add-category-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const label = new FormData(form).get('label').trim(); try { await rpc('add_household_category', { p_family_id: state.family, p_key: state.key, p_label: label }); layer.remove(); await loadAll(); showCategoryManager(); } catch (error) { setNotice(error.message); } });
}

function showLeaveModal() {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>退出这个家庭？</h2><p>退出后，需要邀请链接才能重新加入。</p><div class="modal-actions"><button class="secondary" data-close>取消</button><button id="confirm-leave" class="danger">确认退出</button></div>`);
  layer.querySelector('#confirm-leave').addEventListener('click', () => { localStorage.removeItem('buhuo-family'); history.replaceState(null, '', location.pathname); Object.assign(state, { family: '', key: '', familyName: '', items: [], categories: [], notice: '' }); layer.remove(); render(); });
}

function inventory() {
  const needs = state.items.filter(item => item.status !== 'enough'); const stale = state.items.filter(isStale);
  const visible = state.tab === 'list' ? needs : state.items.filter(item => item.category === state.tab);
  app.innerHTML = `<header class="topbar"><div><strong>补货小本本</strong><small>${escapeHtml(state.familyName)}</small></div><button id="share" class="secondary compact">分享给家人</button></header>
    <section class="hero"><div><strong>${needs.length}</strong><small>需要购买</small></div><div><strong>${state.items.length - needs.length}</strong><small>库存充足</small></div><div class="${stale.length ? 'has-stale' : ''}"><strong>${stale.length}</strong><small>久未确认</small></div></section>
    ${stale.length ? `<div class="stale-banner"><span class="dot"></span>${stale.length} 件物品超过 ${STALE_DAYS} 天没有确认</div>` : ''}
    <div class="tab-row"><nav class="tabs">${state.categories.map(category => `<button data-tab="${category.category_key}" class="${state.tab === category.category_key ? 'active' : ''}">${escapeHtml(category.label)}</button>`).join('')}<button data-tab="list" class="${state.tab === 'list' ? 'active' : ''}">购物清单${needs.length ? `<em>${needs.length}</em>` : ''}</button></nav><button id="manage-categories" class="manage-labels" aria-label="管理分类">⚙</button></div>
    <section class="items">${visible.length ? visible.map(item => itemCard(item, state.tab === 'list')).join('') : '<div class="empty">这里还没有东西</div>'}</section>
    <button id="floating-add" class="floating-add" aria-label="添加">＋</button>
    ${state.notice ? `<p class="notice ${state.notice.includes('已复制') ? '' : 'error'}">${escapeHtml(state.notice)}</p>` : ''}
    <footer><button id="leave" class="text-button">退出这个家庭</button><span>邀请链接只发给信任的家人</span></footer>`;

  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; state.notice = ''; render(); }));
  document.querySelectorAll('[data-action="status"]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await rpc('set_inventory_status', { p_family_id: state.family, p_key: state.key, p_item_id: button.dataset.id, p_status: button.dataset.status }); await loadAll(); } catch (error) { setNotice(error.message); } }));
  document.querySelector('#floating-add').addEventListener('click', showAddModal);
  document.querySelector('#manage-categories').addEventListener('click', showCategoryManager);
  document.querySelector('#leave').addEventListener('click', showLeaveModal);
  document.querySelector('#share').addEventListener('click', async () => { const url = new URL(location.href); url.searchParams.set('family', state.family); url.searchParams.set('key', state.key); await navigator.clipboard.writeText(url.toString()); setNotice('邀请链接已复制'); });
}

function render() { if (!state.family || !state.key) onboarding(); else inventory(); }
restoreFamily(); render(); if (state.family && state.key) loadAll();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
