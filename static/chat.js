// static/chat.js
document.addEventListener("DOMContentLoaded", () => {
  const username = window.CURRENT_USERNAME || "";

  const usersContainer = document.getElementById("users-list");
  const chatHeader = document.getElementById("chat-with");
  const chatMessages = document.getElementById("chat-messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const replyIndicator = document.getElementById("replyIndicator");
  const replyToUser = document.getElementById("replyToUser");
  const replyToQuote = document.getElementById("replyToQuote");
  const replyIndicatorClose = document.getElementById("replyIndicatorClose");
  
  // Mobile menu elements
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const mobileOverlay = document.getElementById("mobileOverlay");
  const sidebar = document.getElementById("sidebar");
  const mobileBackBtn = document.getElementById("mobileBackBtn");
  const chatContainer = document.querySelector(".chat-container");

  const audio = new Audio("/static/notify.mp3");

  let allUsers = [];
  let activeUser = null;
  const wsChats = {};  // <--- несколько WebSocket соединений по user.id
  let wsStatus = null;
  let wsGlobal = null;
  const unread = {};
  
  // Reply functionality for rooms only
  let replyToMessage = null; // {sender_id, sender_name, text}

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";

  // helper: get cookie
  function getCookie(name) {
    const m = document.cookie.match("(^|;) ?"+name+"=([^;]*)(;|$)");
    return m ? m[2] : null;
  }

  // ---- UNREAD COUNTS ----
  async function loadUnreadFromDB() {
    const myId = getCookie("user_id");
    if (!myId) return;
    try {
      const res = await fetch(`/api/unread/${myId}`);
      if (!res.ok) return;
      const data = await res.json();
      // Only update unread counts from API, don't reset to 0 for all users
      // This ensures we only show actual unread messages
      for (const sid in data) {
        unread[sid] = parseInt(data[sid]) || 0;
      }
      // Only set to 0 for users that are in the API response but have 0 unread
      // Don't reset users that aren't in the response (they might have unread we haven't loaded yet)
      for (const u of allUsers) {
        if (u.id in data && data[u.id] === 0) {
          unread[u.id] = 0;
        } else if (!(u.id in data)) {
          // Keep existing unread count if not in API response
          if (!(u.id in unread)) {
            unread[u.id] = 0;
          }
        }
      }
      renderUsers();
      console.log("[unread] loaded from DB", unread);
    } catch (err) {
      console.warn("Ошибка получения непрочитанных:", err);
    }
  }

  // ---- STATUS WS ----
  function openStatusWS(){
    wsStatus = new WebSocket(`${wsProtocol}://${location.host}/ws/status`);
    wsStatus.onopen = () => console.log("[WS status] opened");
    wsStatus.onmessage = (e) => {
      try {
        allUsers = JSON.parse(e.data);
        for (const u of allUsers)
          if (!(u.id in unread)) unread[u.id] = 0;
        renderUsers();
      } catch (err) {
        console.error("Invalid WS status payload:", err, e.data);
      }
    };
    wsStatus.onclose = () => {
      console.log("[WS status] closed, reconnecting...");
      setTimeout(openStatusWS, 1500);
    };
    wsStatus.onerror = (e) => console.warn("[WS status] error", e);
  }
  openStatusWS();

  // ---- GLOBAL WS ----
  function openGlobalWS() {
    const myId = getCookie("user_id");
    if (!myId) {
      console.warn("[WS global] no myId cookie yet");
      setTimeout(openGlobalWS, 1000);
      return;
    }
    try {
      wsGlobal = new WebSocket(`${wsProtocol}://${location.host}/ws/global/${myId}`);
    } catch (e) {
      console.warn("Не удалось открыть global WS", e);
      setTimeout(openGlobalWS, 1500);
      return;
    }
    wsGlobal.onopen = () => console.log("[WS global] opened");
    wsGlobal.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "notify") {
          const senderId = msg.from_id;
          if (!activeUser || activeUser.id !== senderId) {
            unread[senderId] = (unread[senderId] || 0) + 1;
            tryPlaySound();
            tryShowSystemNotification({ user: msg.from_name, text: msg.text });
            renderUsers();
          }
        } else if (msg.type === "unread_reset" && msg.from_id) {
          // Mark messages from this user as read
          unread[msg.from_id] = 0;
          renderUsers();
        } else if (msg.type === "ping") {
          // Respond to ping to keep connection alive
          // Server uses this to detect if connection is still active
          try {
            // Send pong response
            wsGlobal.send(JSON.stringify({ type: "pong" }));
          } catch (e) {
            console.warn("[WS global] Failed to send pong:", e);
          }
        }
      } catch (err) {
        console.error("Invalid global ws message:", err, e.data);
      }
    };
    wsGlobal.onclose = () => {
      console.log("[WS global] closed, reconnecting...");
      setTimeout(openGlobalWS, 1500);
    };
    wsGlobal.onerror = (e) => console.warn("[WS global] error", e);
  }
  openGlobalWS();

  // ---- RENDER USERS LIST ----
  function renderUsers() {
    usersContainer.innerHTML = "";

    const sorted = allUsers.slice().sort((a,b) => {
      if (a.name === username) return 1;
      if (b.name === username) return -1;
      if (a.online === b.online) return a.name.localeCompare(b.name);
      return a.online ? -1 : 1;
    });

    for (const u of sorted) {
      if (u.name === username) continue;

      const li = document.createElement("li");
      li.dataset.id = u.id;

      const left = document.createElement("div");
      left.className = "user-left";

      const avatar = document.createElement("div");
      avatar.className = "user-avatar";
      avatar.textContent = (u.name[0] || "?").toUpperCase();
      left.appendChild(avatar);

      const nameWrap = document.createElement("div");
      nameWrap.style.display = "flex";
      nameWrap.style.flexDirection = "column";

      const nameEl = document.createElement("div");
      nameEl.className = "user-name";
      nameEl.textContent = u.name;
      nameWrap.appendChild(nameEl);

      const statusEl = document.createElement("div");
      statusEl.className = "user-status " + (u.online ? "online" : "offline");
      statusEl.textContent = u.online ? "online" : "offline";
      nameWrap.appendChild(statusEl);

      left.appendChild(nameWrap);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "8px";

      const count = unread[u.id] || 0;
      if (count > 0) {
        const badge = document.createElement("span");
        badge.className = "new-msg-badge";
        badge.textContent = count;
        right.appendChild(badge);
        li.classList.add("new-msg");
      }

      li.appendChild(left);
      li.appendChild(right);

      if (activeUser && activeUser.id === u.id) li.classList.add("active-user");

      li.addEventListener("click", () => openChatWith(u));
      usersContainer.appendChild(li);
    }

    updateTabTitleAndFavicon();
  }

  // ---- MOBILE MENU HANDLING ----
  function openMobileMenu() {
    if (sidebar) sidebar.classList.add("open");
    if (mobileOverlay) mobileOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeMobileMenu() {
    if (sidebar) sidebar.classList.remove("open");
    if (mobileOverlay) mobileOverlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  // Mobile menu button click
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sidebar && sidebar.classList.contains("open")) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }

  // Close menu when clicking overlay
  if (mobileOverlay) {
    mobileOverlay.addEventListener("click", closeMobileMenu);
  }

  // Close menu when clicking a user (on mobile)
  function handleMobileUserClick() {
    if (window.innerWidth <= 768) {
      closeMobileMenu();
    }
  }

  // Mobile back button
  if (mobileBackBtn) {
    mobileBackBtn.addEventListener("click", () => {
      activeUser = null;
      if (chatHeader) {
        chatHeader.textContent = "Выберите пользователя для чата";
      }
      if (chatMessages) {
        chatMessages.innerHTML = "";
      }
      if (chatContainer) {
        chatContainer.classList.remove("has-active-chat");
      }
      // Close any open chat WebSockets
      for (const id in wsChats) {
        try {
          wsChats[id].close();
        } catch (e) {}
        delete wsChats[id];
      }
      // Show menu on mobile
      if (window.innerWidth <= 768) {
        openMobileMenu();
      }
    });
  }

  // Handle window resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth > 768) {
        closeMobileMenu();
        if (sidebar) sidebar.classList.remove("open");
        if (mobileOverlay) mobileOverlay.classList.remove("active");
      }
    }, 250);
  });

  // ---- OPEN CHAT ----
  function openChatWith(u) {
    // Clear room chat when opening private chat
    activeRoom = null;
    activeUser = u;
    unread[u.id] = 0;
    renderUsers();
    renderRooms(); // Update room list to clear active state
    
    // Mobile: mark chat container as active
    if (chatContainer) {
      chatContainer.classList.add("has-active-chat");
      chatContainer.classList.remove("has-active-room");
    }
    
    // Close mobile menu when opening chat
    handleMobileUserClick();
    
    // Close any room WebSockets
    for (const id in wsRooms) {
      try {
        wsRooms[id].close();
      } catch (e) {}
      delete wsRooms[id];
    }
    
    // Clear reply indicator when switching to private chat
    hideReplyIndicator();

    const myId = getCookie("user_id");
    if (!myId) {
      console.warn("No user_id cookie.");
      return;
    }

    if (chatHeader) {
      const content = chatHeader.querySelector(".chat-header-content");
      if (content) {
        content.innerHTML = `<h3>${u.name}</h3>`;
      } else {
        chatHeader.innerHTML = `<div class="chat-header-content"><h3>${u.name}</h3></div>`;
      }
    }
    if (chatMessages) {
      chatMessages.innerHTML = "";
    }

    fetch(`/history/${myId}/${u.id}`)
      .then(r => r.json())
      .then(arr => {
        if (chatMessages) {
          chatMessages.innerHTML = "";
          for (const m of arr) appendMessageToChat(m);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      })
      .catch(err => console.error("history fetch error", err));

    // создаём WS если его ещё нет
    if (!wsChats[u.id]) {
      const url = `${wsProtocol}://${location.host}/ws/${myId}/${u.id}`;
      console.log("[WS chat] opening", url);
      const ws = new WebSocket(url);

      ws.onopen = () => console.log("[WS chat] open", u.name);
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (err) {
          console.error("Invalid chat message", ev.data);
          return;
        }
        handleIncomingMessage(msg);
      };
      ws.onclose = () => {
        console.log("[WS chat] closed", u.name);
        delete wsChats[u.id];
      };
      ws.onerror = (e) => console.error("[WS chat] error", e);

      wsChats[u.id] = ws;
    }

    // mark read immediately and update unread count
    fetch(`/api/mark_read/${myId}/${u.id}`, { method: "POST" })
      .then(res => res.json())
      .then(() => {
        // Immediately update unread count for this user
        unread[u.id] = 0;
        renderUsers();
        // Also refresh from DB after a short delay to ensure consistency
        setTimeout(loadUnreadFromDB, 500);
      })
      .catch(err => console.warn("mark_read error", err));
  }

  // ---- MESSAGE HANDLING ----
  function handleIncomingMessage(msg) {
    // Check if this is a room message (has room_id) - ignore it here
    if (msg.room_id) {
      // Room messages are handled separately in room WebSocket handler
      return;
    }
    
    const sender = allUsers.find(x => x.name === msg.user);
    const senderId = sender ? sender.id : null;
    const isFromSelf = (msg.user === username);

    if (isFromSelf || (activeUser && senderId === activeUser.id)) {
      // Message is in active chat - show it
      appendMessageToChat(msg);
      // If this is a new message (not from history) and not from self, mark as read
      if (!isFromSelf && activeUser && senderId === activeUser.id) {
        const myId = getCookie("user_id");
        if (myId) {
          // Mark as read in background
          fetch(`/api/mark_read/${myId}/${senderId}`, { method: "POST" })
            .then(() => {
              unread[senderId] = 0;
              renderUsers();
            })
            .catch(err => console.warn("mark_read error", err));
        }
      }
    } else {
      // Message is not in active chat - increment unread
      if (senderId) {
        unread[senderId] = (unread[senderId] || 0) + 1;
      } else {
        unread[msg.user] = (unread[msg.user] || 0) + 1;
      }
      tryPlaySound();
      tryShowSystemNotification(msg);
      renderUsers();
    }
  }

  function appendMessageToChat(msg) {
    if (!chatMessages) return;
    
    const isSelf = (msg.user === username);
    const divWrap = document.createElement("div");
    divWrap.className = "message-row";

    const bubble = document.createElement("div");
    bubble.className = "message " + (isSelf ? "message-self" : "message-other");

    const main = document.createElement("div");
    main.className = "msg-main";

    const text = document.createElement("div");
    text.className = "msg-text";
    text.textContent = msg.text;

    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = msg.time || "";

    main.appendChild(text);
    bubble.appendChild(main);
    bubble.appendChild(time);
    divWrap.appendChild(bubble);
    chatMessages.appendChild(divWrap);
    
    // Smooth scroll to bottom
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 50);
  }

  // ---- SEND MESSAGE ----
  function sendMessage() {
    const txt = (input.value || "").trim();
    if (!txt) {
      console.log("[SEND] Empty message, ignoring");
      return;
    }
    
    console.log("[SEND] sendMessage called, activeRoom:", activeRoom?.id, "activeUser:", activeUser?.id);
    
    // Safety check: ensure only one is active at a time
    if (activeRoom && activeUser) {
      console.error("[SEND] BUG: Both activeRoom and activeUser are set! Clearing activeRoom.");
      activeRoom = null;
      if (chatContainer) {
        chatContainer.classList.remove("has-active-room");
      }
    }
    
    if (activeRoom) {
      // Send to room - verify activeUser is null
      if (activeUser) {
        console.error("[SEND] ERROR: activeUser is set when sending to room! Clearing it.");
        activeUser = null;
      }
      const ws = wsRooms[activeRoom.id];
      if (!ws) {
        console.error("[SEND] Room WebSocket not found for", activeRoom.id, "Available rooms:", Object.keys(wsRooms));
        if (sendBtn) sendBtn.classList.add("btn-warning");
        setTimeout(() => {
          if (sendBtn) sendBtn.classList.remove("btn-warning");
        }, 500);
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn("[SEND] Room WebSocket not connected for", activeRoom.id, "State:", ws.readyState, "Expected:", WebSocket.OPEN);
        if (sendBtn) sendBtn.classList.add("btn-warning");
        setTimeout(() => {
          if (sendBtn) sendBtn.classList.remove("btn-warning");
        }, 500);
        return;
      }
      try {
        // Send message with reply info if replying
        let messageData;
        if (replyToMessage && replyToMessage.sender_id) {
          // Send as JSON with reply info
          messageData = JSON.stringify({
            text: txt,
            reply_to: {
              sender_id: replyToMessage.sender_id,
              sender_name: replyToMessage.sender_name,
              text: replyToMessage.text
            }
          });
          console.log("[SEND] Sending reply to room:", messageData);
        } else {
          // Send as plain text for regular messages
          messageData = txt;
          console.log("[SEND] Sending regular message to room:", messageData);
        }
        ws.send(messageData);
        input.value = "";
        hideReplyIndicator(); // Clear reply after sending
      } catch (e) {
        console.error("[SEND] sendMessage to room failed:", e);
      }
    } else if (activeUser) {
      // Send to private chat - verify activeRoom is null
      if (activeRoom) {
        console.error("[SEND] ERROR: activeRoom is set when sending to private chat! Clearing it.");
        activeRoom = null;
        if (chatContainer) {
          chatContainer.classList.remove("has-active-room");
        }
      }
      const ws = wsChats[activeUser.id];
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected for", activeUser.id);
        if (sendBtn) sendBtn.classList.add("btn-warning");
        setTimeout(() => {
          if (sendBtn) sendBtn.classList.remove("btn-warning");
        }, 500);
        return;
      }
      try {
        ws.send(txt);
        input.value = "";
      } catch (e) {
        console.error("sendMessage failed:", e);
      }
    } else {
      console.warn("No active user or room selected");
    }
  }
  
  // Attach event listeners
  if (sendBtn) {
    sendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      sendMessage();
    });
  }
  
  if (input) {
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        sendMessage();
      }
    });
  }

  // ---- HELPERS ----
  let lastSoundAt = 0;
  function tryPlaySound() {
    const now = Date.now();
    if (now - lastSoundAt < 800) return;
    lastSoundAt = now;
    try { audio.currentTime = 0; audio.play().catch(()=>{}); } catch(e) {}
  }

  function tryShowSystemNotification(msg) {
    if (!("Notification" in window)) return;
    if (document.hasFocus()) return;
    if (Notification.permission === "granted") {
      try {
        const n = new Notification(`Новое сообщение от ${msg.user}`, {
          body: msg.text,
          icon: "/favicon/favicon-96x96.png"
        });
        n.onclick = () => window.focus();
      } catch(e){}
    }
  }

  let flashTimer = null;
  function updateTabTitleAndFavicon() {
    const totalUnread = Object.values(unread).reduce((s, v) => s + (parseInt(v) || 0), 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) Мой чат` : "Мой чат";
    const faviconEl = document.querySelector("link[rel~='icon']");
    if (!faviconEl) return;
    if (totalUnread > 0 && !flashTimer) {
      const originalHref = faviconEl.href;
      let toggle = false;
      flashTimer = setInterval(() => {
        faviconEl.href = toggle ? "/favicon/favicon-alt.png" : originalHref;
        toggle = !toggle;
      }, 800);
    }
    if (totalUnread === 0 && flashTimer) {
      clearInterval(flashTimer);
      flashTimer = null;
      faviconEl.href = "/favicon/favicon-96x96.png";
    }
  }

  // ---- ROOMS FUNCTIONALITY ----
  const roomsList = document.getElementById("rooms-list");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const roomModalOverlay = document.getElementById("roomModalOverlay");
  const roomModal = document.getElementById("roomModal");
  const createRoomForm = document.getElementById("createRoomForm");
  const cancelRoomBtn = document.getElementById("cancelRoomBtn");
  const roomManageModalOverlay = document.getElementById("roomManageModalOverlay");
  const roomManageModal = document.getElementById("roomManageModal");
  const closeRoomManageBtn = document.getElementById("closeRoomManageBtn");
  
  let allRooms = [];
  let activeRoom = null;
  const wsRooms = {}; // {room_id: websocket}
  
  // Color palette for room messages
  const roomMessageColors = [
    { bg: "#f0f9ff", border: "#bae6fd", text: "#0369a1" },
    { bg: "#fef3c7", border: "#fde68a", text: "#92400e" },
    { bg: "#fce7f3", border: "#fbcfe8", text: "#9f1239" },
    { bg: "#e0e7ff", border: "#c7d2fe", text: "#3730a3" },
    { bg: "#d1fae5", border: "#a7f3d0", text: "#065f46" },
    { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
    { bg: "#f3e8ff", border: "#e9d5ff", text: "#6b21a8" },
    { bg: "#ecfdf5", border: "#d1fae5", text: "#065f46" }
  ];
  
  // Get color for sender
  function getSenderColor(senderId) {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < senderId.length; i++) {
      hash = ((hash << 5) - hash) + senderId.charCodeAt(i);
      hash = hash & hash;
    }
    return roomMessageColors[Math.abs(hash) % roomMessageColors.length];
  }
  
  // Load rooms
  async function loadRooms() {
    try {
      const res = await fetch("/api/rooms");
      if (!res.ok) return;
      allRooms = await res.json();
      renderRooms();
    } catch (err) {
      console.error("Error loading rooms:", err);
    }
  }
  
  // Render rooms list
  function renderRooms() {
    if (!roomsList) return;
    roomsList.innerHTML = "";
    
    for (const room of allRooms) {
      const li = document.createElement("li");
      li.dataset.roomId = room.id;
      if (activeRoom && activeRoom.id === room.id) {
        li.classList.add("active-room");
      }
      
      const nameDiv = document.createElement("div");
      nameDiv.className = "room-name";
      nameDiv.textContent = room.name;
      
      const infoDiv = document.createElement("div");
      infoDiv.className = "room-info";
      // Get actual member count from API - update room data
      fetch(`/api/rooms/${room.id}/members`)
        .then(r => r.json())
        .then(members => {
          const actualCount = members.length;
          room.member_count = actualCount; // Update room object
          infoDiv.innerHTML = `<span>${room.creator_name}</span> • <span>${actualCount} участников</span>`;
        })
        .catch(() => {
          infoDiv.innerHTML = `<span>${room.creator_name}</span> • <span>${room.member_count} участников</span>`;
        });
      
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "room-actions";
      
      // Manage button (only for creator)
      const myId = getCookie("user_id");
      if (room.creator_id === myId) {
        const manageBtn = document.createElement("button");
        manageBtn.className = "room-action-btn";
        manageBtn.textContent = "⚙";
        manageBtn.title = "Управление";
        manageBtn.onclick = (e) => {
          e.stopPropagation();
          openRoomManage(room);
        };
        actionsDiv.appendChild(manageBtn);
        
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "room-action-btn";
        deleteBtn.textContent = "×";
        deleteBtn.title = "Удалить";
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          deleteRoom(room.id);
        };
        actionsDiv.appendChild(deleteBtn);
      }
      
      li.appendChild(nameDiv);
      li.appendChild(infoDiv);
      li.appendChild(actionsDiv);
      
      li.onclick = () => openRoomChat(room);
      roomsList.appendChild(li);
    }
  }
  
  // Open room chat
  function openRoomChat(room) {
    // Clear private chat when opening room
    activeUser = null;
    activeRoom = room;
    
    // Close any private chat WebSockets
    for (const id in wsChats) {
      try {
        wsChats[id].close();
      } catch (e) {}
      delete wsChats[id];
    }
    
    if (chatContainer) {
      chatContainer.classList.add("has-active-chat");
      chatContainer.classList.add("has-active-room");
    }
    renderRooms();
    handleMobileUserClick();
    
    const myId = getCookie("user_id");
    if (!myId) return;
    
    if (chatHeader) {
      const content = chatHeader.querySelector(".chat-header-content");
      if (content) {
        content.innerHTML = `<h3>${room.name}</h3>`;
        updateRoomHeader(room);
      } else {
        chatHeader.innerHTML = `<div class="chat-header-content"><h3>${room.name}</h3></div>`;
        updateRoomHeader(room);
      }
    }
    if (chatMessages) {
      chatMessages.innerHTML = "";
    }
    hideReplyIndicator(); // Clear reply when switching chats
    
    // Load history
    fetch(`/api/rooms/${room.id}/history`)
      .then(r => r.json())
      .then(arr => {
        if (chatMessages) {
          chatMessages.innerHTML = "";
          for (const m of arr) appendRoomMessageToChat(m);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      })
      .catch(err => console.error("room history error", err));
    
    // Open WebSocket
    if (!wsRooms[room.id] || wsRooms[room.id].readyState !== WebSocket.OPEN) {
      // Close existing connection if it exists but is not open
      if (wsRooms[room.id]) {
        try {
          wsRooms[room.id].close();
        } catch (e) {}
        delete wsRooms[room.id];
      }
      
      const url = `${wsProtocol}://${location.host}/ws/room/${room.id}/${myId}`;
      console.log("[WS room] Opening connection to:", url);
      const ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log("[WS room] open", room.name, "State:", ws.readyState);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (err) {
          console.error("[WS room] Invalid room message", ev.data, err);
          return;
        }
        // Ensure this is a room message
        if (msg.room_id) {
          appendRoomMessageToChat(msg);
        }
      };
      ws.onclose = (event) => {
        console.log("[WS room] closed", room.name, "Code:", event.code, "Reason:", event.reason);
        delete wsRooms[room.id];
      };
      ws.onerror = (e) => {
        console.error("[WS room] error", room.name, e);
      };
      
      wsRooms[room.id] = ws;
    } else {
      console.log("[WS room] Connection already open for", room.name);
    }
  }
  
  // Append room message
  function appendRoomMessageToChat(msg) {
    if (!chatMessages) return;
    
    const myId = getCookie("user_id");
    const isSelf = (msg.sender_id === myId);
    const color = getSenderColor(msg.sender_id);
    
    const divWrap = document.createElement("div");
    divWrap.className = "message-row";
    
    const bubble = document.createElement("div");
    bubble.className = "message message-room";
    bubble.style.backgroundColor = color.bg;
    bubble.style.borderColor = color.border;
    bubble.dataset.senderId = msg.sender_id;
    
    // Add click handler for reply (only in room chats)
    if (activeRoom) {
      bubble.style.cursor = "pointer";
      bubble.onclick = () => {
        if (activeRoom) {
          replyToMessage = {
            sender_id: msg.sender_id,
            sender_name: msg.user,
            text: msg.text
          };
          showReplyIndicator();
        }
      };
    }
    
    const main = document.createElement("div");
    main.className = "msg-main";
    
    // Add reply quote preview if this is a reply
    if (msg.reply_to) {
      const replyPreview = document.createElement("div");
      replyPreview.className = "message-reply-preview";
      replyPreview.style.borderLeftColor = color.border;
      const replyText = document.createElement("span");
      replyText.className = "message-reply-sender";
      replyText.textContent = msg.reply_to.sender_name + ": ";
      const replyQuote = document.createElement("span");
      replyQuote.className = "message-reply-quote";
      replyQuote.textContent = msg.reply_to.text.length > 50 
        ? msg.reply_to.text.substring(0, 50) + "..." 
        : msg.reply_to.text;
      replyPreview.appendChild(replyText);
      replyPreview.appendChild(replyQuote);
      main.appendChild(replyPreview);
    }
    
    if (!isSelf) {
      const sender = document.createElement("div");
      sender.className = "message-room-sender";
      sender.style.color = color.text;
      sender.textContent = msg.user;
      main.appendChild(sender);
    }
    
    const text = document.createElement("div");
    text.className = "msg-text";
    text.textContent = msg.text;
    
    const time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = msg.time || "";
    time.style.color = color.text;
    
    main.appendChild(text);
    bubble.appendChild(main);
    bubble.appendChild(time);
    divWrap.appendChild(bubble);
    chatMessages.appendChild(divWrap);
    
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 50);
  }
  
  // Create room
  createRoomBtn?.addEventListener("click", () => {
    roomModalOverlay?.classList.add("active");
  });
  
  cancelRoomBtn?.addEventListener("click", () => {
    roomModalOverlay?.classList.remove("active");
    createRoomForm?.reset();
  });
  
  roomModalOverlay?.addEventListener("click", (e) => {
    if (e.target === roomModalOverlay) {
      roomModalOverlay.classList.remove("active");
      createRoomForm?.reset();
    }
  });
  
  createRoomForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("roomName")?.value.trim();
    const description = document.getElementById("roomDescription")?.value.trim();
    
    if (!name) return;
    
    try {
      const res = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description })
      });
      
      if (res.ok) {
        const room = await res.json();
        allRooms.push(room);
        renderRooms();
        roomModalOverlay?.classList.remove("active");
        createRoomForm?.reset();
        openRoomChat(room);
      } else {
        alert("Ошибка создания комнаты");
      }
    } catch (err) {
      console.error("Create room error:", err);
      alert("Ошибка создания комнаты");
    }
  });
  
  // Delete room
  async function deleteRoom(roomId) {
    if (!confirm("Вы уверены? Вы потеряете всю историю чата.")) {
      return;
    }
    
    try {
      const res = await fetch(`/api/rooms/${roomId}`, { method: "DELETE" });
      if (res.ok) {
        allRooms = allRooms.filter(r => r.id !== roomId);
        if (activeRoom && activeRoom.id === roomId) {
          activeRoom = null;
          if (chatHeader) {
            const content = chatHeader.querySelector(".chat-header-content");
            if (content) {
              content.innerHTML = '<h3 id="chat-with">Выберите пользователя для чата</h3><div class="room-description" style="display: none;"></div>';
            }
          }
          if (chatMessages) chatMessages.innerHTML = "";
          if (chatContainer) {
            chatContainer.classList.remove("has-active-chat");
            chatContainer.classList.remove("has-active-room");
          }
          // Close WebSocket
          if (wsRooms[roomId]) {
            wsRooms[roomId].close();
            delete wsRooms[roomId];
          }
        }
        renderRooms();
      } else {
        alert("Ошибка удаления комнаты");
      }
    } catch (err) {
      console.error("Delete room error:", err);
      alert("Ошибка удаления комнаты");
    }
  }
  
  // Open room management
  async function openRoomManage(room) {
    const myId = getCookie("user_id");
    if (room.creator_id !== myId) return;
    
    try {
      const membersRes = await fetch(`/api/rooms/${room.id}/members`);
      if (!membersRes.ok) return;
      const members = await membersRes.json();
      
      const title = document.getElementById("roomManageTitle");
      const content = document.getElementById("roomManageContent");
      
      if (title) title.textContent = `Управление: ${room.name}`;
      if (content) {
        content.innerHTML = `
          <p><strong>Описание:</strong> ${room.description || "Нет описания"}</p>
          <p><strong>Создатель:</strong> ${room.creator_name}</p>
          <p><strong>Участники (${members.length}):</strong></p>
          <ul class="room-members-list">
            ${members.map(m => `
              <li>
                <span class="member-name">${m.name}${m.id === room.creator_id ? " (создатель)" : ""}</span>
                ${m.id !== room.creator_id ? `
                  <div class="member-actions">
                    <button class="btn-danger" onclick="removeUserFromRoom('${room.id}', '${m.id}')">Удалить</button>
                  </div>
                ` : ""}
              </li>
            `).join("")}
          </ul>
          <p><strong>Добавить пользователя:</strong></p>
          <select id="addUserSelect" style="width: 100%; padding: 8px; margin-bottom: 12px;">
            <option value="">Выберите пользователя</option>
            ${allUsers.filter(u => !members.find(m => m.id === u.id)).map(u => 
              `<option value="${u.id}">${u.name}</option>`
            ).join("")}
          </select>
          <button class="btn-primary" onclick="addUserToRoom('${room.id}')" style="width: 100%;">Добавить</button>
        `;
      }
      
      roomManageModalOverlay?.classList.add("active");
    } catch (err) {
      console.error("Error loading room members:", err);
    }
  }
  
  // Add user to room
  window.addUserToRoom = async function(roomId) {
    const select = document.getElementById("addUserSelect");
    const userId = select?.value;
    if (!userId) return;
    
    try {
      const res = await fetch(`/api/rooms/${roomId}/add_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId })
      });
      
      if (res.ok) {
        await loadRooms();
        // Refresh the specific room's member count
        const updatedRoom = allRooms.find(r => r.id === roomId);
        if (updatedRoom) {
          fetch(`/api/rooms/${roomId}/members`)
            .then(r => r.json())
            .then(members => {
              updatedRoom.member_count = members.length;
              renderRooms();
            });
        }
        // Update active room if it's the one being modified
        if (activeRoom && activeRoom.id === roomId) {
          activeRoom = updatedRoom;
          if (activeRoom && chatHeader) {
            updateRoomHeader(activeRoom);
          }
        }
        openRoomManage(updatedRoom);
      } else {
        alert("Ошибка добавления пользователя");
      }
    } catch (err) {
      console.error("Add user error:", err);
      alert("Ошибка добавления пользователя");
    }
  };
  
  // Remove user from room
  window.removeUserFromRoom = async function(roomId, userId) {
    if (!confirm("Удалить пользователя из комнаты?")) return;
    
    try {
      const res = await fetch(`/api/rooms/${roomId}/remove_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId })
      });
      
      if (res.ok) {
        await loadRooms();
        // Refresh the specific room's member count
        const updatedRoom = allRooms.find(r => r.id === roomId);
        if (updatedRoom) {
          fetch(`/api/rooms/${roomId}/members`)
            .then(r => r.json())
            .then(members => {
              updatedRoom.member_count = members.length;
              renderRooms();
            });
        }
        // Update active room if it's the one being modified
        if (activeRoom && activeRoom.id === roomId) {
          activeRoom = updatedRoom;
          if (activeRoom && chatHeader) {
            updateRoomHeader(activeRoom);
          }
        }
        openRoomManage(updatedRoom);
      } else {
        alert("Ошибка удаления пользователя");
      }
    } catch (err) {
      console.error("Remove user error:", err);
      alert("Ошибка удаления пользователя");
    }
  };
  
  // Update room header with description
  function updateRoomHeader(room) {
    if (!chatHeader) return;
    const content = chatHeader.querySelector(".chat-header-content");
    if (!content) return;
    
    const titleEl = content.querySelector("h3");
    const descEl = content.querySelector(".room-description");
    
    if (room) {
      if (titleEl) {
        titleEl.textContent = room.name;
      }
      // Add or update description
      if (descEl) {
        descEl.textContent = room.description || "";
        descEl.style.display = room.description ? "block" : "none";
      } else if (room.description) {
        const desc = document.createElement("div");
        desc.className = "room-description";
        desc.textContent = room.description;
        if (titleEl) {
          titleEl.after(desc);
        } else {
          content.appendChild(desc);
        }
      }
    }
  }
  
  closeRoomManageBtn?.addEventListener("click", () => {
    roomManageModalOverlay?.classList.remove("active");
  });
  
  roomManageModalOverlay?.addEventListener("click", (e) => {
    if (e.target === roomManageModalOverlay) {
      roomManageModalOverlay.classList.remove("active");
    }
  });
  
  // sendMessage function is already updated above to handle both rooms and private chats
  
  // Update mobile back button
  if (mobileBackBtn) {
    mobileBackBtn.onclick = () => {
      activeUser = null;
      activeRoom = null;
      if (chatHeader) {
        const content = chatHeader.querySelector(".chat-header-content");
        if (content) {
          content.innerHTML = '<h3 id="chat-with">Выберите пользователя для чата</h3><div class="room-description" style="display: none;"></div>';
        } else {
          chatHeader.innerHTML = '<button class="mobile-back-btn" id="mobileBackBtn" aria-label="Назад к списку">←</button><div class="chat-header-content"><h3 id="chat-with">Выберите пользователя для чата</h3><div class="room-description" style="display: none;"></div></div>';
        }
      }
      if (chatMessages) {
        chatMessages.innerHTML = "";
      }
      if (chatContainer) {
        chatContainer.classList.remove("has-active-chat");
        chatContainer.classList.remove("has-active-room");
      }
      // Close WebSockets
      for (const id in wsChats) {
        try { wsChats[id].close(); } catch (e) {}
        delete wsChats[id];
      }
      for (const id in wsRooms) {
        try { wsRooms[id].close(); } catch (e) {}
        delete wsRooms[id];
      }
      renderRooms();
      if (window.innerWidth <= 768) {
        openMobileMenu();
      }
    };
  }

  // Show reply indicator
  function showReplyIndicator() {
    if (!replyIndicator || !replyToUser || !replyToQuote || !replyToMessage) return;
    
    replyToUser.textContent = replyToMessage.sender_name;
    const quote = replyToMessage.text.length > 50 
      ? replyToMessage.text.substring(0, 50) + "..." 
      : replyToMessage.text;
    replyToQuote.textContent = quote;
    replyIndicator.style.display = "flex";
  }
  
  // Hide reply indicator
  function hideReplyIndicator() {
    if (replyIndicator) {
      replyIndicator.style.display = "none";
    }
    replyToMessage = null;
  }
  
  // Reply indicator close handler
  if (replyIndicatorClose) {
    replyIndicatorClose.addEventListener("click", () => {
      hideReplyIndicator();
    });
  }
  
  // ---- INIT ----
  renderUsers();
  loadRooms();
  openGlobalWS(); // Open global WebSocket for notifications
  setTimeout(loadUnreadFromDB, 800);
  setInterval(loadUnreadFromDB, 10000);
  setInterval(loadRooms, 30000); // Refresh rooms every 30 seconds
});
