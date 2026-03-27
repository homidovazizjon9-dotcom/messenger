// ===== FIREBASE IMPORTS =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, updateProfile, signOut
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getDatabase, ref, set, push, onValue, onChildAdded, update, remove,
  serverTimestamp, get
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyD17-ChAdiwGem69t3WrdOtZv1LmLpB7U8",
  authDomain: "messenger-57e9d.firebaseapp.com",
  projectId: "messenger-57e9d",
  storageBucket: "messenger-57e9d.firebasestorage.app",
  messagingSenderId: "870982282541",
  appId: "1:870982282541:web:aea1c29193fa098ef2b7a4",
  databaseURL: "https://messenger-57e9d-default-rtdb.firebaseio.com"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);
const storage = getStorage(firebaseApp);

// ===== WEBRTC CONFIG =====
const peerConfig = {
  iceServers: [{ urls: [
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun4.l.google.com:19302'
  ]}]
};

// ===== APP STATE =====
let currentUser = null;
let currentChatId = null;
let currentChatData = null;
let allChats = [];
let pc = null;
let localStream = null;
let isCallActive = false;
let selectedGroupMembers = [];
let micMuted = false;
let speakerOff = false;
let pendingIncomingCall = null; // {chatId, call} — безопасное хранение данных звонка

// Функции отписки от Firebase-слушателей (предотвращение утечек)
let unsubscribeMessages = null;
let unsubscribeOnlineStatus = null;
let typingTimeout = null;
let searchTimeout = null;

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await syncUserStatus(true);
    showMainScreen();
    listenChats();
    listenGlobalCalls();
  } else {
    currentUser = null;
    showAuthScreen();
  }
});

async function syncUserStatus(online) {
  if (!currentUser) return;
  const userRef = ref(db, `users/${currentUser.uid}`);
  const snap = await get(userRef);
  const existing = snap.val() || {};
  await update(userRef, {
    uid: currentUser.uid,
    name: currentUser.displayName || existing.name || 'Аноним',
    photoURL: currentUser.photoURL || existing.photoURL || '',
    online,
    lastSeen: serverTimestamp()
  });
}

// ===== AUTH =====
window.doAnonymousLogin = async () => {
  const nameInput = document.getElementById('anon-name');
  const name = nameInput.value.trim();
  if (!name) { showToast('Введите имя для семьи'); nameInput.focus(); return; }

  const btn = document.getElementById('btn-anon');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>';

  try {
    const { user } = await signInAnonymously(auth);
    await updateProfile(user, { displayName: name });
    await syncUserStatus(true);
  } catch (e) {
    console.error(e);
    document.getElementById('auth-error').textContent = 'Ошибка входа. Попробуйте ещё раз.';
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18"><use href="#ic-chat"/></svg> Начать общение';
  }
};

window.doLogout = async () => {
  if (!confirm('Выйти из аккаунта?')) return;
  if (currentUser) {
    await syncUserStatus(false);
    await signOut(auth);
  }
  allChats = [];
  currentChatId = null;
  closeProfile();
};

// ===== NAVIGATION =====
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('main-screen').classList.remove('active');
}

function showMainScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('main-screen').classList.add('active');
  updateHeaderAvatar();
}

function updateHeaderAvatar() {
  if (!currentUser) return;
  const letter = (currentUser.displayName || '?')[0].toUpperCase();
  const el = document.getElementById('header-avatar');
  if (currentUser.photoURL) {
    el.innerHTML = `<img src="${currentUser.photoURL}" alt="avatar" />`;
  } else {
    el.innerHTML = `<span>${letter}</span>`;
  }
}

// ===== PROFILE =====
window.showProfile = () => {
  document.getElementById('profile-page').classList.add('active');
  const name = currentUser?.displayName || 'Аноним';
  document.getElementById('profile-name-display').textContent = name;
  document.getElementById('profile-email-display').textContent = 'Анонимный пользователь';

  const bigAvatar = document.getElementById('profile-avatar-big');
  const editOverlay = '<div class="profile-avatar-edit"><svg width="16" height="16"><use href="#ic-image"/></svg></div>';
  if (currentUser?.photoURL) {
    bigAvatar.innerHTML = `<img src="${currentUser.photoURL}" alt="avatar" />${editOverlay}`;
  } else {
    bigAvatar.innerHTML = `<span>${name[0].toUpperCase()}</span>${editOverlay}`;
  }
};

window.closeProfile = () => {
  document.getElementById('profile-page').classList.remove('active');
};

window.editName = () => {
  document.getElementById('new-name-input').value = currentUser?.displayName || '';
  document.getElementById('edit-name-modal').classList.add('open');
  setTimeout(() => document.getElementById('new-name-input').focus(), 300);
};

window.closeEditName = () => {
  document.getElementById('edit-name-modal').classList.remove('open');
};

window.saveNewName = async () => {
  const val = document.getElementById('new-name-input').value.trim();
  if (!val) { showToast('Введите имя'); return; }
  try {
    await updateProfile(auth.currentUser, { displayName: val });
    await syncUserStatus(true);
    document.getElementById('profile-name-display').textContent = val;
    updateHeaderAvatar();
    closeEditName();
    showToast('Имя обновлено ✓');
  } catch {
    showToast('Ошибка сохранения');
  }
};

window.changeAvatar = () => {
  document.getElementById('avatar-input').click();
};

window.handleAvatarUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  showToast('Загружаем фото...');
  try {
    const storageRef = sRef(storage, `avatars/${currentUser.uid}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    await updateProfile(auth.currentUser, { photoURL: url });
    await update(ref(db, `users/${currentUser.uid}`), { photoURL: url });
    updateHeaderAvatar();
    showProfile();
    showToast('Фото обновлено ✓');
  } catch (e) {
    console.error(e);
    showToast('Ошибка загрузки фото');
  }
  event.target.value = '';
};

window.copyInviteLink = () => {
  navigator.clipboard?.writeText(window.location.href)
    .then(() => showToast('Ссылка скопирована ✓'))
    .catch(() => showToast('Не удалось скопировать'));
};

// ===== CHATS =====
function listenChats() {
  onValue(ref(db, 'chats'), (snapshot) => {
    const data = snapshot.val();
    if (!data) { renderChatList([]); return; }
    allChats = Object.entries(data)
      .map(([id, chat]) => ({ id, ...chat }))
      .filter(chat => chat.members && chat.members.includes(currentUser.uid))
      .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
    renderChatList(allChats);
  });
}

function renderChatList(chats) {
  const container = document.getElementById('chat-list');
  if (!chats.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="56" height="56" opacity=".35"><use href="#ic-chat"/></svg></div>
      <div class="empty-title">Нет чатов</div>
      <div class="empty-desc">Нажмите <strong>карандаш</strong> чтобы начать чат</div>
    </div>`;
    return;
  }
  container.innerHTML = chats.map(chat => {
    const isGroup = chat.type === 'group';
    const name = isGroup ? chat.name : getDirectChatName(chat);
    const preview = chat.lastMessage || 'Напишите первым';
    const unread = (chat.unread && chat.unread[currentUser.uid]) || 0;
    const active = currentChatId === chat.id ? 'active' : '';
    const avatarStyle = isGroup ? 'background:linear-gradient(135deg,#e040fb,#7c4dff)' : '';
    const avatarContent = isGroup
      ? `<svg width="22" height="22"><use href="#ic-users"/></svg>`
      : (name || '?')[0].toUpperCase();
    return `
      <div class="chat-item ${active}" onclick="openChat('${chat.id}')">
        <div class="avatar" style="${avatarStyle}">${avatarContent}</div>
        <div class="chat-info">
          <div class="chat-name">${esc(name)}</div>
          <div class="chat-preview">${esc(preview)}</div>
        </div>
        <div class="chat-meta">
          ${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function getDirectChatName(chat) {
  const otherId = chat.members.find(id => id !== currentUser.uid);
  return (chat.memberNames && chat.memberNames[otherId]) || 'Собеседник';
}

window.filterChats = (val) => {
  const q = val.toLowerCase().trim();
  const filtered = q
    ? allChats.filter(c => {
        const name = c.type === 'group' ? c.name : getDirectChatName(c);
        return name.toLowerCase().includes(q);
      })
    : allChats;
  renderChatList(filtered);
};

window.openChat = (id) => {
  currentChatId = id;
  currentChatData = allChats.find(c => c.id === id);
  if (!currentChatData) return;

  const isGroup = currentChatData.type === 'group';
  const name = isGroup ? currentChatData.name : getDirectChatName(currentChatData);

  document.getElementById('chat-header-name').textContent = name;

  const chatAvatar = document.getElementById('chat-avatar');
  if (isGroup) {
    chatAvatar.style.background = 'linear-gradient(135deg,#e040fb,#7c4dff)';
    chatAvatar.innerHTML = `<svg width="20" height="20"><use href="#ic-users"/></svg>`;
  } else {
    chatAvatar.style.background = '';
    chatAvatar.innerHTML = `<span>${name[0].toUpperCase()}</span>`;
  }

  document.getElementById('chat-view').classList.add('active');
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('btn-video-call').style.display = isGroup ? 'none' : '';

  if (currentChatData.unread && currentChatData.unread[currentUser.uid]) {
    update(ref(db, `chats/${id}/unread`), { [currentUser.uid]: 0 });
  }

  listenMessages(id);
  listenOnlineStatus(id, isGroup);
};

window.closeChat = () => {
  currentChatId = null;
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('sidebar').classList.remove('hidden');
};

// Слушатель статуса собеседника — отписывается от предыдущего чата
function listenOnlineStatus(chatId, isGroup) {
  if (unsubscribeOnlineStatus) {
    unsubscribeOnlineStatus();
    unsubscribeOnlineStatus = null;
  }
  const statusEl = document.getElementById('chat-header-status');
  if (isGroup) {
    statusEl.textContent = 'Группа';
    statusEl.className = 'chat-header-status offline';
    return;
  }
  const chat = allChats.find(c => c.id === chatId);
  if (!chat) return;
  const otherId = chat.members.find(id => id !== currentUser.uid);
  if (!otherId) return;

  unsubscribeOnlineStatus = onValue(ref(db, `users/${otherId}/online`), (snap) => {
    if (!statusEl) return;
    const isOnline = !!snap.val();
    statusEl.textContent = isOnline ? 'в сети' : 'не в сети';
    statusEl.className = 'chat-header-status' + (isOnline ? '' : ' offline');
  });
}

// ===== CHAT MENU =====
window.openChatMenu = () => {
  const title = currentChatData
    ? (currentChatData.type === 'group' ? currentChatData.name : getDirectChatName(currentChatData))
    : 'Чат';
  document.getElementById('chat-menu-title').textContent = title;
  document.getElementById('chat-menu-overlay').classList.add('open');
};

window.closeChatMenu = () => {
  document.getElementById('chat-menu-overlay').classList.remove('open');
};

window.clearChat = async () => {
  closeChatMenu();
  if (!currentChatId || !confirm('Очистить историю чата?')) return;
  await remove(ref(db, `messages/${currentChatId}`));
  await update(ref(db, `chats/${currentChatId}`), { lastMessage: '', lastMessageTime: serverTimestamp() });
  showToast('История очищена');
};

window.deleteChat = async () => {
  closeChatMenu();
  if (!currentChatId || !confirm('Удалить чат? Это действие нельзя отменить.')) return;
  await remove(ref(db, `messages/${currentChatId}`));
  await remove(ref(db, `chats/${currentChatId}`));
  closeChat();
  showToast('Чат удалён');
};

// ===== MESSAGES =====
// Слушатель сообщений — отписывается от предыдущего чата
function listenMessages(chatId) {
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
  unsubscribeMessages = onValue(ref(db, `messages/${chatId}`), (snapshot) => {
    const data = snapshot.val();
    const msgs = data
      ? Object.values(data).sort((a, b) => (a.time || 0) - (b.time || 0))
      : [];
    renderMessages(msgs, chatId);
  });
}

function renderMessages(msgs, chatId) {
  if (chatId !== currentChatId) return; // Защита от устаревших обновлений
  const area = document.getElementById('messages-area');
  if (!msgs.length) {
    area.innerHTML = `<div class="empty-state">
      <div class="empty-icon" style="font-size:48px;opacity:.3">👋</div>
      <div class="empty-title">Напишите первым!</div>
      <div class="empty-desc">Начните разговор</div>
    </div>`;
    return;
  }
  area.innerHTML = msgs.map(m => {
    const isOut = m.senderId === currentUser.uid;
    const isGroup = currentChatData && currentChatData.type === 'group';
    const time = m.time
      ? new Date(m.time).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
      : '';
    const content = m.imageUrl
      ? `<img class="msg-image" src="${m.imageUrl}" alt="Фото" onclick="openImageViewer('${m.imageUrl}')" />`
      : `<div class="msg-bubble">${esc(m.text || '')}</div>`;
    return `
      <div class="message ${isOut ? 'out' : 'in'}">
        ${!isOut && isGroup ? `<div class="msg-sender">${esc(m.senderName || '')}</div>` : ''}
        ${content}
        <div class="msg-time">
          ${time}
          ${isOut ? `<svg width="12" height="12" class="msg-status delivered"><use href="#ic-check-dbl"/></svg>` : ''}
        </div>
      </div>`;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

window.sendMessage = async () => {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = '';
  autoResize(input);

  await set(push(ref(db, `messages/${currentChatId}`)), {
    text,
    senderId: currentUser.uid,
    senderName: currentUser.displayName || 'Аноним',
    time: serverTimestamp()
  });

  const updates = { lastMessage: text, lastMessageTime: serverTimestamp() };
  if (currentChatData?.members) {
    currentChatData.members.forEach(uid => {
      if (uid !== currentUser.uid) {
        updates[`unread/${uid}`] = (currentChatData.unread?.[uid] || 0) + 1;
      }
    });
  }
  update(ref(db, `chats/${currentChatId}`), updates);
};

// ===== FILE UPLOAD =====
window.handleFileUpload = async (event) => {
  const file = event.target.files[0];
  if (!file || !currentChatId) return;
  showToast('Загружаем изображение...');
  try {
    const fileRef = sRef(storage, `chat-images/${currentChatId}/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await set(push(ref(db, `messages/${currentChatId}`)), {
      imageUrl: url,
      text: '📷 Фото',
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Аноним',
      time: serverTimestamp()
    });
    update(ref(db, `chats/${currentChatId}`), {
      lastMessage: '📷 Фото',
      lastMessageTime: serverTimestamp()
    });
    showToast('Фото отправлено ✓');
  } catch (e) {
    console.error(e);
    showToast('Ошибка загрузки фото');
  }
  event.target.value = '';
};

// ===== IMAGE VIEWER =====
window.openImageViewer = (url) => {
  document.getElementById('image-viewer-img').src = url;
  document.getElementById('image-viewer').classList.add('open');
};

window.closeImageViewer = () => {
  document.getElementById('image-viewer').classList.remove('open');
};

// ===== INPUT HELPERS =====
window.autoResize = (el) => {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

window.handleKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 600) {
    e.preventDefault();
    sendMessage();
  }
};

window.handleTyping = () => {
  if (!currentChatId || !currentUser) return;
  clearTimeout(typingTimeout);
  update(ref(db, `typing/${currentChatId}/${currentUser.uid}`), {
    typing: true,
    name: currentUser.displayName
  });
  typingTimeout = setTimeout(() => {
    update(ref(db, `typing/${currentChatId}/${currentUser.uid}`), { typing: false });
  }, 2000);
};

// ===== WEBRTC / CALLS =====

async function setupStreaming(type) {
  const constraints = type === 'video'
    ? { video: { facingMode: 'user' }, audio: true }
    : { audio: true };
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  document.getElementById('localVideo').srcObject = localStream;
  if (type === 'video') {
    document.getElementById('video-container').style.display = 'block';
    document.getElementById('call-ui-top').style.opacity = '0.15';
  }
}

window.startCall = async (type) => {
  if (!currentChatId) return;
  isCallActive = true;
  micMuted = false;
  speakerOff = false;

  document.getElementById('call-screen').classList.add('open');
  document.getElementById('call-name').textContent = currentChatData
    ? (currentChatData.type === 'group' ? currentChatData.name : getDirectChatName(currentChatData))
    : 'Звонок';
  document.getElementById('call-status').textContent = 'Вызов...';
  resetCallUI();

  try {
    await setupStreaming(type);
  } catch (e) {
    console.error('Media error:', e);
    showToast('Нет доступа к микрофону/камере');
  }

  pc = new RTCPeerConnection(peerConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (e) => {
    document.getElementById('remoteVideo').srcObject = e.streams[0];
  };

  const callRef = ref(db, `calls/${currentChatId}`);
  const offer = await pc.createOffer();

  pc.onicecandidate = (e) => {
    if (e.candidate) push(ref(db, `calls/${currentChatId}/callerCandidates`), e.candidate.toJSON());
  };

  await set(callRef, {
    offer: { type: offer.type, sdp: offer.sdp },
    status: 'calling',
    callType: type,
    callerId: currentUser.uid,
    callerName: currentUser.displayName || 'Аноним'
  });

  await pc.setLocalDescription(offer);

  const candidateQueue = [];

  onChildAdded(ref(db, `calls/${currentChatId}/calleeCandidates`), (snap) => {
    const candidate = new RTCIceCandidate(snap.val());
    if (pc?.currentRemoteDescription) {
      pc.addIceCandidate(candidate).catch(console.error);
    } else {
      candidateQueue.push(candidate);
    }
  });

  onValue(callRef, async (snap) => {
    const data = snap.val();
    if (data?.answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      document.getElementById('call-status').textContent = '● В эфире';
      candidateQueue.forEach(c => pc.addIceCandidate(c).catch(console.error));
      candidateQueue.length = 0;
    }
    if (data?.status === 'ended') endCallLocal();
  });
};

function listenGlobalCalls() {
  let shownCallId = null;

  onValue(ref(db, 'calls'), (snap) => {
    const calls = snap.val();

    // Звонок удалён — закрываем экран ожидания если не успели ответить
    if (!calls) {
      if (shownCallId && !pc) {
        shownCallId = null;
        endCallLocal();
      }
      return;
    }

    Object.entries(calls).forEach(([chatId, call]) => {
      const chat = allChats.find(c => c.id === chatId);

      // Входящий звонок — показываем экран один раз
      if (
        chat &&
        call.status === 'calling' &&
        call.callerId !== currentUser.uid &&
        !isCallActive &&
        chatId !== shownCallId
      ) {
        shownCallId = chatId;
        showIncomingCall(chatId, call);
      }

      // Звонок завершился пока мы в нём
      if (chatId === currentChatId && call.status === 'ended' && isCallActive) {
        endCallLocal();
      }
    });
  });
}

function showIncomingCall(chatId, call) {
  // Данные звонка хранятся в переменной — SDP нельзя передавать через onclick-атрибут
  pendingIncomingCall = { chatId, call };
  isCallActive = true;
  currentChatId = chatId;

  document.getElementById('call-screen').classList.add('open');
  document.getElementById('call-name').textContent = call.callerName || 'Звонок';
  document.getElementById('call-status').textContent =
    call.callType === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий звонок';
  resetCallUI();

  if (!document.getElementById('answer-btn-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'call-btn-wrap';
    wrap.id = 'answer-btn-wrap';
    wrap.innerHTML = `
      <button class="call-btn call-btn-answer" onclick="answerIncoming()" id="answer-btn" title="Принять">
        <svg width="28" height="28"><use href="#ic-phone-answer"/></svg>
      </button>
      <span class="call-btn-label">Принять</span>
    `;
    document.getElementById('call-actions').prepend(wrap);
  }
}

// Кнопка "Принять" вызывает эту функцию — данные берутся из pendingIncomingCall
window.answerIncoming = async () => {
  if (!pendingIncomingCall) { showToast('Данные звонка потеряны'); return; }
  const { chatId, call } = pendingIncomingCall;
  pendingIncomingCall = null;
  await answerCall(chatId, call);
};

async function answerCall(chatId, call) {
  document.getElementById('answer-btn-wrap')?.remove();
  document.getElementById('call-status').textContent = 'Соединение...';

  try {
    await setupStreaming(call.callType || 'voice');
  } catch (e) {
    console.error('Media error:', e);
    showToast('Нет доступа к микрофону');
  }

  pc = new RTCPeerConnection(peerConfig);

  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (e) => {
    document.getElementById('remoteVideo').srcObject = e.streams[0];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) push(ref(db, `calls/${chatId}/calleeCandidates`), e.candidate.toJSON());
  };

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  const answer = await pc.createAnswer();

  await update(ref(db, `calls/${chatId}`), {
    answer: { type: answer.type, sdp: answer.sdp },
    status: 'active'
  });

  await pc.setLocalDescription(answer);

  onChildAdded(ref(db, `calls/${chatId}/callerCandidates`), (snap) => {
    if (pc?.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(console.error);
    }
  });

  document.getElementById('call-status').textContent = '● В эфире';
}

window.endCall = async () => {
  if (currentChatId) {
    await update(ref(db, `calls/${currentChatId}`), { status: 'ended' });
    setTimeout(() => remove(ref(db, `calls/${currentChatId}`)), 1500);
  }
  endCallLocal();
};

function endCallLocal() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (pc) { pc.close(); pc = null; }
  isCallActive = false;
  micMuted = false;
  speakerOff = false;
  pendingIncomingCall = null;
  document.getElementById('call-screen').classList.remove('open');
  document.getElementById('video-container').style.display = 'none';
  document.getElementById('call-ui-top').style.opacity = '1';
  document.getElementById('answer-btn-wrap')?.remove();
}

function resetCallUI() {
  const muteBtn = document.getElementById('mute-btn');
  const speakerBtn = document.getElementById('speaker-btn');
  if (muteBtn) {
    muteBtn.classList.remove('active');
    muteBtn.innerHTML = `<svg width="26" height="26"><use href="#ic-mic"/></svg>`;
    muteBtn.title = 'Выключить микрофон';
  }
  if (speakerBtn) {
    speakerBtn.classList.remove('active');
    speakerBtn.innerHTML = `<svg width="26" height="26"><use href="#ic-volume"/></svg>`;
    speakerBtn.title = 'Выключить динамик';
  }
}

window.toggleMute = (btn) => {
  micMuted = !micMuted;
  localStream?.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
  if (micMuted) {
    btn.classList.add('active');
    btn.innerHTML = `<svg width="26" height="26"><use href="#ic-mic-off"/></svg>`;
    btn.title = 'Включить микрофон';
    showToast('Микрофон выключен');
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `<svg width="26" height="26"><use href="#ic-mic"/></svg>`;
    btn.title = 'Выключить микрофон';
    showToast('Микрофон включён');
  }
};

window.toggleSpeaker = (btn) => {
  speakerOff = !speakerOff;
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) remoteVideo.muted = speakerOff;
  if (speakerOff) {
    btn.classList.add('active');
    btn.innerHTML = `<svg width="26" height="26"><use href="#ic-volume-off"/></svg>`;
    btn.title = 'Включить динамик';
    showToast('Динамик выключен');
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `<svg width="26" height="26"><use href="#ic-volume"/></svg>`;
    btn.title = 'Выключить динамик';
    showToast('Динамик включён');
  }
};

// ===== NEW CHAT =====
window.showNewChat = () => {
  document.getElementById('new-chat-page').classList.add('active');
  document.getElementById('user-search').value = '';
  document.getElementById('user-list').innerHTML = `<div class="empty-state">
    <div class="empty-icon"><svg width="56" height="56" opacity=".35"><use href="#ic-users"/></svg></div>
    <div class="empty-title">Введите имя</div>
    <div class="empty-desc">Найдите пользователей для чата</div>
  </div>`;
  setTimeout(() => document.getElementById('user-search').focus(), 300);
};

window.closeNewChat = () => document.getElementById('new-chat-page').classList.remove('active');

window.searchUsers = (val) => {
  clearTimeout(searchTimeout);
  if (!val.trim()) return;
  searchTimeout = setTimeout(async () => {
    const container = document.getElementById('user-list');
    container.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';
    const snap = await get(ref(db, 'users'));
    const results = Object.values(snap.val() || {}).filter(u =>
      u.uid !== currentUser.uid && u.name?.toLowerCase().includes(val.toLowerCase())
    );
    if (!results.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-title">Не найдено</div>
        <div class="empty-desc">Попробуйте другое имя</div>
      </div>`;
      return;
    }
    container.innerHTML = results.map(u => `
      <div class="user-item" onclick="startDirectChat('${u.uid}','${esc(u.name)}')">
        <div class="avatar"><span>${u.name[0].toUpperCase()}</span></div>
        <div class="user-info">
          <div class="user-name">${esc(u.name)}</div>
          <div class="user-status">${u.online ? '<span style="color:var(--online)">● в сети</span>' : 'не в сети'}</div>
        </div>
        <div class="user-action"><svg width="20" height="20" style="color:var(--text3)"><use href="#ic-chat"/></svg></div>
      </div>`).join('');
  }, 400);
};

window.startDirectChat = async (otherUid, otherName) => {
  const existing = allChats.find(c => c.type === 'direct' && c.members.includes(otherUid));
  if (existing) { closeNewChat(); openChat(existing.id); return; }

  const chatRef = push(ref(db, 'chats'));
  await set(chatRef, {
    type: 'direct',
    members: [currentUser.uid, otherUid],
    memberNames: {
      [currentUser.uid]: currentUser.displayName || 'Аноним',
      [otherUid]: otherName
    },
    lastMessageTime: serverTimestamp()
  });
  closeNewChat();
  openChat(chatRef.key);
};

// ===== NEW GROUP =====
window.showNewGroup = () => {
  selectedGroupMembers = [];
  document.getElementById('new-group-page').classList.add('active');
  document.getElementById('group-name').value = '';
  document.getElementById('selected-members').innerHTML = '';
  document.getElementById('group-user-list').innerHTML = `<div class="empty-state">
    <div class="empty-icon"><svg width="56" height="56" opacity=".35"><use href="#ic-users"/></svg></div>
    <div class="empty-title">Добавьте участников</div>
    <div class="empty-desc">Введите имя для поиска</div>
  </div>`;
};

window.closeNewGroup = () => document.getElementById('new-group-page').classList.remove('active');

window.searchGroupUsers = (val) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const container = document.getElementById('group-user-list');
    if (!val.trim()) {
      container.innerHTML = `<div class="empty-state"><div class="empty-title">Введите имя</div></div>`;
      return;
    }
    const snap = await get(ref(db, 'users'));
    const results = Object.values(snap.val() || {}).filter(u =>
      u.uid !== currentUser.uid && u.name?.toLowerCase().includes(val.toLowerCase())
    );
    if (!results.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-title">Не найдено</div></div>`;
      return;
    }
    container.innerHTML = results.map(u => {
      const selected = selectedGroupMembers.find(m => m.uid === u.uid);
      return `<div class="user-item" onclick="toggleGroupMember('${u.uid}','${esc(u.name)}')">
        <div class="avatar" style="${selected ? 'background:var(--accent)' : ''}">
          ${selected
            ? `<svg width="20" height="20"><use href="#ic-check"/></svg>`
            : `<span>${u.name[0].toUpperCase()}</span>`}
        </div>
        <div class="user-info"><div class="user-name">${esc(u.name)}</div></div>
      </div>`;
    }).join('');
  }, 400);
};

window.toggleGroupMember = (uid, name) => {
  const idx = selectedGroupMembers.findIndex(m => m.uid === uid);
  if (idx >= 0) selectedGroupMembers.splice(idx, 1);
  else selectedGroupMembers.push({ uid, name });
  renderSelectedMembers();
  searchGroupUsers(document.getElementById('group-search').value);
};

function renderSelectedMembers() {
  document.getElementById('selected-members').innerHTML = selectedGroupMembers.map(m => `
    <div class="selected-chip" onclick="toggleGroupMember('${m.uid}','${esc(m.name)}')">
      <div class="chip-avatar">${m.name[0].toUpperCase()}</div>
      ${esc(m.name)}
      <svg width="12" height="12" style="color:var(--text3)"><use href="#ic-x"/></svg>
    </div>`).join('');
}

window.createGroup = async () => {
  const name = document.getElementById('group-name').value.trim();
  if (!name) { showToast('Введите название группы'); return; }
  if (!selectedGroupMembers.length) { showToast('Добавьте хотя бы одного участника'); return; }

  const members = [currentUser.uid, ...selectedGroupMembers.map(m => m.uid)];
  const memberNames = { [currentUser.uid]: currentUser.displayName || 'Аноним' };
  selectedGroupMembers.forEach(m => { memberNames[m.uid] = m.name; });

  const chatRef = push(ref(db, 'chats'));
  await set(chatRef, {
    type: 'group',
    name,
    members,
    memberNames,
    lastMessage: 'Группа создана 👥',
    lastMessageTime: serverTimestamp()
  });
  closeNewGroup();
  openChat(chatRef.key);
};

// ===== UTILS =====
const esc = (s) => s
  ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  : '';

window.showToast = (msg) => {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3000);
};

// Сброс онлайн-статуса при закрытии страницы
window.addEventListener('beforeunload', () => {
  if (currentUser) syncUserStatus(false);
});
