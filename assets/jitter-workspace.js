// Layout controls for the signed-in workspace. The existing Jitter client owns auth,
// conversations, message subscriptions, settings, and the WebRTC session.
const workEl = id => document.getElementById(id);
let inboxFilter = 'all';
let showDetails = innerWidth >= 1080;
let callDockGeneration = 0;
const detailPanel = workEl('workspaceDetails');
document.querySelector('.dm-body').append(detailPanel);

function workButton(label, action, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className;
    button.onclick = action;
    return button;
}

function workspacePins() {
    try { return JSON.parse(localStorage.getItem('jitter_pins_' + currentUser.email)) || []; }
    catch { return []; }
}

function toggleWorkspacePin() {
    const id = ctxConvId;
    if (!id || !currentUser) return;
    const pins = new Set(workspacePins());
    pins.has(id) ? pins.delete(id) : pins.add(id);
    localStorage.setItem('jitter_pins_' + currentUser.email, JSON.stringify([...pins]));
    hideContextMenu();
    renderConversations(conversations);
}

function workspaceInbox(list) {
    const pins = new Set(workspacePins());
    const query = workEl('sidebarSearch').value.trim().toLowerCase();
    return list.filter(c => {
        if (query && ![getOtherName(c), getOtherEmail(c)].some(s => s?.toLowerCase().includes(query))) return false;
        if (inboxFilter === 'groups') return c.is_group;
        if (inboxFilter === 'requests') return isMessageRequest(c);
        if (inboxFilter === 'unread') return c.unread_count > 0;
        return true;
    }).sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)));
}

document.querySelectorAll('[data-filter]').forEach(button => {
    button.onclick = () => {
        inboxFilter = button.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(el => el.setAttribute('aria-pressed', el === button));
        renderConversations(conversations);
    };
});

function workspaceTint(seed) {
    const colors = ['#315b4b', '#533754', '#43395d', '#3a5368', '#644638', '#505e39'];
    let hash = 0;
    for (const c of String(seed)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return colors[hash % colors.length];
}

function renderWorkspacePeople() {
    if (!currentUser) return;
    const name = currentUser.display_name || currentUser.username || currentUser.name;
    document.querySelectorAll('.workspace-self').forEach(el => {
        el.innerHTML = avatarHTML(name, currentUser.email);
        el.style.backgroundColor = workspaceTint(currentUser.email);
    });
    if (!window.JITTER_IOS_APP) return;
    const strip = workEl('peopleStrip');
    strip.replaceChildren();
    for (const c of conversations.filter(c => !c.is_group).slice(0, 8)) {
        const email = getOtherEmail(c), name = getOtherName(c);
        const item = workButton('', () => openConversation(c.id));
        const avatar = document.createElement('span');
        avatar.className = 'work-avatar';
        avatar.style.backgroundColor = workspaceTint(email);
        avatar.innerHTML = avatarHTML(name, email) + '<i class="' + statusDotClass(effectiveStatus(email), email) + '"></i>';
        item.append(avatar, document.createTextNode(name.split(' ')[0]));
        item.title = name;
        strip.append(item);
    }
}

function syncWorkspaceTab(tab) {
    workEl('dmSidebar').dataset.section = tab;
    workEl('workspaceHeading').textContent = {friends:'Chats', servers:'Servers', calls:'Calls', you:'You'}[tab];
    workEl('workspaceExtra').hidden = tab !== 'you';
    workEl('callsPage').hidden = tab !== 'calls';
    document.querySelectorAll('[data-work-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.workTab === tab));
    ['Chats','Servers','Calls','You'].forEach((name,i) =>
        workEl('iosTab' + name).classList.toggle('active', ['friends','servers','calls','you'][i] === tab));
}

function workspaceTab(tab) {
    if (workEl('dmSidebar').classList.contains('collapsed')) toggleSidebar();
    if (window.JITTER_IOS_APP && document.documentElement.classList.contains('chat-open')) mobileBack();
    switchSidebarTab(tab);
    if (tab === 'calls') {
        showCallPicker(false, false);
        setCallHistoryFilter('all');
        renderWorkspaceCalls();
    }
    if (tab === 'you') renderWorkspaceYou();
}

let callHistoryRows = [];
let historyRequest = 0;
let callFilter = 'all';
let historyState = 'loading';
let dialing = false;

function callText(tag, text, className = '') {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
}

function showCallPicker(open, focus = true) {
    workEl('callPicker').hidden = !open;
    workEl('callRecents').hidden = open;
    const trigger = workEl('callsPage').querySelector('.new-call');
    trigger.hidden = open;
    if (open) {
        workEl('callSearch').value = '';
        renderCallContacts();
        workEl('callSearch').focus();
    } else if (focus) trigger.focus();
}

function setCallHistoryFilter(filter) {
    callFilter = filter;
    workEl('callsPage').querySelectorAll('[data-call-filter]').forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.callFilter === filter)));
    drawCallHistory();
}

document.querySelectorAll('[data-call-filter]').forEach(button => {
    button.onclick = () => setCallHistoryFilter(button.dataset.callFilter);
});

function callPersonRow(conv, detail, time = '') {
    const name = getOtherName(conv), email = getOtherEmail(conv);
    const row = callText('div', '', 'call-person');
    const portrait = callText('span', '', 'work-avatar');
    portrait.style.backgroundColor = workspaceTint(email);
    portrait.innerHTML = avatarHTML(name, email);
    const info = workButton('', () => {
        workspaceTab('friends');
        openConversation(conv.id);
    }, 'call-person-info');
    info.title = 'Open conversation with ' + name;
    info.append(callText('strong', name), callText('small', detail));
    row.append(portrait, info);
    if (time) row.append(callText('time', time));
    for (const [video, label] of [[false,'Voice call'], [true,'Video call']]) {
        const button = workButton('', async () => {
            if (dialing) return;
            dialing = true;
            workEl('callsPage').setAttribute('aria-busy', 'true');
            try { await startCall({conversationId:conv.id, video}); }
            finally {
                dialing = false;
                workEl('callsPage').removeAttribute('aria-busy');
            }
        }, 'call-shortcut');
        button.title = label + ' with ' + name;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = '<i aria-hidden="true" class="fas '+ (video ? 'fa-video' : 'fa-phone') +'"></i>';
        row.append(button);
    }
    return row;
}

function renderCallContacts() {
    const query = workEl('callSearch').value.trim().toLowerCase();
    const list = workEl('callContacts');
    list.replaceChildren();
    for (const c of conversations.filter(c => !c.is_group)) {
        const email = getOtherEmail(c), name = getOtherName(c);
        if (blockedEmails.has(email) || blockedByEmails.has(email)) continue;
        const handle = usernameCache[email];
        if (![name, handle].some(s => s?.toLowerCase().includes(query))) continue;
        list.append(callPersonRow(c, handle ? '@' + handle : 'Direct conversation'));
    }
    if (!list.childElementCount) {
        list.append(callText('p', query ? 'No matching contacts.' : 'Start a direct conversation to call someone here.', 'call-list-note'));
        if (!query) list.append(workButton('New message', () => { workspaceTab('friends'); openNewDMModal(); }, 'call-text-action'));
    }
}

async function renderWorkspaceCalls() {
    const request = ++historyRequest, identity = currentUser.email;
    const ids = conversations.filter(c => !c.is_group).map(c => c.id);
    callHistoryRows = [];
    historyState = 'loading';
    drawCallHistory();
    try {
        const {data, error} = ids.length ? await sb.from('dm_messages').select('conversation_id,sender_email,message,created_at')
            .in('conversation_id', ids).like('message', '📞%').order('created_at', {ascending:false}).limit(60) : {data:[]};
        if (request !== historyRequest || currentSidebarTab !== 'calls' || currentUser?.email !== identity) return;
        if (error) throw error;
        callHistoryRows = data || [];
        historyState = 'ready';
    } catch {
        if (request !== historyRequest || currentSidebarTab !== 'calls' || currentUser?.email !== identity) return;
        historyState = 'error';
    }
    drawCallHistory();
}

function drawCallHistory() {
    const list = workEl('callHistoryList');
    list.replaceChildren();
    if (historyState !== 'ready') {
        list.append(callText('p', historyState === 'loading' ? 'Loading recent calls…' : 'Couldn’t load your calls.', 'call-list-note'));
        if (historyState === 'error') list.append(workButton('Try again', renderWorkspaceCalls, 'call-text-action'));
        return;
    }
    const today = new Date().toDateString();
    let previousDay;
    for (const row of callHistoryRows) {
        const conv = conversations.find(c => c.id === row.conversation_id);
        const log = callLogState(row.message);
        if (!conv || !log) continue;
        const outgoing = row.sender_email === currentUser.email;
        const missed = !outgoing && log.state === 'missed';
        if (callFilter === 'missed' && !missed) continue;
        const at = new Date(row.created_at), day = at.toDateString();
        if (day !== previousDay) {
            list.append(callText('h2', day === today ? 'Today' : at.toLocaleDateString(undefined, {dateStyle:'medium'})));
            previousDay = day;
        }
        const direction = outgoing ? 'Outgoing' : 'Incoming';
        let detail = direction;
        if (log.state === 'missed') detail = outgoing ? 'No answer' : 'Missed call';
        else if (log.duration) detail += ' · ' + log.duration;
        else if (log.state === 'active' && Date.now() - at < CALL_LOG_STALE_MS) detail += ' · In progress';
        const item = callPersonRow(conv, detail, at.toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'}));
        if (missed) item.classList.add('missed-call');
        list.append(item);
    }
    if (!list.childElementCount) {
        const empty = callText('div', '', 'calls-empty');
        empty.append(callText('i', '', 'fa-phone'));
        empty.append(callText('h2', callFilter === 'missed' ? 'No missed calls' : 'No recent calls'),
            callText('p', callFilter === 'missed' ? 'Calls you miss will appear here.' : 'Choose a contact to start a voice or video call.'));
        list.append(empty);
    }
}

function renderYouBanner(banner, url) {
    banner.replaceChildren();
    if (!url) return;
    const image = new Image();
    image.alt = '';
    image.onerror = () => image.remove();
    image.src = url;
    banner.append(image);
}

function updateOwnBanner(url) {
    currentUser.banner_url = url || null;
    if (profileCache[currentUser.email]) profileCache[currentUser.email].banner_url = currentUser.banner_url;
    const banner = workEl('workspaceExtra').querySelector('.you-banner');
    if (banner) renderYouBanner(banner, currentUser.banner_url);
}

function renderWorkspaceYou() {
    const panel = workEl('workspaceExtra');
    panel.replaceChildren();
    const card = document.createElement('div');
    card.className = 'you-card';
    const name = currentUser.display_name || currentUser.username;
    card.innerHTML = '<div class="work-avatar">' + avatarHTML(name, currentUser.email) + '</div><h2>' +
        escHtml(name) + '</h2><p>@' + escHtml(currentUser.username) + '</p>';
    const banner = document.createElement('div');
    banner.className = 'you-banner';
    renderYouBanner(banner, currentUser.banner_url);
    card.prepend(banner);
    card.append(workButton('Edit profile', () => openProfile(currentUser.email)), workButton('Online', () => openSettingsModal('privacy'), 'you-presence'));
    const rows = document.createElement('div');
    rows.className = 'you-rows';
    for (const [label, icon, page] of [
        ['Friend requests','you-friend','requests'], ['Appearance','you-palette','appearance'], ['Privacy & safety','you-shield','privacy'],
        ['Chat','you-chat','chat'], ['Voice & video','you-video','calls'], ['This iPhone','you-phone','device']
    ]) {
        const button = workButton(label, () => page === 'requests' ? openFriendRequestsModal() : openSettingsModal(page), 'work-row');
        const tile = document.createElement('span');
        tile.className = 'you-icon ' + icon;
        tile.setAttribute('aria-hidden', 'true');
        tile.style.backgroundColor = workspaceTint(page);
        button.prepend(tile);
        const hint = document.createElement('small');
        hint.textContent = (page === 'appearance' ? workEl('settingsAppearanceSummary').textContent :
            page === 'requests' ? pendingIncoming.length || '' : '');
        button.append(hint);
        const chevron = document.createElement('span');
        chevron.className = 'you-chevron';
        chevron.setAttribute('aria-hidden','true');
        button.append(chevron);
        rows.append(button);
    }
    panel.append(card, rows, workButton('Log out', logout, 'you-logout'));
}

function updateDetailMute() { workEl('detailMute').textContent = isMuted(activeConvId) ? 'Unmute' : 'Mute'; }
function toggleWorkspaceDetails() {
    showDetails = detailPanel.hidden;
    detailPanel.hidden = !showDetails || !activeConvId;
}

async function selectWorkspaceDetails(conv) {
    workEl('chatArea').style.setProperty('--peer-tint', workspaceTint(getOtherEmail(conv) || conv.id));
    detailPanel.hidden = !showDetails || !!window.JITTER_IOS_APP;
    if (window.JITTER_IOS_APP) return;
    const email = getOtherEmail(conv), name = getOtherName(conv);
    detailPanel.style.setProperty('--person-tint', workspaceTint(email || conv.id));
    workEl('detailAvatar').innerHTML = avatarHTML(name, email);
    workEl('detailName').textContent = name;
    workEl('detailHandle').textContent = conv.is_group ? 'Group chat' : usernameCache[email] ? '@' + usernameCache[email] : '';
    workEl('detailBio').textContent = '';
    workEl('detailMedia').textContent = 'Loading…';
    workEl('detailServers').textContent = '';
    workEl('detailServers').previousElementSibling.hidden = !!conv.is_group;
    updateDetailMute();
    if (conv.is_group) return;
    const [profile, memberships] = await Promise.all([
        sb.from('clients').select('bio').eq('email', email).maybeSingle(),
        sb.from('server_members').select('server_id,user_email').in('user_email', [currentUser.email,email])
    ]);
    if (activeConvId !== conv.id) return;
    workEl('detailBio').textContent = profile.data?.bio || '';
    const own = new Set((memberships.data || []).filter(m => m.user_email === currentUser.email).map(m => m.server_id));
    const shared = (memberships.data || []).filter(m => m.user_email === email && own.has(m.server_id)).map(m => m.server_id);
    const result = shared.length ? await sb.from('servers').select('name').in('id',shared) : {data:[]};
    if (activeConvId !== conv.id) return;
    workEl('detailServers').textContent = (result.data || []).map(s => s.name).join(' · ') ||
        (memberships.error || result.error ? 'Unavailable' : 'None in common');
}

function renderSharedMedia(messages) {
    const gallery = workEl('detailMedia');
    gallery.replaceChildren();
    const photos = messages.filter(m => m.message?.startsWith('[IMG]:')).reverse();
    for (const photo of photos.slice(0, 6)) {
        const url = photo.message.slice(6);
        if (isImageHidden(url)) continue;
        const button = workButton('', () => openLightbox(url));
        const img = new Image();
        img.alt = 'View shared photo';
        img.src = getLocalImage(url) || url;
        button.append(img);
        gallery.append(button);
    }
    if (!gallery.childElementCount) gallery.textContent = photos.length ? 'Photos hidden' : 'No shared photos yet';
}

async function dockCallChat(open = workEl('callChatDock').hidden) {
    const dock = workEl('callChatDock'), chat = workEl('chatArea');
    const generation = ++callDockGeneration;
    if (!open) {
        if (dock.contains(chat)) document.querySelector('.dm-chat-area').append(chat);
        dock.hidden = true;
        return;
    }
    const session = call;
    if (!session?.convId) return;
    if (currentSidebarTab === 'calls') workspaceTab('friends');
    if (activeConvId !== session.convId) await openConversation(session.convId);
    if (generation !== callDockGeneration || session !== call || !callStageOpen || activeConvId !== session.convId) return;
    dock.append(chat);
    dock.hidden = false;
    chat.style.display = 'flex';
    workEl('messagesContainer').scrollTop = workEl('messagesContainer').scrollHeight;
}

document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && currentUser) {
        event.preventDefault(); workspaceTab('friends'); workEl('sidebarSearch').focus();
    }
});
syncWorkspaceTab('friends');

function resetThreadSearch() {
    const form = workEl('threadSearch');
    form.hidden = true;
    form.reset();
    form.querySelector('span').textContent = '';
    document.querySelector('.thread-hit')?.classList.remove('thread-hit');
}

function toggleThreadSearch() {
    const form = workEl('threadSearch');
    if (!form.hidden) { resetThreadSearch(); return; }
    form.hidden = false;
    form.querySelector('input').focus();
}

function findThreadMessage() {
    const form = workEl('threadSearch');
    const query = form.querySelector('input').value.trim().toLowerCase();
    const hits = [...workEl('messagesContainer').querySelectorAll('.message-bubble')].filter(el =>
        query && el.innerText.toLowerCase().includes(query));
    const previous = document.querySelector('.thread-hit');
    previous?.classList.remove('thread-hit');
    const index = (hits.indexOf(previous) + 1) % hits.length;
    form.querySelector('span').textContent = hits.length ? (index + 1) + ' / ' + hits.length : 'No matches';
    if (hits.length) {
        hits[index].classList.add('thread-hit');
        hits[index].scrollIntoView({block:'center'});
    }
}

function toggleCallAudioOutput() {
    if (!call) return;
    call.silenced = !call.silenced;
    workEl('callRemoteAudio').muted = call.silenced;
    renderCallOverlay();
}

let lastQualityCheck = 0;
async function updateCallLinkQuality() {
    const session = call;
    const label = workEl('callLinkQuality');
    if (!session?.pc || session.state !== 'active') { label.hidden = true; return; }
    if (Date.now() - lastQualityCheck < 4000) return;
    lastQualityCheck = Date.now();
    try {
        const stats = await session.pc.getStats();
        if (call !== session) return;
        const pair = [...stats.values()].find(s => s.type === 'candidate-pair' && s.state === 'succeeded'
            && s.nominated && Number.isFinite(s.currentRoundTripTime));
        label.hidden = !pair;
        if (pair) label.textContent = 'Connected · ' + Math.round(pair.currentRoundTripTime * 1000) + ' ms';
    } catch { label.hidden = true; }
}
