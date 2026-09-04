const SUPABASE_URL = 'https://dqrdqwbymxjdynwlzenq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ob-UZorvFy5uh0S7QMPVIw_stUaa4tD';
const STALE_DAYS = 14;

const state = {
  family: '', key: '', familyName: '', items: [], categories: [],
  tab: 'daily', lastCategory: 'daily', mode: 'editor', notice: '', loading: true,
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

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function isStale(item) { return Date.now() - Number(item.updated_at) > STALE_DAYS * 86400000; }
function statusLabel(status) { return { enough: '充足', low: '快用完', out: '用完' }[status] || status; }
function categoryLabel(key) { return state.categories.find(category => category.category_key === key)?.label || key; }
function canEdit() { return state.mode === 'editor'; }
function accessParams() { return { p_family_id: state.family, p_key: state.key }; }

function saveFamily() {
  if (!canEdit() || !state.family) return;
  localStorage.setItem('buhuo-family', JSON.stringify({ family: state.family, key: state.key, familyName: state.familyName }));
}

function restoreAccess() {
  const query = new URLSearchParams(location.search); const guest = query.get('guest');
  if (guest) sessionStorage.setItem('buhuo-guest', guest);
  const guestToken = guest || sessionStorage.getItem('buhuo-guest');
  if (guestToken) {
    Object.assign(state, { family: '', key: guestToken, familyName: '', mode: 'guest' });
    if (guest) history.replaceState(null, '', location.pathname);
    return;
  }
  const saved = JSON.parse(localStorage.getItem('buhuo-family') || '{}');
  const family = query.get('family') || saved.family || ''; const key = query.get('key') || saved.key || '';
  Object.assign(state, { family, key, familyName: saved.familyName || '我们家', mode: 'editor' });
  if (family && key) { saveFamily(); if (query.get('family')) history.replaceState(null, '', location.pathname); }
}

async function resolveGuest() {
  const rows = await rpc('resolve_guest_invite', { p_token: state.key });
  if (!rows?.length) throw new Error('访客链接无效或已经过期');
  state.family = rows[0].family_id; state.familyName = rows[0].family_name;
}

async function loadAll() {
  if (!state.family) return;
  try {
    const [items, categories] = await Promise.all([
      rpc('list_inventory_items', accessParams()),
      rpc('list_household_categories', accessParams()),
    ]);
    state.items = Array.isArray(items) ? items : []; state.categories = Array.isArray(categories) ? categories : [];
    if (canEdit()) {
      const family = await rpc('join_household', { p_key: state.key });
      if (family?.[0]?.family_name) state.familyName = family[0].family_name;
      saveFamily();
    }
    if (!state.categories.some(category => category.category_key === state.lastCategory)) state.lastCategory = state.categories[0]?.category_key || 'daily';
    if (state.tab !== 'list' && !state.categories.some(category => category.category_key === state.tab)) state.tab = state.lastCategory;
    state.notice = '';
  } catch (error) { state.notice = error.message; }
  state.loading = false; render();
}

function openModal(content) {
  document.querySelector('.modal-layer')?.remove(); const layer = document.createElement('div'); layer.className = 'modal-layer';
  layer.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`; document.body.appendChild(layer);
  layer.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => layer.remove())); return layer;
}
function setNotice(message) { state.notice = message; render(); }
function showInlineError(container, message) { container.querySelector('.notice')?.remove(); container.insertAdjacentHTML('beforeend', `<p class="notice error">${escapeHtml(message)}</p>`); }

function onboarding() {
  app.innerHTML = `<section class="onboarding"><div class="brand-mark">✓</div><h1>补货小本本</h1><p>全家共享库存与购物清单</p>
    <form id="create-form" class="card form-card"><h2>创建一个家庭</h2><label>家庭名称<input name="name" maxlength="80" placeholder="例如：我们家" required /></label><button>创建并开始</button></form>
    <form id="join-form" class="card form-card"><h2>加入家人的库存</h2><label>邀请码<input name="key" placeholder="粘贴家人发来的邀请码" required /></label><button class="secondary">加入家庭</button></form>
    ${state.notice ? `<p class="notice error">${escapeHtml(state.notice)}</p>` : ''}</section>`;
  document.querySelector('#create-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true; try { const [result] = await rpc('create_household', { p_name: new FormData(form).get('name').trim() }); Object.assign(state, { family: result.family_id, key: result.family_key, familyName: result.family_name, mode: 'editor', loading: true }); saveFamily(); render(); await loadAll(); } catch (error) { button.disabled = false; showInlineError(form, error.message); } });
  document.querySelector('#join-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true; try { const rows = await rpc('join_household', { p_key: new FormData(form).get('key').trim() }); if (!rows?.length) throw new Error('邀请码不正确'); Object.assign(state, { family: rows[0].family_id, key: rows[0].family_key, familyName: rows[0].family_name, mode: 'editor', loading: true }); saveFamily(); render(); await loadAll(); } catch (error) { button.disabled = false; showInlineError(form, error.message); } });
}

async function imageToDataUrl(file) {
  if (!file || !file.size) return null;
  const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = source; });
  const scale = Math.min(1, 900 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/jpeg', 0.72); if (result.length > 750000) throw new Error('图片仍然太大，请换一张较小的照片'); return result;
}

function itemCard(item, shopping) {
  const editable = canEdit(); const stale = isStale(item); const date = new Date(Number(item.updated_at)).toLocaleDateString('zh-CN');
  const card = `<article class="item-card ${stale ? 'stale' : ''}">${item.image_data ? `<button class="item-photo-button" data-photo-id="${item.id}" aria-label="查看${escapeHtml(item.name)}的照片"><img class="item-photo" src="${item.image_data}" alt="" /></button>` : ''}<div class="item-info"><div class="item-title">${escapeHtml(item.name)}${stale ? '<span class="dot" title="很久没确认"></span>' : ''}</div><small>${shopping ? categoryLabel(item.category) : `最后确认：${date}`}</small></div>${editable ? (shopping ? `<button class="bought" data-action="status" data-id="${item.id}" data-status="enough">买到了</button>` : `<div class="statuses">${['enough', 'low', 'out'].map(status => `<button data-action="status" data-id="${item.id}" data-status="${status}" class="${item.status === status ? 'selected' : ''}">${statusLabel(status)}</button>`).join('')}</div>`) : `<span class="status-badge ${item.status}">${shopping ? '需购买' : statusLabel(item.status)}</span>`}</article>`;
  return editable ? `<div class="swipe-row" data-item-id="${item.id}"><button class="swipe-action swipe-delete" data-swipe-action="delete">删除</button><button class="swipe-action swipe-edit" data-swipe-action="edit">编辑</button>${card}</div>` : card;
}

function showEditModal(item) {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>编辑物品</h2><form id="edit-item-form" class="modal-form"><label>名称<input name="name" maxlength="120" value="${escapeHtml(item.name)}" required autofocus /></label><label>分类<select name="category">${state.categories.map(category => `<option value="${category.category_key}" ${category.category_key === item.category ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}</select></label><label class="photo-picker"><span>${item.image_data ? '更换照片（可选）' : '照片（可选）'}</span><input id="edit-photo-input" name="photo" type="file" accept="image/*" capture="environment" /><span class="photo-button">📷 拍照或选择照片</span></label><img id="edit-photo-preview" class="photo-preview" ${item.image_data ? `src="${item.image_data}"` : 'hidden'} alt="照片预览" />${item.image_data ? '<label class="checkbox-row"><input name="removePhoto" type="checkbox" />移除现有照片</label>' : ''}<div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button type="submit">保存</button></div></form>`);
  const photoInput = layer.querySelector('#edit-photo-input'); const preview = layer.querySelector('#edit-photo-preview'); photoInput.addEventListener('change', () => { const file = photoInput.files[0]; if (file) { preview.src = URL.createObjectURL(file); preview.hidden = false; const remove = layer.querySelector('[name="removePhoto"]'); if (remove) remove.checked = false; } });
  layer.querySelector('#edit-item-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; try { const data = new FormData(form); const file = data.get('photo'); const image = data.get('removePhoto') ? '' : (file?.size ? await imageToDataUrl(file) : null); await rpc('update_inventory_item', { ...accessParams(), p_item_id: item.id, p_name: data.get('name').trim(), p_category: data.get('category'), p_image_data: image }); layer.remove(); await loadAll(); } catch (error) { submit.disabled = false; showInlineError(form, error.message); } });
}

function showDeleteModal(item) {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>删除“${escapeHtml(item.name)}”？</h2><p>删除后无法恢复。库存和购物清单里都会移除这个物品。</p><div class="modal-actions"><button class="secondary" data-close>取消</button><button id="confirm-delete" class="danger">确认删除</button></div>`);
  layer.querySelector('#confirm-delete').addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { await rpc('delete_inventory_item', { ...accessParams(), p_item_id: item.id }); layer.remove(); await loadAll(); } catch (error) { button.disabled = false; showInlineError(layer.querySelector('.modal'), error.message); } });
}

function showImageModal(item) { openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>${escapeHtml(item.name)}</h2><img class="photo-full" src="${item.image_data}" alt="${escapeHtml(item.name)}" />`); }
function bindItemPhotos() { document.querySelectorAll('[data-photo-id]').forEach(button => button.addEventListener('click', () => { const item = state.items.find(row => row.id === button.dataset.photoId); if (item) showImageModal(item); })); }

function bindSwipeGestures() {
  const closeRows = except => document.querySelectorAll('.swipe-row').forEach(row => { if (row !== except) { row.dataset.open = ''; row.querySelector('.item-card').style.transform = ''; } });
  document.querySelectorAll('.swipe-row').forEach(row => {
    const card = row.querySelector('.item-card'); const item = state.items.find(candidate => candidate.id === row.dataset.itemId); if (!item) return; let startX = 0; let startY = 0; let tracking = false;
    card.addEventListener('touchstart', event => { if (event.touches.length !== 1 || event.target.closest('button')) return; closeRows(row); row.dataset.open = ''; card.style.transform = ''; startX = event.touches[0].clientX; startY = event.touches[0].clientY; tracking = true; }, { passive: true });
    card.addEventListener('touchmove', event => { if (!tracking) return; const dx = event.touches[0].clientX - startX; const dy = event.touches[0].clientY - startY; if (Math.abs(dx) > Math.abs(dy)) card.style.transform = `translateX(${Math.max(-88, Math.min(88, dx))}px)`; }, { passive: true });
    card.addEventListener('touchend', event => { if (!tracking) return; tracking = false; const dx = event.changedTouches[0].clientX - startX; const dy = event.changedTouches[0].clientY - startY; if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) { card.style.transform = ''; return; } row.dataset.open = dx < 0 ? 'edit' : 'delete'; card.style.transform = `translateX(${dx < 0 ? -82 : 82}px)`; }, { passive: true });
    card.addEventListener('touchcancel', () => { tracking = false; card.style.transform = ''; }, { passive: true }); card.addEventListener('click', event => { if (!row.dataset.open || event.target.closest('button')) return; row.dataset.open = ''; card.style.transform = ''; });
    row.querySelector('[data-swipe-action="edit"]').addEventListener('click', () => { closeRows(); showEditModal(item); }); row.querySelector('[data-swipe-action="delete"]').addEventListener('click', () => { closeRows(); showDeleteModal(item); });
  });
}

function showAddModal() {
  const defaultCategory = state.tab === 'list' ? state.lastCategory : state.tab;
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>${state.tab === 'list' ? '添加想买的东西' : '添加用品'}</h2><form id="add-item-form" class="modal-form"><label>名称<input name="name" maxlength="120" required autofocus /></label><label>分类<select name="category">${state.categories.map(category => `<option value="${category.category_key}" ${category.category_key === defaultCategory ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}</select></label><label class="photo-picker"><span>照片（可选）</span><input id="photo-input" name="photo" type="file" accept="image/*" capture="environment" /><span class="photo-button">📷 拍照或选择照片</span></label><img id="photo-preview" class="photo-preview" hidden alt="照片预览" /><div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button type="submit">添加</button></div></form>`);
  const photoInput = layer.querySelector('#photo-input'); const preview = layer.querySelector('#photo-preview'); photoInput.addEventListener('change', () => { const file = photoInput.files[0]; if (file) { preview.src = URL.createObjectURL(file); preview.hidden = false; } });
  layer.querySelector('#add-item-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; try { const data = new FormData(form); await rpc('add_inventory_item', { ...accessParams(), p_name: data.get('name').trim(), p_category: data.get('category'), p_status: state.tab === 'list' ? 'low' : 'enough', p_image_data: await imageToDataUrl(data.get('photo')) }); layer.remove(); await loadAll(); } catch (error) { submit.disabled = false; showInlineError(form, error.message); } });
}

function showCategoryPicker() {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>选择分类</h2><div class="category-picker-grid">${state.categories.map(category => `<button data-pick-category="${category.category_key}" class="${state.lastCategory === category.category_key ? 'selected' : 'secondary'}">${escapeHtml(category.label)}</button>`).join('')}</div>`);
  layer.querySelectorAll('[data-pick-category]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.pickCategory; state.lastCategory = state.tab; layer.remove(); render(); }));
}

function showCategoryManager() {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>管理分类</h2><div class="category-list">${state.categories.map(category => `<div><span>${escapeHtml(category.label)}</span><button class="secondary compact" data-rename="${category.category_key}" data-label="${escapeHtml(category.label)}">改名</button></div>`).join('')}</div><form id="add-category-form" class="modal-form inline-form"><input name="label" maxlength="30" placeholder="例如：宠物用品" required /><button>新增</button></form>`);
  layer.querySelectorAll('[data-rename]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.rename; const renameLayer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>修改分类名称</h2><form id="rename-form" class="modal-form"><label>名称<input name="label" maxlength="30" value="${escapeHtml(button.dataset.label)}" required autofocus /></label><div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button>保存</button></div></form>`); renameLayer.querySelector('#rename-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; try { await rpc('rename_household_category', { ...accessParams(), p_category_key: key, p_label: new FormData(form).get('label').trim() }); renameLayer.remove(); await loadAll(); showCategoryManager(); } catch (error) { showInlineError(form, error.message); } }); }));
  layer.querySelector('#add-category-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; try { await rpc('add_household_category', { ...accessParams(), p_label: new FormData(form).get('label').trim() }); layer.remove(); await loadAll(); showCategoryManager(); } catch (error) { showInlineError(form, error.message); } });
}

function copyEditorLink() {
  const url = new URL(location.origin + location.pathname); url.searchParams.set('family', state.family); url.searchParams.set('key', state.key); return navigator.clipboard.writeText(url.toString());
}

function showShareModal() {
  const layer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>分享“${escapeHtml(state.familyName)}”</h2><div class="share-options"><button id="share-editor"><strong>分享给家庭成员</strong><small>获得完整编辑权限</small></button><button id="share-guest" class="secondary"><strong>分享只读访客链接</strong><small>无需注册，不能修改</small></button></div><button id="revoke-guests" class="text-button danger-text">撤销所有访客链接</button>`);
  layer.querySelector('#share-editor').addEventListener('click', async () => { await copyEditorLink(); layer.remove(); setNotice('家庭成员链接已复制'); });
  layer.querySelector('#share-guest').addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { const [row] = await rpc('create_guest_invite', { ...accessParams(), p_days: 30 }); const url = new URL(location.origin + location.pathname); url.searchParams.set('guest', row.invite_token); await navigator.clipboard.writeText(url.toString()); layer.querySelector('.modal').innerHTML = `<button class="modal-close" data-close aria-label="关闭">×</button><h2>访客链接已复制</h2><p>访客无需注册，只能查看。链接将在 30 天后过期。</p><div class="share-link">${escapeHtml(url.toString())}</div>`; layer.querySelector('[data-close]').addEventListener('click', () => layer.remove()); } catch (error) { button.disabled = false; showInlineError(layer.querySelector('.modal'), error.message); } });
  layer.querySelector('#revoke-guests').addEventListener('click', () => { const confirmLayer = openModal(`<button class="modal-close" data-close aria-label="关闭">×</button><h2>撤销所有访客链接？</h2><p>已经发出去的访客链接会立即失效，家庭成员链接不受影响。</p><div class="modal-actions"><button class="secondary" data-close>取消</button><button id="confirm-revoke" class="danger">确认撤销</button></div>`); confirmLayer.querySelector('#confirm-revoke').addEventListener('click', async () => { try { await rpc('revoke_guest_invites', accessParams()); confirmLayer.remove(); setNotice('所有访客链接已撤销'); } catch (error) { showInlineError(confirmLayer.querySelector('.modal'), error.message); } }); });
}

function leave() {
  if (canEdit()) localStorage.removeItem('buhuo-family'); else sessionStorage.removeItem('buhuo-guest');
  history.replaceState(null, '', location.pathname); Object.assign(state, { family: '', key: '', familyName: '', items: [], categories: [], mode: 'editor', notice: '', loading: false }); render();
}

function inventory() {
  const editable = canEdit(); const needs = state.items.filter(item => item.status !== 'enough'); const stale = state.items.filter(isStale); const visible = state.tab === 'list' ? needs : state.items.filter(item => item.category === state.tab);
  app.innerHTML = `<header class="topbar"><div><strong>补货小本本</strong><small>${escapeHtml(state.familyName)}</small></div>${editable ? '<button id="share" class="secondary compact">分享</button>' : '<span class="readonly-pill">只读访客</span>'}</header>${!editable ? '<div class="readonly-banner">访客只读模式 · 可以查看库存和购物清单，但不能修改</div>' : ''}<section class="hero"><div><strong>${needs.length}</strong><small>需要购买</small></div><div><strong>${state.items.length - needs.length}</strong><small>库存充足</small></div><div class="${stale.length ? 'has-stale' : ''}"><strong>${stale.length}</strong><small>久未确认</small></div></section>${stale.length ? `<div class="stale-banner"><span class="dot"></span>${stale.length} 件物品超过 ${STALE_DAYS} 天没有确认</div>` : ''}<div class="inventory-tools ${editable ? '' : 'guest-tools'}"><button id="category-picker" class="category-picker"><span>分类</span><strong>${escapeHtml(categoryLabel(state.lastCategory))}</strong><i aria-hidden="true">⌄</i></button><button id="shopping-toggle" class="tool-icon ${state.tab === 'list' ? 'active' : ''}" aria-label="购物清单"><span>🛒</span>${needs.length ? `<em>${needs.length}</em>` : ''}</button>${editable ? '<button id="manage-categories" class="tool-icon" aria-label="管理分类">⚙</button>' : ''}</div><div class="section-heading"><h2>${state.tab === 'list' ? '购物清单' : escapeHtml(categoryLabel(state.tab))}</h2>${editable && visible.length ? '<small>左滑编辑 · 右滑删除</small>' : ''}</div><section class="items">${visible.length ? visible.map(item => itemCard(item, state.tab === 'list')).join('') : `<div class="empty">${state.tab === 'list' ? '购物清单是空的' : '这个分类还没有东西'}</div>`}</section>${editable ? '<button id="floating-add" class="floating-add" aria-label="添加">＋</button>' : ''}${state.notice ? `<p class="notice ${state.notice.includes('复制') || state.notice.includes('撤销') ? '' : 'error'}">${escapeHtml(state.notice)}</p>` : ''}<footer><button id="leave" class="text-button">${editable ? '退出这个家庭' : '退出访客查看'}</button><span>${editable ? '分享时请选择成员权限或只读权限' : '这个链接只能查看'}</span></footer>`;
  document.querySelector('#share')?.addEventListener('click', showShareModal); document.querySelector('#category-picker').addEventListener('click', showCategoryPicker); document.querySelector('#shopping-toggle').addEventListener('click', () => { state.tab = state.tab === 'list' ? state.lastCategory : 'list'; render(); }); document.querySelector('#manage-categories')?.addEventListener('click', showCategoryManager); document.querySelector('#floating-add')?.addEventListener('click', showAddModal); document.querySelector('#leave').addEventListener('click', leave);
  document.querySelectorAll('[data-action="status"]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await rpc('set_inventory_status', { ...accessParams(), p_item_id: button.dataset.id, p_status: button.dataset.status }); await loadAll(); } catch (error) { setNotice(error.message); } })); bindItemPhotos(); if (editable) bindSwipeGestures();
}

function render() {
  if (state.loading) { app.innerHTML = '<div class="loading"><div class="brand-mark">✓</div><p>正在打开补货小本本…</p></div>'; return; }
  if (!state.family) { onboarding(); return; }
  inventory();
}

async function initialise() {
  restoreAccess();
  try { if (state.mode === 'guest') await resolveGuest(); if (state.family) { await loadAll(); return; } }
  catch (error) { state.notice = error.message; Object.assign(state, { family: '', key: '', familyName: '', mode: 'editor' }); sessionStorage.removeItem('buhuo-guest'); }
  state.loading = false; render();
}

render(); initialise();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
