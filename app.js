// ===== FIREBASE & WEBRTC IMPORTS =====
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

// ===== CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyD17-ChAdiwGem69t3WrdOtZv1LmLpB7U8",
  authDomain: "messenger-57e9d.firebaseapp.com",
  projectId: "messenger-57e9d",
  storageBucket: "messenger-57e9d.firebasestorage.app",
  messagingSenderId: "870982282541",
  appId: "1:870982282541:web:aea1c29193fa098ef2b7a4",
  databaseURL: "https://messenger-57e9d-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

// ===== WEBRTC CONFIG =====
const peerConfig = {
  iceServers: [
    { urls: [
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302'
    ] }
  ]
};

// ===== STATE =====
let currentUser = null;
let currentChatId = null;
let currentChatData = null;
let allChats = [];
let pc = null;
let localStream = null;
let isCallActive = false;
let selectedGroupMembers = [];
let callType = 'voice'; // 'voice' | 'video'
let micMuted = false;
let speakerOff = false;
let pendingIncomingCall = null; // stores { chatId, call } for the answer button

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
  const data = snap.val() || {};

  await update(userRef, {
    uid: currentUser.uid,
    name: currentUser.displayName || data.name || 'Аноним',
    photoURL: currentUser.photoURL || data.photoURL || '',
    online: online,
    lastSeen: serverTimestamp()
  });
}

// ===== AUTH FUNCTIONS =====
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
    btn.innerHTML = `<svg width="18" height="18"><use href="#ic-chat"/></svg> Начать общение`;
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

// ===== UI NAV =====
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
  const letterEl = document.getElementById('header-avatar-letter');
  if (currentUser.photoURL) {
    el.innerHTML = `<img src="${currentUser.photoURL}" alt="avatar" />`;
  } else {
    el.innerHTML = `<span id="header-avatar-letter">${letter}</span>`;
  }
}

// ===== PROFILE =====
window.showProfile = () => {
  const page = document.getElementById('profile-page');
  page.classList.add('active');

  const name = currentUser?.displayName || 'Аноним';
  document.getElementById('profile-name-display').textContent = name;
  document.getElementById('profile-email-display').textContent = 'Анонимный пользователь';

  const letterBig = document.getElementById('profile-avatar-letter-big');
  const bigAvatar = document.getElementById('profile-avatar-big');
  if (currentUser?.photoURL) {
    bigAvatar.innerHTML = `<img src="${currentUser.photoURL}" alt="avatar" /><div class="profile-avatar-edit"><svg width="16" height="16"><use href="#ic-image"/></svg></div>`;
  } else {
    bigAvatar.innerHTML = `<span id="profile-avatar-letter-big">${name[0].toUpperCase()}</span><div class="profile-avatar-edit"><svg width="16" height="16"><use href="#ic-image"/></svg></div>`;
  }
};

window.closeProfile = () => {
  document.getElementById('profile-page').classList.remove('active');
};

window.editName = () => {
  const modal = document.getElementById('edit-name-modal');
  document.getElementById('new-name-input').value = currentUser?.displayName || '';
  modal.classList.add('open');
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
  } catch (e) {
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
  const url = window.location.href;
  navigator.clipboard?.writeText(url).then(() => {
    showToast('Ссылка скопирована ✓');
  }).catch(() => {
    showToast('Не удалось скопировать');
  });
};

// ===== CHATS LOGIC =====
function listenChats() {
  const chatsRef = ref(db, 'chats');
  onValue(chatsRef, (snapshot) => {
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
    const letter = (name || '?')[0].toUpperCase();
    const preview = chat.lastMessage || 'Напишите первым';
    const unread = (chat.unread && chat.unread[currentUser.uid]) || 0;
    const active = currentChatId === chat.id ? 'active' : '';

    const avatarStyle = isGroup ? 'background:linear-gradient(135deg,#e040fb,#7c4dff)' : '';
    const avatarContent = isGroup
      ? `<svg width="22" height="22"><use href="#ic-users"/></svg>`
      : letter;

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
      </div>
    `;
  }).join('');
}

function getDirectChatName(chat) {
  const otherId = chat.members.find(id => id !== currentUser.uid);
  return (chat.memberNames && chat.memberNames[otherId]) || 'Собеседник';
}

window.filterChats = (val) => {
  const q = val.toLowerCase().trim();
  const filtered = q ? allChats.filter(c => {
    const name = c.type === 'group' ? c.name : getDirectChatName(c);
    return name.toLowerCase().includes(q);
  }) : allChats;
  renderChatList(filtered);
};

window.openChat = async (id) => {
  currentChatId = id;
  currentChatData = allChats.find(c => c.id === id);
  if (!currentChatData) return;

  const isGroup = currentChatData.type === 'group';
  const name = isGroup ? currentChatData.name : getDirectChatName(currentChatData);

  document.getElementById('chat-header-name').textContent = name;
  document.getElementById('chat-avatar-letter').textContent = name[0].toUpperCase();

  const chatAvatar = document.getElementById('chat-avatar');
  if (isGroup) {
    chatAvatar.style.background = 'linear-gradient(135deg,#e040fb,#7c4dff)';
    chatAvatar.innerHTML = `<span id="chat-avatar-letter"><svg width="20" height="20"><use href="#ic-users"/></svg></span>`;
  } else {
    chatAvatar.style.background = '';
    chatAvatar.innerHTML = `<span id="chat-avatar-letter">${name[0].toUpperCase()}</span>`;
  }

  document.getElementById('chat-view').classList.add('active');
  document.getElementById('sidebar').classList.add('hidden');

  // hide video call button for group (optional UX choice)
  document.getElementById('btn-video-call').style.display = isGroup ? 'none' : '';

  // Clear unread
  if (currentChatData.unread && currentChatData.unread[currentUser.uid]) {
    update(ref(db, `chats/${id}/unread`), { [currentUser.uid]: 0 });
  }

  listenMessages(id);
  updateOnlineStatus(id, isGroup);
};

function updateOnlineStatus(chatId, isGroup) {
  if (isGroup) {
    document.getElementById('chat-header-status').textContent = 'Группа';
    document.getElementById('chat-header-status').className = 'chat-header-status offline';
    return;
  }
  const chat = allChats.find(c => c.id === chatId);
  if (!chat) return;
  const otherId = chat.members.find(id => id !== currentUser.uid);
  if (!otherId) return;

  onValue(ref(db, `users/${otherId}/online`), (snap) => {
    const isOnline = snap.val();
    const statusEl = document.getElementById('chat-header-status');
    if (!statusEl) return;
    statusEl.textContent = isOnline ? 'в сети' : 'не в сети';
    statusEl.className = 'chat-header-status' + (isOnline ? '' : ' offline');
  });
}

window.closeChat = () => {
  currentChatId = null;
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('sidebar').classList.remove('hidden');
};

// ===== CHAT MENU =====
window.openChatMenu = () => {
  document.getElementById('chat-menu-title').textContent =
    currentChatData ? (currentChatData.type === 'group' ? currentChatData.name : getDirectChatName(currentChatData)) : 'Чат';
  document.getElementById('chat-menu-overlay').classList.add('open');
};

window.closeChatMenu = () => {
  document.getElementById('chat-menu-overlay').classList.remove('open');
};

window.clearChat = async () => {
  closeChatMenu();
  if (!currentChatId) return;
  if (!confirm('Очистить историю чата?')) return;
  await remove(ref(db, `messages/${currentChatId}`));
  await update(ref(db, `chats/${currentChatId}`), { lastMessage: '', lastMessageTime: serverTimestamp() });
  showToast('История очищена');
};

window.deleteChat = async () => {
  closeChatMenu();
  if (!currentChatId) return;
  if (!confirm('Удалить чат? Это действие нельзя отменить.')) return;
  await remove(ref(db, `messages/${currentChatId}`));
  await remove(ref(db, `chats/${currentChatId}`));
  closeChat();
  showToast('Чат удалён');
};

// ===== MESSAGES LOGIC =====
let messagesUnsubscribe = null;

function listenMessages(chatId) {
  const msgsRef = ref(db, `messages/${chatId}`);
  onValue(msgsRef, (snapshot) => {
    const data = snapshot.val();
    const msgs = data ? Object.values(data).sort((a, b) => (a.time || 0) - (b.time || 0)) : [];
    renderMessages(msgs, chatId);
  });
}

function renderMessages(msgs, chatId) {
  if (chatId !== currentChatId) return; // stale update guard
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
    const time = m.time ? new Date(m.time).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';
    const isGroup = currentChatData && currentChatData.type === 'group';

    let content = '';
    if (m.imageUrl) {
      content = `<img class="msg-image" src="${m.imageUrl}" alt="Фото" onclick="openImageViewer('${m.imageUrl}')" />`;
    } else {
      content = `<div class="msg-bubble">${esc(m.text || '')}</div>`;
    }

    return `
      <div class="message ${isOut ? 'out' : 'in'}">
        ${!isOut && isGroup ? `<div class="msg-sender">${esc(m.senderName || '')}</div>` : ''}
        ${content}
        <div class="msg-time">
          ${time}
          ${isOut ? `<svg width="12" height="12" class="msg-status delivered"><use href="#ic-check-dbl"/></svg>` : ''}
        </div>
      </div>
    `;
  }).join('');

  area.scrollTop = area.scrollHeight;
}

window.sendMessage = async () => {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = '';
  autoResize(input);

  const msgRef = push(ref(db, `messages/${currentChatId}`));
  await set(msgRef, {
    text,
    senderId: currentUser.uid,
    senderName: currentUser.displayName || 'Аноним',
    time: serverTimestamp()
  });

  const updates = {
    lastMessage: text,
    lastMessageTime: serverTimestamp()
  };
  if (currentChatData && currentChatData.members) {
    currentChatData.members.forEach(m => {
      if (m !== currentUser.uid) {
        updates[`unread/${m}`] = (currentChatData.unread?.[m] || 0) + 1;
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

    const msgRef = push(ref(db, `messages/${currentChatId}`));
    await set(msgRef, {
      imageUrl: url,
      text: '📷 Фото',
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Аноним',
      time: serverTimestamp()
    });

    const updates = { lastMessage: '📷 Фото', lastMessageTime: serverTimestamp() };
    update(ref(db, `chats/${currentChatId}`), updates);
    showToast('Фото отправлено ✓');
  } catch (e) {
    console.error(e);
    showToast('Ошибка загрузки фото');
  }
  event.target.value = '';
};

// ===== IMAGE VIEWER =====
window.openImageViewer = (url) => {
  const viewer = document.getElementById('image-viewer');
  document.getElementById('image-viewer-img').src = url;
  viewer.classList.add('open');
};

window.closeImageViewer = () => {
  document.getElementById('image-viewer').classList.remove('open');
};

// ===== INPUT UTILS =====
window.autoResize = (el) => {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

window.handleKeydown = (e) => {
  // Send on Enter (Desktop), allow Shift+Enter for newline
  if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 600) {
    e.preventDefault();
    sendMessage();
  }
};

let typingTimeout;
window.handleTyping = () => {
  if (!currentChatId || !currentUser) return;
  clearTimeout(typingTimeout);
  update(ref(db, `typing/${currentChatId}/${currentUser.uid}`), { typing: true, name: currentUser.displayName });
  typingTimeout = setTimeout(() => {
    update(ref(db, `typing/${currentChatId}/${currentUser.uid}`), { typing: false });
  }, 2000);
};

// ===== VIDEO CALL LOGIC (WebRTC) =====

async function setupStreaming(type) {
  const constraints = type === 'video'
    ? { video: { facingMode: 'user' }, audio: true }
    : { audio: true };

  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  const localVideo = document.getElementById('localVideo');
  localVideo.srcObject = localStream;

  if (type === 'video') {
    document.getElementById('video-container').style.display = 'block';
    document.getElementById('call-ui-top').style.opacity = '0.15';
  }
}

window.startCall = async (type) => {
  if (!currentChatId) return;
  callType = type;
  isCallActive = true;
  micMuted = false;
  speakerOff = false;

  document.getElementById('call-screen').classList.add('open');
  document.getElementById('call-name').textContent =
    currentChatData ? (currentChatData.type === 'group' ? currentChatData.name : getDirectChatName(currentChatData)) : 'Звонок';
  document.getElementById('call-status').textContent = 'Вызов...';

  // Reset mute UI
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

  pc.ontrack = (event) => {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = event.streams[0];
  };

  const callRef = ref(db, `calls/${currentChatId}`);
  const offer = await pc.createOffer();

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      push(ref(db, `calls/${currentChatId}/callerCandidates`), e.candidate.toJSON());
    }
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
    if (pc && pc.currentRemoteDescription) {
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
  let alreadyShownCallId = null;

  onValue(ref(db, 'calls'), (snap) => {
    const calls = snap.val();
    if (!calls) {
      // All calls gone — if we were waiting, clean up
      if (alreadyShownCallId) {
        alreadyShownCallId = null;
        if (!pc) endCallLocal(); // only if not already in a call
      }
      return;
    }

    Object.entries(calls).forEach(([chatId, call]) => {
      const chat = allChats.find(c => c.id === chatId);
      if (
        chat &&
        call.status === 'calling' &&
        call.callerId !== currentUser.uid &&
        !isCallActive &&
        chatId !== alreadyShownCallId
      ) {
        alreadyShownCallId = chatId;
        showIncomingCall(chatId, call);
      }
      // If call ended while we're in it
      if (chatId === currentChatId && call.status === 'ended' && isCallActive) {
        endCallLocal();
      }
    });
  });
}

function showIncomingCall(chatId, call) {
  // Store call data safely — never embed SDP in HTML attributes
  pendingIncomingCall = { chatId, call };
  isCallActive = true;
  currentChatId = chatId;

  document.getElementById('call-screen').classList.add('open');
  document.getElementById('call-name').textContent = call.callerName || 'Звонок';
  document.getElementById('call-status').textContent =
    call.callType === 'video' ? '📹 Входящий видеозвонок' : '📞 Входящий звонок';

  resetCallUI();

  // Add answer button — calls window.answerIncoming(), no data in onclick
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

// Called from the answer button — reads pendingIncomingCall set by showIncomingCall
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
  pc.ontrack = e => {
    document.getElementById('remoteVideo').srcObject = e.streams[0];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      push(ref(db, `calls/${chatId}/calleeCandidates`), e.candidate.toJSON());
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  const answer = await pc.createAnswer();

  await update(ref(db, `calls/${chatId}`), {
    answer: { type: answer.type, sdp: answer.sdp },
    status: 'active'
  });

  await pc.setLocalDescription(answer);

  onChildAdded(ref(db, `calls/${chatId}/callerCandidates`), snap => {
    if (pc && pc.remoteDescription) {
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
  if (pc) {
    pc.close();
    pc = null;
  }
  isCallActive = false;
  micMuted = false;
  speakerOff = false;
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
  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  }
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

// ===== UTILS =====
const esc = (s) => s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';

window.showToast = (m) => {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
};

// ===== NEW CHAT / USER SEARCH =====
window.showNewChat = () => {
  const page = document.getElementById('new-chat-page');
  page.classList.add('active');
  document.getElementById('user-search').value = '';
  document.getElementById('user-list').innerHTML = `<div class="empty-state">
    <div class="empty-icon"><svg width="56" height="56" opacity=".35"><use href="#ic-users"/></svg></div>
    <div class="empty-title">Введите имя</div>
    <div class="empty-desc">Найдите пользователей для чата</div>
  </div>`;
  setTimeout(() => document.getElementById('user-search').focus(), 300);
};

window.closeNewChat = () => document.getElementById('new-chat-page').classList.remove('active');

let searchTimeout;
window.searchUsers = (val) => {
  clearTimeout(searchTimeout);
  if (!val.trim()) return;
  searchTimeout = setTimeout(async () => {
    const container = document.getElementById('user-list');
    container.innerHTML = '<div style="display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';

    const snap = await get(ref(db, 'users'));
    const allUsers = snap.val() || {};
    const results = Object.values(allUsers).filter(u =>
      u.uid !== currentUser.uid && u.name && u.name.toLowerCase().includes(val.toLowerCase())
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
      </div>
    `).join('');
  }, 400);
};

window.startDirectChat = async (otherUid, otherName) => {
  const existing = allChats.find(c => c.type === 'direct' && c.members.includes(otherUid));
  if (existing) { closeNewChat(); openChat(existing.id); return; }

  const chatRef = push(ref(db, 'chats'));
  const myName = currentUser.displayName || 'Аноним';
  await set(chatRef, {
    type: 'direct',
    members: [currentUser.uid, otherUid],
    memberNames: { [currentUser.uid]: myName, [otherUid]: otherName },
    lastMessageTime: serverTimestamp()
  });
  closeNewChat();
  openChat(chatRef.key);
};

// ===== NEW GROUP =====
window.showNewGroup = () => {
  selectedGroupMembers = [];
  const page = document.getElementById('new-group-page');
  page.classList.add('active');
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
    const allUsers = snap.val() || {};
    const results = Object.values(allUsers).filter(u =>
      u.uid !== currentUser.uid && u.name && u.name.toLowerCase().includes(val.toLowerCase())
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
            : `<span>${u.name[0].toUpperCase()}</span>`
          }
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
    </div>
  `).join('');
}

window.createGroup = async () => {
  const name = document.getElementById('group-name').value.trim();
  if (!name) { showToast('Введите название группы'); return; }
  if (!selectedGroupMembers.length) { showToast('Добавьте хотя бы одного участника'); return; }

  const chatRef = push(ref(db, 'chats'));
  const members = [currentUser.uid, ...selectedGroupMembers.map(m => m.uid)];
  const memberNames = { [currentUser.uid]: currentUser.displayName || 'Аноним' };
  selectedGroupMembers.forEach(m => memberNames[m.uid] = m.name);

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

// ===== ONLINE PRESENCE CLEANUP =====
window.addEventListener('beforeunload', () => {
  if (currentUser) syncUserStatus(false);
});
