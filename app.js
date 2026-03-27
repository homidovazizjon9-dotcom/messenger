// ===== FIREBASE & WEBRTC IMPORTS =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, updateProfile, signOut
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getDatabase, ref, set, push, onValue, onChildAdded, update, remove,
  serverTimestamp, get, child
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
let pc = null; // RTCPeerConnection
let localStream = null;
let isCallActive = false;
let selectedGroupMembers = [];

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
  if (!name) { showToast('Введите имя для семьи'); return; }
  
  const btn = document.getElementById('btn-anon');
  btn.disabled = true;
  btn.textContent = 'Входим...';
  
  try {
    const { user } = await signInAnonymously(auth);
    await updateProfile(user, { displayName: name });
    await syncUserStatus(true);
  } catch (e) {
    console.error(e);
    document.getElementById('auth-error').textContent = 'Ошибка входа';
    btn.disabled = false;
  }
};

window.doLogout = async () => {
  if (currentUser) {
    await syncUserStatus(false);
    await signOut(auth);
  }
  allChats = [];
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
  const letter = (currentUser.displayName || '?')[0].toUpperCase();
  document.getElementById('header-avatar-letter').textContent = letter;
  if (currentUser.photoURL) {
    document.getElementById('header-avatar').innerHTML = `<img src="${currentUser.photoURL}" />`;
  }
}

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
    container.innerHTML = `<div class="empty-state"><div class="empty-title">Нет чатов</div></div>`;
    return;
  }

  container.innerHTML = chats.map(chat => {
    const isGroup = chat.type === 'group';
    const name = isGroup ? chat.name : getDirectChatName(chat);
    const letter = (name || '?')[0].toUpperCase();
    const preview = chat.lastMessage || 'Напишите первым';
    const unread = (chat.unread && chat.unread[currentUser.uid]) || 0;
    const active = currentChatId === chat.id ? 'active' : '';

    return `
      <div class="chat-item ${active}" onclick="openChat('${chat.id}')">
        <div class="avatar" style="${isGroup ? 'background:linear-gradient(135deg,#e040fb,#7c4dff)' : ''}">
          <span>${isGroup ? '👥' : letter}</span>
        </div>
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

window.openChat = async (id) => {
  currentChatId = id;
  currentChatData = allChats.find(c => c.id === id);
  
  const isGroup = currentChatData.type === 'group';
  const name = isGroup ? currentChatData.name : getDirectChatName(currentChatData);
  
  document.getElementById('chat-header-name').textContent = name;
  document.getElementById('chat-avatar-letter').textContent = name[0].toUpperCase();
  document.getElementById('chat-view').classList.add('active');
  document.getElementById('sidebar').classList.add('hidden');
  
  // Clear unread
  if (currentChatData.unread && currentChatData.unread[currentUser.uid]) {
    update(ref(db, `chats/${id}/unread`), { [currentUser.uid]: 0 });
  }

  listenMessages(id);
};

window.closeChat = () => {
  currentChatId = null;
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('sidebar').classList.remove('hidden');
};

// ===== MESSAGES LOGIC =====
function listenMessages(chatId) {
  const msgsRef = ref(db, `messages/${chatId}`);
  onValue(msgsRef, (snapshot) => {
    const data = snapshot.val();
    const msgs = data ? Object.values(data) : [];
    renderMessages(msgs);
  });
}

function renderMessages(msgs) {
  const area = document.getElementById('messages-area');
  if (!msgs.length) {
    area.innerHTML = '<div class="empty-state"><div class="empty-title">Напишите первым!</div></div>';
    return;
  }

  area.innerHTML = msgs.map(m => {
    const isOut = m.senderId === currentUser.uid;
    return `
      <div class="message ${isOut ? 'out' : 'in'}">
        ${!isOut && currentChatData.type === 'group' ? `<div class="msg-sender">${esc(m.senderName)}</div>` : ''}
        <div class="msg-bubble">${esc(m.text)}</div>
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
  
  const msgRef = push(ref(db, `messages/${currentChatId}`));
  await set(msgRef, {
    text,
    senderId: currentUser.uid,
    senderName: currentUser.displayName || 'Аноним',
    time: serverTimestamp()
  });

  // Update chat meta
  const updates = {
    lastMessage: text,
    lastMessageTime: serverTimestamp()
  };
  currentChatData.members.forEach(m => {
    if (m !== currentUser.uid) {
      updates[`unread/${m}`] = (currentChatData.unread?.[m] || 0) + 1;
    }
  });
  update(ref(db, `chats/${currentChatId}`), updates);
};

// ===== VIDEO CALL LOGIC (WebRTC) =====

async function setupStreaming() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById('localVideo').srcObject = localStream;
  document.getElementById('video-container').style.display = 'block';
  document.getElementById('call-ui-top').style.opacity = '0.2';
}

window.startCall = async (type) => {
  if (!currentChatId) return;
  isCallActive = true;
  document.getElementById('call-screen').classList.add('open');
  document.getElementById('call-status').textContent = 'Вызов...';
  
  if (type === 'video') await setupStreaming();

  pc = new RTCPeerConnection(peerConfig);
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    document.getElementById('remoteVideo').srcObject = event.streams[0];
  };

  const callRef = ref(db, `calls/${currentChatId}`);
  const offer = await pc.createOffer();

  // Attach ICE candidate listener early
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      push(ref(db, `calls/${currentChatId}/callerCandidates`), e.candidate.toJSON());
    }
  };

  // Set the calling state to DB FIRST to ensure the parent node exists before pushing candidates
  await set(callRef, {
    offer: { type: offer.type, sdp: offer.sdp },
    status: 'calling',
    callerId: currentUser.uid,
    callerName: currentUser.displayName || 'Аноним'
  });

  // Set local description, this generates ICE candidates
  await pc.setLocalDescription(offer);

  // Queue to store incoming candidates from callee before remoteDescription is ready
  const candidateQueue = [];

  onChildAdded(ref(db, `calls/${currentChatId}/calleeCandidates`), (snap) => {
    const candidate = new RTCIceCandidate(snap.val());
    if (pc.currentRemoteDescription) {
      pc.addIceCandidate(candidate);
    } else {
      candidateQueue.push(candidate);
    }
  });

  // Listen for answer
  onValue(callRef, async (snap) => {
    const data = snap.val();
    if (data?.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      document.getElementById('call-status').textContent = 'В эфире';
      
      // Execute any delayed candidates now that remote description is ready
      candidateQueue.forEach(c => pc.addIceCandidate(c));
      candidateQueue.length = 0;
    }
    if (data?.status === 'ended') endCallLocal();
  });
};

function listenGlobalCalls() {
  // Listen for incoming calls in all chats user is member of
  onValue(ref(db, 'calls'), (snap) => {
    const calls = snap.val();
    if (!calls) return;
    
    Object.entries(calls).forEach(([chatId, call]) => {
      const chat = allChats.find(c => c.id === chatId);
      if (chat && call.status === 'calling' && call.callerId !== currentUser.uid && !isCallActive) {
        showIncomingCall(chatId, call);
      }
    });
  });
}

function showIncomingCall(chatId, call) {
  isCallActive = true;
  currentChatId = chatId;
  document.getElementById('call-screen').classList.add('open');
  document.getElementById('call-name').textContent = call.callerName;
  document.getElementById('call-status').textContent = 'Входящий звонок...';
  
  // Custom answer logic needed here, for now just a toggle btn simulation
  const answerBtn = document.createElement('button');
  answerBtn.className = 'call-btn';
  answerBtn.style.background = 'var(--online)';
  answerBtn.textContent = '📞';
  answerBtn.id = 'answer-btn';
  answerBtn.onclick = () => answerCall(chatId, call);
  document.querySelector('.call-actions').prepend(answerBtn);
}

async function answerCall(chatId, call) {
  document.getElementById('answer-btn')?.remove();
  await setupStreaming();
  
  pc = new RTCPeerConnection(peerConfig);
  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.ontrack = e => document.getElementById('remoteVideo').srcObject = e.streams[0];

  // Attach ICE candidate listener early
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      push(ref(db, `calls/${chatId}/calleeCandidates`), e.candidate.toJSON());
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  const answer = await pc.createAnswer();
  
  // Update DB FIRST before generating candidates locally
  await update(ref(db, `calls/${chatId}`), { 
    answer: { type: answer.type, sdp: answer.sdp },
    status: 'active'
  });

  // Generate ICE candidates
  await pc.setLocalDescription(answer);

  onChildAdded(ref(db, `calls/${chatId}/callerCandidates`), snap => {
    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(snap.val()));
    }
  });
  
  document.getElementById('call-status').textContent = 'В эфире';
}

window.endCall = async () => {
  if (currentChatId) {
    await update(ref(db, `calls/${currentChatId}`), { status: 'ended' });
    setTimeout(() => remove(ref(db, `calls/${currentChatId}`)), 1000);
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
  document.getElementById('call-screen').classList.remove('open');
  document.getElementById('video-container').style.display = 'none';
  document.getElementById('call-ui-top').style.opacity = '1';
  document.getElementById('answer-btn')?.remove();
}

// ===== UTILS =====
const esc = (s) => s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
window.showToast = (m) => {
  const t = document.getElementById('toast');
  t.textContent = m; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
};

// ===== NEW CHAT / USER SEARCH =====
window.showNewChat = () => {
  document.getElementById('new-chat-page').classList.add('active');
  document.getElementById('new-chat-page').style.cssText = 'position:absolute;width:100%;z-index:30;background:var(--bg);height:100dvh;';
  document.getElementById('user-search').value = '';
  document.getElementById('user-list').innerHTML = `<div class="empty-state"><div class="empty-title">Введите имя или email</div></div>`;
};

window.closeNewChat = () => document.getElementById('new-chat-page').classList.remove('active');

let searchTimeout;
window.searchUsers = (val) => {
  clearTimeout(searchTimeout);
  if (!val.trim()) return;
  searchTimeout = setTimeout(async () => {
    const container = document.getElementById('user-list');
    container.innerHTML = '<div style="display:flex;justify-content:center;padding:32px"><div class="spinner"></div></div>';
    
    const snap = await get(ref(db, 'users'));
    const allUsers = snap.val() || {};
    const results = Object.values(allUsers).filter(u => 
      u.uid !== currentUser.uid && u.name.toLowerCase().includes(val.toLowerCase())
    );

    if (!results.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-title">Не найдено</div></div>`;
      return;
    }

    container.innerHTML = results.map(u => `
      <div class="user-item" onclick="startDirectChat('${u.uid}','${esc(u.name)}')">
        <div class="avatar"><span>${u.name[0].toUpperCase()}</span></div>
        <div class="user-info"><div class="user-name">${esc(u.name)}</div></div>
        <span style="color:var(--text3);font-size:20px">💬</span>
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
  document.getElementById('new-group-page').classList.add('active');
  document.getElementById('new-group-page').style.cssText = 'position:absolute;width:100%;z-index:30;background:var(--bg);height:100dvh;';
  document.getElementById('group-name').value = '';
  document.getElementById('selected-members').innerHTML = '';
  document.getElementById('group-user-list').innerHTML = `<div class="empty-state"><div class="empty-title">Добавьте участников</div></div>`;
};

window.closeNewGroup = () => document.getElementById('new-group-page').classList.remove('active');

window.searchGroupUsers = (val) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const container = document.getElementById('group-user-list');
    const snap = await get(ref(db, 'users'));
    const allUsers = snap.val() || {};
    const results = Object.values(allUsers).filter(u => 
      u.uid !== currentUser.uid && u.name.toLowerCase().includes(val.toLowerCase())
    );
    container.innerHTML = results.map(u => {
      const selected = selectedGroupMembers.find(m => m.uid === u.uid);
      return `<div class="user-item" onclick="toggleGroupMember('${u.uid}','${esc(u.name)}')">
        <div class="avatar" style="${selected ? 'background:var(--accent)' : ''}">${selected ? '✓' : u.name[0]}</div>
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
    <div class="selected-chip" onclick="toggleGroupMember('${m.uid}','${esc(m.name)}')">${esc(m.name)} ✕</div>
  `).join('');
}

window.createGroup = async () => {
  const name = document.getElementById('group-name').value.trim();
  if (!name || !selectedGroupMembers.length) return showToast('Заполните все поля');

  const chatRef = push(ref(db, 'chats'));
  const members = [currentUser.uid, ...selectedGroupMembers.map(m => m.uid)];
  const memberNames = { [currentUser.uid]: currentUser.displayName || 'Аноним' };
  selectedGroupMembers.forEach(m => memberNames[m.uid] = m.name);

  await set(chatRef, {
    type: 'group',
    name,
    members,
    memberNames,
    lastMessage: 'Группа создана',
    lastMessageTime: serverTimestamp()
  });
  closeNewGroup();
  openChat(chatRef.key);
};
