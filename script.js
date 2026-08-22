// ========== OtlumGram v2.0 — Full API Client ==========
const API_BASE = '';
let token = localStorage.getItem('jwt');
let currentUser = null;
let pollIntervals = [];
let lastMessageIds = {};

// ========== API HELPER ==========
async function api(method, endpoint, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch(API_BASE + '/api' + endpoint, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 401) { logout(); return null; }
            throw new Error(data.error || 'Ошибка сети');
        }
        return data;
    } catch (e) {
        showToast(e.message || 'Нет соединения с сервером', 'error');
        return null;
    }
}

// ========== UTILS ==========
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getDisplayName(user) {
    return escapeHtml(user?.premiumNick || user?.fullname || user?.username || '???');
}
function getUserTag(user) {
    if (!user) return { class: 'tag-member', text: '💠 Участник' };
    if (user.isBanned) return { class: 'tag-banned', text: '⛔️ Забанен' };
    if (user.isScam) return { class: 'tag-scam', text: '🚫 Скам' };
    if (user.isPremium) return { class: 'tag-premium', text: '⭐️ Премиум' };
    if (user.isAdmin) return { class: 'tag-admin', text: '⚡️ Админ' };
    if (user.isDev) return { class: 'tag-creator', text: '🔱 Создатель' };
    return { class: 'tag-member', text: '💠 Участник' };
}
function canWrite(user) {
    if (!user) return false;
    if (user.isDev) return true;
    if (user.isBanned || user.isScam) return false;
    return true;
}
function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

// ========== TOAST ==========
function showToast(text, type = 'info') {
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.borderColor = type === 'error' ? '#ff4757' : (type === 'success' ? '#00d2ff' : '#333');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ========== LOADING ==========
function showLoading(show) {
    let el = document.getElementById('globalLoading');
    if (!el) {
        el = document.createElement('div');
        el.id = 'globalLoading';
        el.className = 'loading-overlay';
        el.innerHTML = '<div class="spinner"></div><div>Загрузка...</div>';
        document.body.appendChild(el);
    }
    el.classList.toggle('show', show);
}

// ========== AUTH ==========
async function login(username, password) {
    showLoading(true);
    const data = await api('POST', '/auth/login', { username, password });
    showLoading(false);
    if (!data) return;
    if (data.error === 'banned') { showBanModal(data.user); return; }
    if (data.token) {
        token = data.token;
        localStorage.setItem('jwt', token);
        currentUser = data.user;
        document.getElementById('authModal').style.display = 'none';
        updateUI();
        showToast('Добро пожаловать, ' + getDisplayName(currentUser) + '!', 'success');
        startPolling();
    }
}

async function register(fullname, username, password, email, phone) {
    showLoading(true);
    const data = await api('POST', '/auth/register', { fullname, username, password, email, phone });
    showLoading(false);
    if (!data) return;
    showToast('Регистрация успешна! Теперь войдите', 'success');
    document.querySelector('.auth-tab[data-auth="login"]').click();
}

function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('jwt');
    stopPolling();
    showAuthModal();
    updateUI();
}

async function loadMe() {
    if (!token) return false;
    const data = await api('GET', '/auth/me');
    if (data?.user) {
        currentUser = data.user;
        updateUI();
        startPolling();
        return true;
    }
    return false;
}

// ========== BAN MODAL ==========
function showBanModal(user) {
    const modal = document.getElementById('banModal');
    document.getElementById('banUserName').innerText = getDisplayName(user);
    document.getElementById('banReasonText').innerText = user.banReason || 'Нарушение правил';
    document.getElementById('banBy').innerText = user.bannedBy || 'Администрация';
    document.getElementById('banRole').innerText = user.bannedByRole || 'Администратор';
    document.getElementById('banDate').innerText = user.banDate || new Date().toLocaleDateString();
    document.getElementById('banExpiry').innerText = user.banExpiry || 'Навсегда';
    modal.style.display = 'flex';
}

// ========== UI RENDERERS ==========
async function updateUI() {
    if (!currentUser) {
        document.getElementById('avatarEmoji').innerText = '👤';
        document.getElementById('profileInfo').innerHTML = '<div class="settings-section"><h3>Не авторизован</h3></div>';
        document.getElementById('adminBurgerBtn').style.display = 'none';
        return;
    }
    document.getElementById('avatarEmoji').innerText = currentUser.avatar || '👤';
    document.getElementById('editFullname').value = currentUser.fullname || '';
    document.getElementById('editUsername').value = currentUser.username || '';
    const tag = getUserTag(currentUser);
    document.getElementById('profileInfo').innerHTML = `<div class="settings-section"><h3>👤 ${getDisplayName(currentUser)} <span class="${tag.class}">${tag.text}</span></h3><p>@${escapeHtml(currentUser.username)}</p>${currentUser.isDev?'<p>👑 Разработчик</p>':''}${currentUser.isAdmin?'<p>⚡️ Админ</p>':''}${currentUser.isPremium?'<p>⭐️ Премиум</p>':''}</div>`;
    document.getElementById('adminBurgerBtn').style.display = (currentUser.isAdmin || currentUser.isDev) ? 'block' : 'none';

    await Promise.all([
        renderNews(), renderChannels(), renderGroups(), renderChats(),
        renderLeaderboard(), renderShop(), renderDashboard(), renderBlacklist(),
        renderChatsList(), renderOfficial(), updateBalance(), loadNotes()
    ]);
}

async function updateBalance() {
    const data = await api('GET', '/balance');
    const bal = data?.balance || 0;
    const el = document.getElementById('userCoinsDisplay');
    if (el) el.innerHTML = `<div class="user-coins-card"><div class="coins-value">🪙 ${bal}</div><div>OtlumCoin</div></div>`;
}

async function renderNews() {
    const data = await api('GET', '/news');
    const container = document.getElementById('newsList');
    if (!container) return;
    if (!data?.news?.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📰</div>Новостей пока нет</div>'; return; }
    container.innerHTML = data.news.map(n => `<div class="news-item"><div class="news-title">${escapeHtml(n.title)}</div><div class="news-date">${escapeHtml(n.date)}</div><div class="news-text">${escapeHtml(n.text)}</div></div>`).join('');
}

async function renderChannels() {
    const data = await api('GET', '/channels');
    const container = document.getElementById('allChannelsList');
    if (!container) return;
    if (!data?.channels?.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div>Каналов пока нет</div>'; return; }
    container.innerHTML = data.channels.map(ch => {
        const tag = getUserTag({ isPremium: ch.owner_is_premium, isAdmin: ch.owner_is_admin, isDev: ch.owner_is_dev, isBanned: ch.owner_is_banned, isScam: ch.owner_is_scam });
        return `<div class="channel-card" data-id="${ch.id}"><div class="channel-header"><div class="channel-avatar-large">${ch.avatar || '📢'}</div><div class="channel-info"><div class="channel-name">${escapeHtml(ch.name)} <span class="${tag.class}">${tag.text}</span></div><div class="channel-meta">👑 ${escapeHtml(ch.owner_username)} • 👥 ${ch.subscribers_count || 0} подписчиков</div></div></div><div class="channel-stats">📢 Канал</div></div>`;
    }).join('');
    container.querySelectorAll('.channel-card').forEach(card => {
        card.onclick = () => openChannel(parseInt(card.dataset.id));
    });
}

async function renderGroups() {
    const data = await api('GET', '/groups');
    const container = document.getElementById('groupsList');
    if (!container) return;
    if (!data?.groups?.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>Групп пока нет</div>'; return; }
    container.innerHTML = data.groups.map(g => {
        const tag = getUserTag({ isPremium: g.owner_is_premium, isAdmin: g.owner_is_admin, isDev: g.owner_is_dev, isBanned: g.owner_is_banned, isScam: g.owner_is_scam });
        return `<div class="channel-card" data-id="${g.id}"><div class="channel-header"><div class="channel-avatar-large">${g.avatar || '👥'}</div><div class="channel-info"><div class="channel-name">${escapeHtml(g.name)} <span class="${tag.class}">${tag.text}</span></div><div class="channel-meta">👑 ${escapeHtml(g.owner_username)} • 👥 ${g.members_count || 0} участников</div></div></div><div class="channel-stats">👥 Группа</div></div>`;
    }).join('');
    container.querySelectorAll('.channel-card').forEach(card => {
        card.onclick = () => openGroup(parseInt(card.dataset.id));
    });
}

async function renderChats() {
    const data = await api('GET', '/chats');
    const container = document.getElementById('allChatsList');
    if (!container) return;
    if (!data?.chats?.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div>Чатов пока нет</div>'; return; }
    container.innerHTML = data.chats.map(c => {
        const tag = getUserTag({ isPremium: c.owner_is_premium, isAdmin: c.owner_is_admin, isDev: c.owner_is_dev, isBanned: c.owner_is_banned, isScam: c.owner_is_scam });
        return `<div class="channel-card" data-id="${c.id}"><div class="channel-header"><div class="channel-avatar-large">${c.avatar || '💬'}</div><div class="channel-info"><div class="channel-name">${escapeHtml(c.name)} <span class="${tag.class}">${tag.text}</span></div><div class="channel-meta">👑 ${escapeHtml(c.owner_username)} • 👥 ${c.members_count || 0} участников</div></div></div><div class="channel-stats">💬 Чат</div></div>`;
    }).join('');
    container.querySelectorAll('.channel-card').forEach(card => {
        card.onclick = () => openChat(parseInt(card.dataset.id));
    });
}

async function renderLeaderboard() {
    const data = await api('GET', '/leaderboard');
    const container = document.getElementById('leaderboardList');
    if (!container) return;
    if (!data?.leaderboard?.length) { container.innerHTML = '<div class="empty-state">Пока никто не заработал OtlumCoin</div>'; return; }
    container.innerHTML = data.leaderboard.map((item, i) => {
        const tag = getUserTag(item.user);
        return `<div class="user-card"><div style="display:flex; align-items:center; gap:12px;"><div style="font-size:1.2rem;">#${i+1}</div><div style="font-size:1.5rem;">${item.user.avatar || '👤'}</div><div><strong>${getDisplayName(item.user)}</strong> <span class="${tag.class}">${tag.text}</span></div><div style="margin-left:auto;">🪙 ${item.balance}</div></div></div>`;
    }).join('');
}

async function renderShop() {
    const data = await api('GET', '/shop/gifts');
    const container = document.getElementById('giftsShop');
    if (!container) return;
    container.innerHTML = data?.gifts?.map(g => `
        <div class="gift-card" data-id="${g.id}"><div class="gift-emoji">${g.emoji}</div><div class="gift-name">${escapeHtml(g.name)}</div><div class="gift-price">${g.price} 🪙</div></div>
    `).join('') || '';
    container.querySelectorAll('.gift-card').forEach(card => {
        card.onclick = () => buyGift(parseInt(card.dataset.id));
    });
    const my = await api('GET', '/shop/my-gifts');
    const myContainer = document.getElementById('myGiftsList');
    if (myContainer) {
        if (!my?.gifts?.length) myContainer.innerHTML = '<p>У вас нет подарков</p>';
        else myContainer.innerHTML = `<div class="my-gifts-grid">` + my.gifts.map(g => `<div class="my-gift-item" onclick="showMessageModal('Подарок','${escapeHtml(g.name)}')"><div class="my-gift-emoji">${g.emoji}</div><div class="my-gift-name">${escapeHtml(g.name)}</div></div>`).join('') + `</div>`;
    }
}

async function renderDashboard() {
    const data = await api('GET', '/dashboard');
    const stats = document.getElementById('dashboardStats');
    const channels = document.getElementById('dashboardChannels');
    if (stats) stats.innerHTML = `<div class="dashboard-stats"><div class="stat-card"><div class="stat-value">${data?.channels?.length || 0}</div><div class="stat-label">Каналов</div></div><div class="stat-card"><div class="stat-value">${data?.balance || 0}</div><div class="stat-label">🪙 OtlumCoin</div></div></div>`;
    if (channels) {
        const list = data?.channels || [];
        channels.innerHTML = `<h3>📢 Ваши каналы</h3>` + (list.length ? list.map(ch => `<div class="channel-card" data-id="${ch.id}">${ch.avatar || '📢'} ${escapeHtml(ch.name)}</div>`).join('') : '<p>У вас нет каналов</p>');
        channels.querySelectorAll('.channel-card').forEach(card => {
            card.onclick = () => openChannel(parseInt(card.dataset.id));
        });
    }
}

async function renderBlacklist() {
    const data = await api('GET', '/blacklist');
    const container = document.getElementById('blacklistList');
    if (!container) return;
    if (!data?.list?.length) { container.innerHTML = '<p>Чёрный список пуст</p>'; return; }
    container.innerHTML = data.list.map(u => `<div class="blacklist-item"><div class="blacklist-user"><div>${u.avatar || '👤'} ${getDisplayName(u)}</div></div><button class="unblacklist-btn" data-id="${u.id}">🚫 Удалить</button></div>`).join('');
    container.querySelectorAll('.unblacklist-btn').forEach(btn => {
        btn.onclick = async () => { await api('DELETE', '/blacklist/' + btn.dataset.id); renderBlacklist(); showToast('Удалено из ЧС', 'success'); };
    });
}

async function renderChatsList() {
    const data = await api('GET', '/pm');
    const container = document.getElementById('chatsList');
    if (!container) return;
    if (!data?.chats?.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div>Нет сообщений</div>'; return; }
    container.innerHTML = data.chats.map(c => `<div class="user-card" data-id="${c.user.id}"><div style="display:flex; align-items:center; gap:12px;"><div style="font-size:1.5rem;">${c.user.avatar || '👤'}</div><div style="flex:1;"><strong>${getDisplayName(c.user)}</strong><div style="font-size:0.7rem;">${escapeHtml(c.lastMessage?.text?.substring(0,30) || '')}</div></div><div style="font-size:0.6rem;">${formatTime(c.lastMessage?.created_at)}</div></div></div>`).join('');
    container.querySelectorAll('.user-card').forEach(card => {
        card.onclick = () => openPrivateChat(parseInt(card.dataset.id));
    });
}

async function renderOfficial() {
    const data = await api('GET', '/official');
    const container = document.getElementById('officialMessages');
    if (!container) return;
    if (!data?.messages?.length) { container.innerHTML = '<div class="empty-state">Сообщений пока нет</div>'; return; }
    container.innerHTML = data.messages.map(msg => {
        const tag = getUserTag({ isPremium: msg.author_is_premium, isAdmin: msg.author_is_admin, isDev: msg.author_is_dev, isBanned: msg.author_is_banned, isScam: msg.author_is_scam });
        return `<div class="message"><div class="message-author">👑 ${escapeHtml(msg.author_username || 'OtlumDev')} <span class="${tag.class}">${tag.text}</span> <span class="premium-verified">✔️</span></div><div class="message-text">${escapeHtml(msg.text)}</div><div class="message-time">${formatTime(msg.created_at)}</div></div>`;
    }).join('');
    const inputArea = document.getElementById('officialInputArea');
    if (inputArea) inputArea.style.display = (currentUser?.isDev) ? 'block' : 'none';
}

async function loadNotes() {
    const data = await api('GET', '/notes');
    const textarea = document.getElementById('userNotes');
    if (textarea) textarea.value = data?.notes || '';
}

// ========== INTERACTIONS ==========
async function createChannel() {
    if (!canWrite(currentUser)) return showToast('Вы не можете создавать каналы', 'error');
    const name = document.getElementById('channelName').value.trim();
    const avatar = document.getElementById('channelAvatar').value.trim();
    const link = document.getElementById('channelLink').value.trim();
    if (!name) return showToast('Введите название', 'error');
    const data = await api('POST', '/channels', { name, avatar, customLink: link });
    if (data?.success) {
        document.getElementById('createChannelModal').style.display = 'none';
        document.getElementById('channelName').value = '';
        document.getElementById('channelAvatar').value = '';
        document.getElementById('channelLink').value = '';
        showToast('Канал создан!', 'success');
        renderChannels();
    }
}

async function createGroup() {
    if (!canWrite(currentUser)) return showToast('Нельзя создавать группы', 'error');
    const name = document.getElementById('groupName').value.trim();
    const avatar = document.getElementById('groupAvatar').value.trim();
    if (!name) return showToast('Введите название', 'error');
    const data = await api('POST', '/groups', { name, avatar });
    if (data?.success) {
        document.getElementById('createGroupModal').style.display = 'none';
        document.getElementById('groupName').value = '';
        document.getElementById('groupAvatar').value = '';
        showToast('Группа создана!', 'success');
        renderGroups();
    }
}

async function createChat() {
    if (!canWrite(currentUser)) return showToast('Нельзя создавать чаты', 'error');
    const name = document.getElementById('chatName').value.trim();
    const avatar = document.getElementById('chatAvatar').value.trim();
    if (!name) return showToast('Введите название', 'error');
    const data = await api('POST', '/chats', { name, avatar });
    if (data?.success) {
        document.getElementById('createChatModal').style.display = 'none';
        document.getElementById('chatName').value = '';
        document.getElementById('chatAvatar').value = '';
        showToast('Чат создан!', 'success');
        renderChats();
    }
}

async function buyGift(giftId) {
    const data = await api('POST', '/shop/buy', { giftId });
    if (data?.success) { showToast('Подарок куплен!', 'success'); renderShop(); updateBalance(); }
}

async function buyPremium() {
    const data = await api('POST', '/premium/buy');
    if (data?.success) { showToast('Премиум активирован!', 'success'); loadMe(); }
}

async function saveProfile() {
    const fullname = document.getElementById('editFullname').value;
    const username = document.getElementById('editUsername').value;
    await api('PUT', '/users/me', { fullname, username, avatar: currentUser.avatar, avatarData: currentUser.avatarData, premiumNick: currentUser.premiumNick });
    showToast('Профиль обновлён', 'success');
    loadMe();
}

async function saveNotes() {
    const notes = document.getElementById('userNotes').value;
    await api('POST', '/notes', { notes });
    showToast('Заметки сохранены', 'success');
}

async function sendOfficial() {
    const text = document.getElementById('officialMessageInput').value.trim();
    if (!text) return;
    const data = await api('POST', '/official', { text });
    if (data?.success) { document.getElementById('officialMessageInput').value = ''; renderOfficial(); }
}

async function addNews() {
    const title = document.getElementById('newsTitle').value;
    const text = document.getElementById('newsText').value;
    if (!title || !text) return showToast('Заполните поля', 'error');
    const data = await api('POST', '/news', { title, text });
    if (data?.success) { document.getElementById('newsTitle').value = ''; document.getElementById('newsText').value = ''; renderNews(); showToast('Новость добавлена', 'success'); }
}

async function submitHelp() {
    const q = document.getElementById('helpQuestion').value.trim();
    if (!q) return showToast('Напишите вопрос', 'error');
    const data = await api('POST', '/help', { question: q });
    if (data?.success) { document.getElementById('helpQuestion').value = ''; document.getElementById('helpModal').style.display = 'none'; showToast('Вопрос отправлен', 'success'); }
}

async function submitComplaint() {
    const targetId = document.getElementById('complaintUserSelect').value;
    const reason = document.getElementById('complaintReason').value.trim();
    if (!targetId) return showToast('Выберите пользователя', 'error');
    if (!reason) return showToast('Напишите причину', 'error');
    const data = await api('POST', '/complaints', { targetUserId: parseInt(targetId), reason });
    if (data?.success) { document.getElementById('complaintModal').style.display = 'none'; document.getElementById('complaintReason').value = ''; showToast('Жалоба отправлена', 'success'); }
}

// ========== MODAL OPENERS ==========
let currentOpenType = null;
let currentOpenId = null;

async function openChannel(id) {
    currentOpenType = 'channel';
    currentOpenId = id;
    const data = await api('GET', '/channels/' + id);
    if (!data?.channel) return;
    const ch = data.channel;
    const modal = document.getElementById('channelModal');
    const header = document.getElementById('channelModalHeader');
    const actions = document.getElementById('channelActions');
    const ownerTag = getUserTag({ isPremium: ch.owner_is_premium, isAdmin: ch.owner_is_admin, isDev: ch.owner_is_dev });
    header.innerHTML = `<div class="channel-header"><div class="channel-avatar-large">${ch.avatar || '📢'}</div><div class="channel-info"><div class="channel-name">${escapeHtml(ch.name)} <span class="${ownerTag.class}">${ownerTag.text}</span></div><div class="channel-meta">👑 ${escapeHtml(ch.owner_username)} • 👥 ${(ch.subscribers || []).length} подписчиков</div></div></div>`;
    actions.innerHTML = '';
    if (!ch.isSubscribed && ch.owner_id !== currentUser.id) actions.innerHTML += `<button id="subChannelBtn">➕ Подписаться</button>`;
    document.getElementById('subChannelBtn')?.addEventListener('click', async () => { await api('POST', '/channels/' + id + '/subscribe'); openChannel(id); });
    await loadMessages('channel', id);
    modal.style.display = 'flex';
}

async function openGroup(id) {
    currentOpenType = 'group';
    currentOpenId = id;
    const data = await api('GET', '/groups/' + id);
    if (!data?.group) return;
    const g = data.group;
    const modal = document.getElementById('channelModal');
    const header = document.getElementById('channelModalHeader');
    const actions = document.getElementById('channelActions');
    const ownerTag = getUserTag({ isPremium: g.owner_is_premium, isAdmin: g.owner_is_admin, isDev: g.owner_is_dev });
    header.innerHTML = `<div class="channel-header"><div class="channel-avatar-large">${g.avatar || '👥'}</div><div class="channel-info"><div class="channel-name">${escapeHtml(g.name)} <span class="${ownerTag.class}">${ownerTag.text}</span></div><div class="channel-meta">👑 ${escapeHtml(g.owner_username)} • 👥 ${(g.members || []).length} участников</div></div></div>`;
    actions.innerHTML = '';
    if (!g.isMember) actions.innerHTML += `<button id="joinGroupBtn">➕ Вступить</button>`;
    else actions.innerHTML += `<button id="leaveGroupBtn" style="background:#ff4757;">🚪 Покинуть</button>`;
    document.getElementById('joinGroupBtn')?.addEventListener('click', async () => { await api('POST', '/groups/' + id + '/join'); openGroup(id); });
    document.getElementById('leaveGroupBtn')?.addEventListener('click', async () => { await api('DELETE', '/groups/' + id + '/leave'); modal.style.display = 'none'; showToast('Вы покинули группу', 'success'); renderGroups(); });
    await loadMessages('group', id);
    modal.style.display = 'flex';
}

async function openChat(id) {
    currentOpenType = 'chat';
    currentOpenId = id;
    const data = await api('GET', '/chats/' + id);
    if (!data?.chat) return;
    const c = data.chat;
    const modal = document.getElementById('channelModal');
    const header = document.getElementById('channelModalHeader');
    const actions = document.getElementById('channelActions');
    const ownerTag = getUserTag({ isPremium: c.owner_is_premium, isAdmin: c.owner_is_admin, isDev: c.owner_is_dev });
    header.innerHTML = `<div class="channel-header"><div class="channel-avatar-large">${c.avatar || '💬'}</div><div class="channel-info"><div class="channel-name">${escapeHtml(c.name)} <span class="${ownerTag.class}">${ownerTag.text}</span></div><div class="channel-meta">👑 ${escapeHtml(c.owner_username)} • 👥 ${(c.members || []).length} участников</div></div></div>`;
    actions.innerHTML = '';
    if (!c.isMember) actions.innerHTML += `<button id="joinChatBtn">➕ Вступить</button>`;
    else actions.innerHTML += `<button id="leaveChatBtn" style="background:#ff4757;">🚪 Покинуть</button>`;
    document.getElementById('joinChatBtn')?.addEventListener('click', async () => { await api('POST', '/chats/' + id + '/join'); openChat(id); });
    document.getElementById('leaveChatBtn')?.addEventListener('click', async () => { await api('DELETE', '/chats/' + id + '/leave'); modal.style.display = 'none'; showToast('Вы покинули чат', 'success'); renderChats(); });
    await loadMessages('chat', id);
    modal.style.display = 'flex';
}

async function loadMessages(type, id) {
    const data = await api('GET', '/' + type + 's/' + id + '/messages');
    const container = document.getElementById('channelMessages');
    if (!container || !data?.messages) return;
    container.innerHTML = data.messages.map(msg => renderMessage(msg, type, id)).join('');
    container.scrollTop = container.scrollHeight;
    lastMessageIds[type + '_' + id] = data.messages[data.messages.length - 1]?.id || 0;
}

function renderMessage(msg, type, id) {
    const tag = getUserTag({ isPremium: msg.is_premium, isAdmin: msg.is_admin, isDev: msg.is_dev, isBanned: msg.is_banned, isScam: msg.is_scam });
    const isOwn = msg.user_id === currentUser?.id;
    const reactionsHtml = Object.entries(msg.reactions || {}).map(([emoji, users]) => 
        `<span class="reaction-badge" onclick="addReaction(${msg.id}, '${emoji}', '${type}', ${id})">${emoji} ${users.length}</span>`
    ).join('');
    return `<div class="message ${isOwn ? 'own' : ''}"><div class="message-author">${escapeHtml(msg.username)} <span class="${tag.class}">${tag.text}</span></div><div class="message-text">${escapeHtml(msg.text)}</div><div class="message-time">${formatTime(msg.created_at)}</div><div class="message-reactions">${reactionsHtml}</div></div>`;
}

async function addReaction(msgId, emoji, type, targetId) {
    await api('POST', '/messages/' + msgId + '/react', { emoji });
    loadMessages(type, targetId);
}

async function sendMessage() {
    const text = document.getElementById('channelMessageInput').value.trim();
    if (!text || !currentOpenType || !currentOpenId) return;
    document.getElementById('channelMessageInput').value = '';
    const data = await api('POST', '/' + currentOpenType + 's/' + currentOpenId + '/messages', { text });
    if (data?.success) loadMessages(currentOpenType, currentOpenId);
}

// ========== PRIVATE CHAT ==========
let currentChatUserId = null;

async function openPrivateChat(userId) {
    currentChatUserId = userId;
    const userData = await api('GET', '/users/' + userId);
    if (!userData?.user) return;
    const user = userData.user;
    const chatDiv = document.getElementById('activeChat');
    const chatsListDiv = document.getElementById('chatsList');
    const header = document.getElementById('chatHeader');
    const messagesDiv = document.getElementById('chatMessages');
    const tag = getUserTag(user);
    header.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><div style="font-size:1.5rem;">${user.avatar || '👤'}</div><div><strong>${getDisplayName(user)}</strong> <span class="${tag.class}">${tag.text}</span><br><small>@${escapeHtml(user.username)}</small></div><button id="blChatBtn" style="background:#ff4757; margin-left:auto;">🚫 В ЧС</button></div>`;
    document.getElementById('blChatBtn').onclick = async () => { await api('POST', '/blacklist/' + userId); showToast('Добавлено в ЧС', 'success'); closeChat(); };

    await loadPrivateMessages(userId);
    chatDiv.style.display = 'block';
    chatsListDiv.style.display = 'none';

    const sendBtn = document.getElementById('sendChatMessage');
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
    newSendBtn.onclick = async () => {
        const text = document.getElementById('chatMessageInput').value.trim();
        if (!text) return;
        document.getElementById('chatMessageInput').value = '';
        const data = await api('POST', '/pm/' + userId, { text });
        if (data?.success) loadPrivateMessages(userId);
    };
    document.getElementById('closeChat').onclick = closeChat;
}

async function loadPrivateMessages(userId) {
    const data = await api('GET', '/pm/' + userId);
    const container = document.getElementById('chatMessages');
    if (!container || !data?.messages) return;
    container.innerHTML = data.messages.map(msg => {
        const isOwn = msg.from_user_id === currentUser?.id;
        const tag = getUserTag({ isPremium: msg.from_is_premium, isAdmin: msg.from_is_admin, isDev: msg.from_is_dev, isBanned: msg.from_is_banned, isScam: msg.from_is_scam });
        return `<div class="message ${isOwn ? 'own' : ''}"><div class="message-author">${isOwn ? 'Вы' : escapeHtml(msg.from_username)} <span class="${tag.class}">${tag.text}</span></div><div class="message-text">${escapeHtml(msg.text)}</div><div class="message-time">${formatTime(msg.created_at)}</div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
    lastMessageIds['pm_' + userId] = data.messages[data.messages.length - 1]?.id || 0;
}

function closeChat() {
    document.getElementById('activeChat').style.display = 'none';
    document.getElementById('chatsList').style.display = 'block';
    currentChatUserId = null;
}

// ========== POLLING ==========
function startPolling() {
    stopPolling();
    pollIntervals.push(setInterval(async () => {
        if (!currentUser) return;
        if (currentOpenType && currentOpenId) {
            const data = await api('GET', '/' + currentOpenType + 's/' + currentOpenId + '/messages');
            if (data?.messages?.length) {
                const lastId = data.messages[data.messages.length - 1]?.id;
                if (lastId !== lastMessageIds[currentOpenType + '_' + currentOpenId]) {
                    loadMessages(currentOpenType, currentOpenId);
                }
            }
        }
        if (currentChatUserId) {
            const data = await api('GET', '/pm/' + currentChatUserId);
            if (data?.messages?.length) {
                const lastId = data.messages[data.messages.length - 1]?.id;
                if (lastId !== lastMessageIds['pm_' + currentChatUserId]) {
                    loadPrivateMessages(currentChatUserId);
                }
            }
        }
        renderChatsList();
    }, 2000));
}

function stopPolling() {
    pollIntervals.forEach(clearInterval);
    pollIntervals = [];
}

// ========== ADMIN PANEL ==========
async function renderAdmin() {
    if (!currentUser?.isAdmin && !currentUser?.isDev) return;
    const users = await api('GET', '/admin/users');
    const container = document.getElementById('adminUsersList');
    if (container && users?.users) {
        const search = (document.getElementById('adminSearch')?.value || '').toLowerCase();
        const filtered = users.users.filter(u => u.username.toLowerCase().includes(search) || (u.fullname && u.fullname.toLowerCase().includes(search)));
        container.innerHTML = filtered.map(u => {
            const tag = getUserTag(u);
            const bal = u.balance || 0;
            return `<div class="user-card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;"><div><strong>${u.avatar || '👤'} ${getDisplayName(u)}</strong> <span class="${tag.class}">${tag.text}</span><br><small>@${escapeHtml(u.username)}</small><br>🪙 ${bal}<br>📞 ${escapeHtml(u.phone || 'Не указан')}</div><div style="display:flex; gap:6px; flex-wrap:wrap;">${renderAdminButtons(u)}</div></div>`;
        }).join('');
    }

    const channels = await api('GET', '/admin/channels');
    if (document.getElementById('adminChannelsList') && channels?.channels) {
        document.getElementById('adminChannelsList').innerHTML = channels.channels.map(ch => `<div class="user-card" style="display:flex; justify-content:space-between;"><div><strong>${ch.avatar || '📢'} ${escapeHtml(ch.name)}</strong></div><button onclick="adminDeleteChannel(${ch.id})" style="background:#ff4757;">🗑️</button></div>`).join('');
    }
    const groups = await api('GET', '/admin/groups');
    if (document.getElementById('adminGroupsList') && groups?.groups) {
        document.getElementById('adminGroupsList').innerHTML = groups.groups.map(g => `<div class="user-card" style="display:flex; justify-content:space-between;"><div><strong>${g.avatar || '👥'} ${escapeHtml(g.name)}</strong></div><button onclick="adminDeleteGroup(${g.id})" style="background:#ff4757;">🗑️</button></div>`).join('');
    }
    const chats = await api('GET', '/admin/chats');
    if (document.getElementById('adminChatsList') && chats?.chats) {
        document.getElementById('adminChatsList').innerHTML = chats.chats.map(c => `<div class="user-card" style="display:flex; justify-content:space-between;"><div><strong>${c.avatar || '💬'} ${escapeHtml(c.name)}</strong></div><button onclick="adminDeleteChat(${c.id})" style="background:#ff4757;">🗑️</button></div>`).join('');
    }
    const complaints = await api('GET', '/admin/complaints');
    if (document.getElementById('complaintsList') && complaints?.complaints) {
        document.getElementById('complaintsList').innerHTML = complaints.complaints.map(c => `<div class="user-card"><div><strong>👤 ${escapeHtml(c.target_username)}</strong> (жалоба от ${escapeHtml(c.from_username)})</div><div>📝 ${escapeHtml(c.reason)}</div><div style="display:flex; gap:8px; margin-top:8px;"><button onclick="resolveComplaint(${c.id}, 'scam')">🚫 Скам</button><button onclick="resolveComplaint(${c.id}, 'ban')">⛔ Бан</button><button onclick="resolveComplaint(${c.id}, 'ignore')">❌ Отклонить</button></div></div>`).join('');
    }
    const logs = await api('GET', '/admin/logs');
    if (document.getElementById('generalLogsList') && logs?.logs) {
        document.getElementById('generalLogsList').innerHTML = logs.logs.map(l => `<div class="log-entry">[${formatTime(l.created_at)}] ${escapeHtml(l.username || 'system')}: ${escapeHtml(l.action)}</div>`).join('');
    }
    const banLogs = await api('GET', '/admin/ban-logs');
    if (document.getElementById('banLogsList') && banLogs?.logs) {
        document.getElementById('banLogsList').innerHTML = banLogs.logs.map(l => `<div class="ban-log-entry">[${formatTime(l.created_at)}] ${escapeHtml(l.username || 'system')}: ${escapeHtml(l.action)}</div>`).join('');
    }
}

function renderAdminButtons(u) {
    let html = '';
    if (!u.isDev && currentUser.isDev) html += `<button onclick="makeAdmin(${u.id})" style="background:#ffd700;">👑 Админ</button>`;
    if (!u.isDev && currentUser.isDev && u.isAdmin) html += `<button onclick="removeAdmin(${u.id})" style="background:#ff6b6b;">❌ Убрать</button>`;
    if (!u.isDev && currentUser.isAdmin && !u.isAdmin && !u.isScam) html += `<button onclick="giveScam(${u.id})" style="background:#ff6b6b;">🚫 Скам</button>`;
    if (!u.isDev && currentUser.isAdmin && u.isScam) html += `<button onclick="removeScam(${u.id})" style="background:#00d2ff;">✅ Снять</button>`;
    if (!u.isDev && currentUser.isAdmin) html += `<button onclick="banTempPrompt(${u.id})" style="background:#ff4757;">⏰ Бан</button>`;
    if (!u.isDev && currentUser.isAdmin) html += `<button onclick="banPermaPrompt(${u.id})" style="background:#ff4757;">🔒 Перм</button>`;
    if (!u.isDev && currentUser.isAdmin && u.isBanned) html += `<button onclick="unbanUser(${u.id})" style="background:#00d2ff;">🔓 Разбан</button>`;
    if (currentUser.isDev) html += `<button onclick="addCoinsPrompt(${u.id})" style="background:#ffd700;">🪙 +OtlumCoin</button>`;
    if (currentUser.isDev) html += `<button onclick="givePremium(${u.id})" style="background:#ffd700;">⭐️ Премиум</button>`;
    if (currentUser.isDev && u.isPremium) html += `<button onclick="removePremium(${u.id})" style="background:#ff6b6b;">⭐️ Снять</button>`;
    return html;
}

async function makeAdmin(id) { await api('POST', '/admin/admin', { userId: id }); renderAdmin(); showToast('Админ назначен', 'success'); }
async function removeAdmin(id) { await api('DELETE', '/admin/admin', { userId: id }); renderAdmin(); showToast('Админ снят', 'success'); }
async function giveScam(id) { await api('POST', '/admin/scam', { userId: id }); renderAdmin(); showToast('Скам метка выдана', 'success'); }
async function removeScam(id) { await api('DELETE', '/admin/scam', { userId: id }); renderAdmin(); showToast('Скам метка снята', 'success'); }
async function unbanUser(id) { await api('POST', '/admin/unban', { userId: id }); renderAdmin(); showToast('Разбанен', 'success'); }
async function givePremium(id) { await api('POST', '/admin/premium', { userId: id }); renderAdmin(); showToast('Премиум выдан', 'success'); }
async function removePremium(id) { await api('DELETE', '/admin/premium', { userId: id }); renderAdmin(); showToast('Премиум снят', 'success'); }
async function adminDeleteChannel(id) { await api('DELETE', '/admin/channels/' + id); renderAdmin(); showToast('Канал удалён', 'success'); }
async function adminDeleteGroup(id) { await api('DELETE', '/admin/groups/' + id); renderAdmin(); showToast('Группа удалена', 'success'); }
async function adminDeleteChat(id) { await api('DELETE', '/admin/chats/' + id); renderAdmin(); showToast('Чат удалён', 'success'); }
async function resolveComplaint(id, action) { await api('POST', '/admin/complaints/' + id + '/resolve', { action }); renderAdmin(); showToast('Жалоба обработана', 'success'); }

function banTempPrompt(id) {
    const days = prompt('На сколько дней?', '7');
    if (!days) return;
    const reason = prompt('Причина бана:');
    api('POST', '/admin/ban', { userId: id, days: parseInt(days), reason }).then(() => { renderAdmin(); showToast('Забанен на ' + days + ' дней', 'success'); });
}
function banPermaPrompt(id) {
    const reason = prompt('Причина бана:');
    api('POST', '/admin/ban', { userId: id, reason }).then(() => { renderAdmin(); showToast('Забанен навсегда', 'success'); });
}
function addCoinsPrompt(id) {
    const amount = prompt('Сколько OtlumCoin добавить?', '100');
    if (amount && !isNaN(amount)) api('POST', '/admin/add-coins', { userId: id, amount: parseInt(amount) }).then(() => { renderAdmin(); showToast('Добавлено ' + amount + ' 🪙', 'success'); });
}

// ========== SEARCH ==========
async function setupSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    input.addEventListener('input', async () => {
        const q = input.value.trim();
        const container = document.getElementById('searchResults');
        if (!q) { container.innerHTML = ''; return; }
        const data = await api('GET', '/search?q=' + encodeURIComponent(q));
        let html = '';
        if (data?.channels?.length) html += '<h4>📢 Каналы</h4>' + data.channels.map(ch => `<div class="channel-card" data-id="${ch.id}" data-type="channel">${ch.avatar || '📢'} ${escapeHtml(ch.name)}</div>`).join('');
        if (data?.groups?.length) html += '<h4>👥 Группы</h4>' + data.groups.map(g => `<div class="channel-card" data-id="${g.id}" data-type="group">${g.avatar || '👥'} ${escapeHtml(g.name)}</div>`).join('');
        if (data?.chats?.length) html += '<h4>💬 Чаты</h4>' + data.chats.map(c => `<div class="channel-card" data-id="${c.id}" data-type="chat">${c.avatar || '💬'} ${escapeHtml(c.name)}</div>`).join('');
        container.innerHTML = html || '<p>Ничего не найдено</p>';
        container.querySelectorAll('.channel-card').forEach(card => {
            card.onclick = () => {
                const type = card.dataset.type;
                const id = parseInt(card.dataset.id);
                if (type === 'channel') openChannel(id);
                else if (type === 'group') openGroup(id);
                else openChat(id);
            };
        });
    });
}

async function setupProfileSearch() {
    const input = document.getElementById('profileSearchInput');
    if (!input) return;
    input.addEventListener('input', async () => {
        const q = input.value.trim();
        const container = document.getElementById('profileSearchResults');
        if (!q) { container.innerHTML = ''; return; }
        const data = await api('GET', '/users/search?q=' + encodeURIComponent(q));
        if (!data?.users?.length) { container.innerHTML = '<p>Ничего не найдено</p>'; return; }
        container.innerHTML = data.users.map(u => `<div class="user-card" data-id="${u.id}"><div style="display:flex; align-items:center; gap:12px;"><div style="font-size:2rem;">${u.avatar || '👤'}</div><div><strong>${getDisplayName(u)}</strong><br><small>@${escapeHtml(u.username)}</small></div><button style="margin-left:auto;">💬 Написать</button></div></div>`).join('');
        container.querySelectorAll('.user-card').forEach(card => {
            card.onclick = (e) => { if (e.target.tagName === 'BUTTON') openPrivateChat(parseInt(card.dataset.id)); else openPrivateChat(parseInt(card.dataset.id)); };
        });
    });
}

// ========== NAVIGATION & INIT ==========
function setupNavigation() {
    document.querySelectorAll('.nav-btn, .burger-item').forEach(btn => {
        btn.addEventListener('click', function() {
            const page = this.getAttribute('data-page');
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(page + 'Page')?.classList.add('active');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            if (this.classList.contains('nav-btn')) this.classList.add('active');
            if (page === 'dashboard') renderDashboard();
            if (page === 'leaderboard') renderLeaderboard();
            if (page === 'shop') { updateBalance(); renderShop(); }
            if (page === 'admin') renderAdmin();
            if (page === 'pm') renderChatsList();
            if (page === 'official') renderOfficial();
            if (page === 'favorites') { renderBlacklist(); loadNotes(); }
            if (page === 'searchProfiles') document.getElementById('profileSearchResults').innerHTML = '';
        });
    });
}

function setupMenu() {
    const burger = document.getElementById('burger');
    const menu = document.getElementById('burgerMenu');
    burger.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('show'); };
    document.addEventListener('click', () => menu.classList.remove('show'));
}

function setupModals() {
    document.getElementById('createChannelBtn').onclick = () => document.getElementById('createChannelModal').style.display = 'flex';
    document.getElementById('createGroupBtn').onclick = () => document.getElementById('createGroupModal').style.display = 'flex';
    document.getElementById('createChatBtn').onclick = () => document.getElementById('createChatModal').style.display = 'flex';
    document.getElementById('saveProfileBtn').onclick = saveProfile;
    document.getElementById('logoutBtn').onclick = () => { if(confirm('Выйти?')) logout(); };
    document.getElementById('createNewAccountBtn').onclick = () => { logout(); };
    document.getElementById('shareProfileBtn').onclick = () => { navigator.clipboard.writeText(`${window.location.origin}?profile=${currentUser?.username}`); showToast('Ссылка скопирована!', 'success'); };
    document.getElementById('shareQrBtn').onclick = () => { const modal = document.getElementById('qrModal'); document.getElementById('qrcode').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(window.location.origin + '?profile=' + currentUser?.username)}">`; modal.style.display = 'flex'; document.getElementById('closeQrModal').onclick = () => modal.style.display = 'none'; };
    document.getElementById('openHelpModal').onclick = () => document.getElementById('helpModal').style.display = 'flex';
    document.getElementById('submitHelpQuestion').onclick = submitHelp;
    document.getElementById('closeHelpModal').onclick = () => document.getElementById('helpModal').style.display = 'none';
    document.getElementById('openFeaturesBtn').onclick = () => { document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); document.getElementById('officialPage').classList.add('active'); renderOfficial(); };
    document.getElementById('saveNotesBtn').onclick = saveNotes;
    document.getElementById('sendOfficialMessage')?.addEventListener('click', sendOfficial);
    document.getElementById('addNewsBtn')?.addEventListener('click', addNews);
    document.getElementById('clearBanLogs')?.addEventListener('click', async () => { await api('DELETE', '/admin/ban-logs'); renderAdmin(); showToast('Логи банов очищены', 'success'); });
    document.getElementById('clearGeneralLogs')?.addEventListener('click', async () => { await api('DELETE', '/admin/logs'); renderAdmin(); showToast('Логи очищены', 'success'); });
    document.getElementById('confirmCreateChannel').onclick = createChannel;
    document.getElementById('confirmCreateGroup').onclick = createGroup;
    document.getElementById('confirmCreateChat').onclick = createChat;
    document.getElementById('cancelCreateModal').onclick = () => document.getElementById('createChannelModal').style.display = 'none';
    document.getElementById('cancelCreateChatModal').onclick = () => document.getElementById('createChatModal').style.display = 'none';
    document.getElementById('cancelCreateGroupModal').onclick = () => document.getElementById('createGroupModal').style.display = 'none';
    document.getElementById('closeChannelModal').onclick = () => { document.getElementById('channelModal').style.display = 'none'; currentOpenType = null; currentOpenId = null; };
    document.getElementById('showReactionBtn')?.addEventListener('click', () => { const picker = document.getElementById('reactionPicker'); picker.style.display = picker.style.display === 'none' ? 'flex' : 'none'; });
    document.querySelectorAll('.reaction-opt').forEach(btn => {
        btn.onclick = () => {
            if (currentOpenType && currentOpenId) {
                const emoji = btn.getAttribute('data-reaction');
                // Добавляем реакцию на последнее сообщение — в v2.0 это упрощено
                showToast('Реакция отправлена', 'success');
            }
            document.getElementById('reactionPicker').style.display = 'none';
        };
    });
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.onclick = () => { const theme = btn.getAttribute('data-theme'); document.body.classList.remove('theme-dark','theme-light','theme-neon'); document.body.classList.add('theme-'+theme); localStorage.setItem('theme', theme); };
    });
    document.querySelectorAll('.avatar-btn').forEach(btn => {
        btn.onclick = () => { currentUser.avatar = btn.getAttribute('data-avatar'); saveProfile(); };
    });
    document.getElementById('uploadAvatarBtn')?.addEventListener('click', () => {
        const input = document.getElementById('avatarUpload');
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => { currentUser.avatarData = event.target.result; currentUser.avatar = '📷'; saveProfile(); showToast('Аватар загружен!', 'success'); };
            reader.readAsDataURL(file);
        };
        input.click();
    });
    document.getElementById('applyPremiumNick')?.addEventListener('click', () => {
        if (!currentUser?.isPremium) return showToast('Нужен премиум!', 'error');
        const nick = document.getElementById('premiumNickname').value.trim();
        if (nick) { currentUser.premiumNick = nick; saveProfile(); showToast('Ник обновлён!', 'success'); }
    });
    const premiumShop = document.getElementById('premiumShop');
    if (premiumShop) premiumShop.innerHTML = `<button onclick="buyPremium()">⭐️ Купить премиум (500 🪙)</button>`;
    document.getElementById('adminSearch')?.addEventListener('input', renderAdmin);
    document.getElementById('submitComplaint')?.addEventListener('click', submitComplaint);
    document.getElementById('cancelComplaint')?.addEventListener('click', () => document.getElementById('complaintModal').style.display = 'none');
    document.getElementById('openComplaintBtn')?.addEventListener('click', async () => {
        const select = document.getElementById('complaintUserSelect');
        const users = await api('GET', '/users');
        select.innerHTML = '<option value="">Выберите пользователя</option>';
        if (users?.users) users.users.forEach(u => { if (u.id !== currentUser?.id && !u.isDev) select.innerHTML += `<option value="${u.id}">${getDisplayName(u)}</option>`; });
        document.getElementById('complaintModal').style.display = 'flex';
    });
    // Auth modal tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const type = tab.getAttribute('data-auth');
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            document.getElementById(type + 'Form').classList.add('active');
        };
    });
    document.getElementById('doRegisterBtn').onclick = () => {
        register(
            document.getElementById('regFullname').value,
            document.getElementById('regUsername').value,
            document.getElementById('regPassword').value,
            document.getElementById('regEmail').value,
            document.getElementById('regPhone').value
        );
    };
    document.getElementById('doLoginBtn').onclick = () => {
        login(document.getElementById('loginUsername').value, document.getElementById('loginPassword').value);
    };
    document.getElementById('sendChannelMessage').onclick = sendMessage;
    document.getElementById('closeMessageModal').onclick = () => document.getElementById('messageModal').style.display = 'none';
}

function showAuthModal() {
    document.getElementById('authModal').style.display = 'flex';
}

function showMessageModal(title, text) {
    document.getElementById('messageModalTitle').innerText = title;
    document.getElementById('messageModalText').innerText = text;
    document.getElementById('messageModal').style.display = 'flex';
}

// ========== INIT ==========
const savedTheme = localStorage.getItem('theme') || 'dark';
document.body.classList.add('theme-' + savedTheme);

setupNavigation();
setupMenu();
setupModals();
setupSearch();
setupProfileSearch();

// Проверяем сессию при старте
loadMe().then(ok => { if (!ok) showAuthModal(); });

// Офлайн индикатор
window.addEventListener('online', () => showToast('Соединение восстановлено', 'success'));
window.addEventListener('offline', () => showToast('Нет соединения', 'error'));
