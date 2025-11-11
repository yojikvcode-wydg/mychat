import React, { useState, useEffect, useRef } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

const App = () => {
  const [users, setUsers] = useState([]);
  const [targetId, setTargetId] = useState(null);
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const chatEndRef = useRef(null);

  // Устанавливаем пользователя
  const username = localStorage.getItem("username") || "User1";
  const userId = localStorage.getItem("user_id") || "user-uuid-1";

  // WebSocket для статусов пользователей
  useEffect(() => {
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsStatus = new WebSocket(`${wsProtocol}://${window.location.host}/ws/status`);

    wsStatus.onmessage = (event) => {
      const allUsers = JSON.parse(event.data);
      setUsers(allUsers.filter(u => u.id !== userId));
    };
  }, [userId]);

  // WebSocket для чата с выбранным пользователем
  useEffect(() => {
    if (!targetId) return;

    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    wsRef.current = new WebSocket(`${wsProtocol}://${window.location.host}/ws/${userId}/${targetId}`);

    wsRef.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      setMessages(prev => [...prev, msg]);
    };

    return () => wsRef.current && wsRef.current.close();
  }, [targetId, userId]);

  // Авто-прокрутка вниз при новых сообщениях
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Отправка сообщений
  const sendMessage = (text) => {
    if (wsRef.current && text.trim() !== "") {
      wsRef.current.send(text);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      sendMessage(e.target.value);
      e.target.value = "";
    }
  };

  return (
    <div className="container-fluid" style={{ height: "100vh" }}>
      <div className="row h-100">
        {/* Левая колонка: пользователи */}
        <div className="col-3 border-end d-flex flex-column p-2">
          <h5>Пользователи</h5>
          <ul className="list-group flex-grow-1 overflow-auto">
            {users.map(u => (
              <li
                key={u.id}
                className={`list-group-item list-group-item-action ${targetId === u.id ? "active" : ""}`}
                onClick={() => {
                  setTargetId(u.id);
                  setMessages([]);
                }}
              >
                {u.name} {u.online ? "●" : "○"}
              </li>
            ))}
          </ul>
        </div>

        {/* Правая колонка: чат */}
        <div className="col-9 d-flex flex-column">
          <div className="flex-grow-1 overflow-auto p-2" style={{ backgroundColor: "#f8f9fa" }}>
            {targetId ? (
                messages.map((m, idx) => (
                <div
                    key={idx}
                    className={`message-row ${m.user === username ? "justify-content-end" : "justify-content-start"}`}
                >
                    <div className={`message-bubble ${m.user === username ? "message-own" : "message-other"}`}>
                    <div className="message-text">{m.text}</div>
                    <div className="message-time">{m.time}</div>
                    </div>
                </div>
                ))
            ) : (
              <p className="text-center text-muted mt-5">Выберите пользователя для чата</p>
            )}
            <div ref={chatEndRef}></div>
          </div>

          {targetId && (
            <input
              type="text"
              className="form-control"
              placeholder="Напишите сообщение..."
              onKeyPress={handleKeyPress}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
