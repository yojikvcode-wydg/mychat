// static/chat.js
document.addEventListener("DOMContentLoaded", () => {
  const username = window.CURRENT_USERNAME || "";

  const usersContainer = document.getElementById("users-list");
  const chatHeader = document.getElementById("chat-with");
  const chatMessages = document.getElementById("chat-messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");

  const audio = new Audio("/static/notify.mp3");

  let allUsers = [];
  let activeUser = null;
  const wsChats = {};  // <--- несколько WebSocket соединений по user.id
  let wsStatus = null;
  let wsGlobal = null;
  const unread = {};

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
      for (const sid in data) unread[sid] = parseInt(data[sid]) || 0;
      for (const u of allUsers) if (!(u.id in unread)) unread[u.id] = 0;
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
        } else if (msg.type === "unread_reset") {
          const fromId = msg.from_id;
          if (fromId) {
            unread[fromId] = 0;
            renderUsers();
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

  // ---- OPEN CHAT ----
  function openChatWith(u) {
    activeUser = u;
    unread[u.id] = 0;
    renderUsers();

    const myId = getCookie("user_id");
    if (!myId) {
      console.warn("No user_id cookie.");
      return;
    }

    chatHeader.textContent = `Чат с ${u.name}`;
    chatMessages.innerHTML = "";

    fetch(`/history/${myId}/${u.id}`)
      .then(r => r.json())
      .then(arr => {
        chatMessages.innerHTML = "";
        for (const m of arr) appendMessageToChat(m);
        chatMessages.scrollTop = chatMessages.scrollHeight;
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

    // mark read
    fetch(`/api/mark_read/${myId}/${u.id}`, { method: "POST" })
      .then(res => res.json())
      .then(() => setTimeout(loadUnreadFromDB, 300))
      .catch(err => console.warn("mark_read error", err));
  }

  // ---- MESSAGE HANDLING ----
  function handleIncomingMessage(msg) {
    const sender = allUsers.find(x => x.name === msg.user);
    const senderId = sender ? sender.id : null;
    const isFromSelf = (msg.user === username);

    if (isFromSelf || (activeUser && senderId === activeUser.id)) {
      appendMessageToChat(msg);
    } else {
      if (senderId) unread[senderId] = (unread[senderId] || 0) + 1;
      else unread[msg.user] = (unread[msg.user] || 0) + 1;
      tryPlaySound();
      tryShowSystemNotification(msg);
      renderUsers();
    }
  }

  function appendMessageToChat(msg) {
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ---- SEND MESSAGE ----
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") sendMessage();
  });

  function sendMessage() {
    const txt = (input.value || "").trim();
    if (!txt) return;
    if (!activeUser) return console.warn("No active user selected");

    const ws = wsChats[activeUser.id];
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected for", activeUser.id);
      sendBtn.classList.add("btn-warning");
      setTimeout(()=>sendBtn.classList.remove("btn-warning"), 500);
      return;
    }

    try {
      ws.send(txt);
      input.value = "";
    } catch (e) {
      console.error("sendMessage failed:", e);
    }
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

  // ---- INIT ----
  renderUsers();
  setTimeout(loadUnreadFromDB, 800);
  setInterval(loadUnreadFromDB, 10000);
});
