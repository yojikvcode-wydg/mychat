from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import sqlite3
from datetime import datetime
import uuid
import asyncio
import base64
from passlib.context import CryptContext

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# -------------------- DB --------------------
USERS_DB = "users.db"
CHAT_DB = "chathistory.db"

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def init_db():
    # users.db
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE,
            password_hash TEXT,
            online INTEGER
        )
    """)
    conn.commit()
    conn.close()

    # chathistory.db (messages now has `read` flag)
    conn = sqlite3.connect(CHAT_DB)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT,
            receiver TEXT,
            text TEXT,
            timestamp TEXT,
            read INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()

# -------------------- Users SQLite --------------------
def add_user(user_id, name, password_hash):
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        c.execute("INSERT OR IGNORE INTO users(id, name, password_hash, online) VALUES (?, ?, ?, ?)",
                  (user_id, name, password_hash, 1))
        conn.commit()
    finally:
        conn.close()

def set_user_online(user_id, online: bool):
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        c.execute("UPDATE users SET online=? WHERE id=?", (1 if online else 0, user_id))
        conn.commit()
    finally:
        conn.close()

def get_all_users():
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        c.execute("SELECT id, name, online FROM users")
        users = [{"id": row[0], "name": row[1], "online": bool(row[2])} for row in c.fetchall()]
    finally:
        conn.close()
    return users

def get_user_by_name(name):
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        c.execute("SELECT id, name, password_hash, online FROM users WHERE name=?", (name,))
        row = c.fetchone()
        if row:
            return {"id": row[0], "name": row[1], "password_hash": row[2], "online": bool(row[3])}
    finally:
        conn.close()
    return None

def get_user_by_id(user_id):
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        c.execute("SELECT id, name, password_hash, online FROM users WHERE id=?", (user_id,))
        row = c.fetchone()
        if row:
            return {"id": row[0], "name": row[1], "password_hash": row[2], "online": bool(row[3])}
    finally:
        conn.close()
    return None

# -------------------- Password --------------------
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)

# -------------------- Cookies --------------------
def encode_cookie(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")

def decode_cookie_safe(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return base64.b64decode(value.encode("ascii")).decode("utf-8")
    except Exception:
        return None

# -------------------- Chat --------------------
connections = {}  # {user_id: {target_id: websocket}}
user_status_connections = set()  # WS для обновления статусов
global_connections = {}  # {user_id: websocket}

async def broadcast_user_status():
    users_list = get_all_users()
    for ws in list(user_status_connections):
        try:
            await ws.send_json(users_list)
        except Exception:
            user_status_connections.remove(ws)

@app.websocket("/ws/status")
async def user_status_ws(websocket: WebSocket):
    await websocket.accept()
    user_status_connections.add(websocket)
    await broadcast_user_status()
    try:
        while True:
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        user_status_connections.remove(websocket)

@app.websocket("/ws/global/{user_id}")
async def global_ws(websocket: WebSocket, user_id: str):
    await websocket.accept()
    # запоминаем глобальное соединение (один ws на пользователя)
    global_connections[user_id] = websocket
    try:
        while True:
            # держим соединение живым
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        if user_id in global_connections:
            del global_connections[user_id]

# -------------------- Startup --------------------
@app.on_event("startup")
def startup_event():
    init_db()

# -------------------- Routes --------------------
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    username = decode_cookie_safe(request.cookies.get("username"))
    user_id = request.cookies.get("user_id")
    if user_id and username:
        return RedirectResponse("/index")
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/register")
async def register(username: str = Form(...), password: str = Form(...)):
    username = username.strip()
    if not username or not password:
        return RedirectResponse("/", status_code=303)

    existing = get_user_by_name(username)
    if existing:
        return RedirectResponse("/", status_code=303)

    user_id = str(uuid.uuid4())
    password_hash = hash_password(password)
    add_user(user_id, username, password_hash)

    response = RedirectResponse("/index", status_code=303)
    response.set_cookie("user_id", user_id)
    response.set_cookie("username", encode_cookie(username))
    await broadcast_user_status()
    return response

@app.post("/login")
async def login(username: str = Form(...), password: str = Form(...)):
    user = get_user_by_name(username)
    if not user or not verify_password(password, user.get("password_hash", "")):
        return RedirectResponse("/", status_code=303)

    set_user_online(user["id"], True)
    response = RedirectResponse("/index", status_code=303)
    response.set_cookie("user_id", user["id"])
    response.set_cookie("username", encode_cookie(username))
    await broadcast_user_status()
    return response

@app.get("/logout")
async def logout(request: Request):
    user_id = request.cookies.get("user_id")
    if user_id:
        set_user_online(user_id, False)
    await broadcast_user_status()
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie("user_id")
    response.delete_cookie("username")
    return response

@app.get("/index", response_class=HTMLResponse)
async def index_page(request: Request):
    username = decode_cookie_safe(request.cookies.get("username"))
    if not username:
        return RedirectResponse("/")
    return templates.TemplateResponse("index.html", {"request": request, "username": username})

@app.get("/chat/{target_id}", response_class=HTMLResponse)
async def chat_page(request: Request, target_id: str):
    user_id = request.cookies.get("user_id")
    username = decode_cookie_safe(request.cookies.get("username"))

    target_user = get_user_by_id(target_id)
    if not user_id or not username or not target_user:
        return RedirectResponse("/index")

    return templates.TemplateResponse("chat.html", {
        "request": request,
        "username": username,
        "target_name": target_user["name"],
        "target_id": target_id
    })

# Note: connections is already defined above at line 127

# -------------------- WebSocket чат --------------------
@app.websocket("/ws/{user_id}/{target_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, target_id: str):
    await websocket.accept()
    # защитим структуру (если ещё нет - создаём dict)
    if user_id not in connections:
        connections[user_id] = {}
    connections[user_id][target_id] = websocket

    sender_info = get_user_by_id(user_id)
    receiver_info = get_user_by_id(target_id)
    sender = sender_info["name"] if sender_info else user_id
    receiver = receiver_info["name"] if receiver_info else target_id

    print(f"[WS CONNECT] {user_id} -> {target_id}")  # лог подключения

    try:
        while True:
            data = await websocket.receive_text()
            print(f"[WS RECV] from {user_id} to {target_id}: {data}")
            timestamp = datetime.now().strftime("%H:%M")
            message_data = {"user": sender, "text": data, "time": timestamp}

            # сохраняем в SQLite (read=0)
            conn = sqlite3.connect(CHAT_DB)
            c = conn.cursor()
            c.execute(
                "INSERT INTO messages (sender, receiver, text, timestamp, read) VALUES (?, ?, ?, ?, 0)",
                (sender, receiver, data, timestamp)
            )
            conn.commit()
            conn.close()

            # --- notify global ws for recipient (so client will increment unread) ---
            notif = {
                "type": "notify",
                "from_id": user_id,
                "from_name": sender,
                "text": data,
                "time": timestamp
            }
            if target_id in global_connections:
                try:
                    await global_connections[target_id].send_json(notif)
                except Exception as e:
                    print(f"[WARN] failed to notify global_connections[{target_id}]: {e}")

            # отправляем получателю (всем его WS), если есть
            if target_id in connections:
                # отправляем всем WS, которые зарегистрированы для target_id
                # (connections[target_id] — dict target->ws, т.е. это все ws, где user==target)
                for other_target, ws in list(connections[target_id].items()):
                    try:
                        await ws.send_json(message_data)
                    except Exception as e:
                        print(f"[WARN] send to connections[{target_id}][{other_target}] failed: {e}")
                        # при ошибке — удаляем это ws
                        try:
                            del connections[target_id][other_target]
                        except Exception:
                            pass
                # если словарь пользователя пуст — удалим его
                if not connections[target_id]:
                    del connections[target_id]

            # эхо для отправителя (чтобы он увидел своё сообщение)
            try:
                await websocket.send_json(message_data)
            except Exception as e:
                print(f"[WARN] echo send to sender {user_id}->{target_id} failed: {e}")

    except WebSocketDisconnect:
        # аккуратно убираем соединение (если оно ещё есть)
        print(f"[WS DISCONNECT] {user_id} -> {target_id}")
        try:
            if user_id in connections and target_id in connections[user_id]:
                del connections[user_id][target_id]
                if not connections[user_id]:
                    del connections[user_id]
        except Exception as e:
            print(f"[ERROR] cleaning connections after disconnect: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
        await asyncio.sleep(0.1)
    except Exception as exc:
        print(f"[ERROR] websocket_endpoint exception {user_id}->{target_id}: {exc}")
        # попытка очистки
        try:
            if user_id in connections and target_id in connections[user_id]:
                del connections[user_id][target_id]
                if not connections[user_id]:
                    del connections[user_id]
        except Exception as e:
            print(f"[ERROR] cleanup after exception: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
        await asyncio.sleep(0.1)

# -------------------- История --------------------
@app.get("/history/{user_id}/{target_id}")
async def get_history(user_id: str, target_id: str):
    sender_user = get_user_by_id(user_id)
    receiver_user = get_user_by_id(target_id)
    if not sender_user or not receiver_user:
        return []

    conn = sqlite3.connect(CHAT_DB)
    c = conn.cursor()
    c.execute("""
        SELECT sender, text, timestamp FROM messages
        WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)
        ORDER BY id ASC
    """, (sender_user["name"], receiver_user["name"], receiver_user["name"], sender_user["name"]))
    messages = [{"user": row[0], "text": row[1], "time": row[2]} for row in c.fetchall()]
    conn.close()
    return messages

# -------------------- Unread API --------------------
@app.get("/api/unread/{user_id}")
async def api_get_unread(user_id: str):
    """Return mapping sender_id -> count of unread messages for user_id"""
    user = get_user_by_id(user_id)
    if not user:
        return JSONResponse({}, status_code=404)

    conn = sqlite3.connect(CHAT_DB)
    c = conn.cursor()
    # group by sender name
    c.execute("""
        SELECT sender, COUNT(*) FROM messages
        WHERE receiver=? AND read=0
        GROUP BY sender
    """, (user["name"],))
    rows = c.fetchall()
    conn.close()

    # map sender names to IDs
    result = {}
    for sender_name, cnt in rows:
        s = get_user_by_name(sender_name)
        if s:
            result[s["id"]] = cnt
        else:
            # fallback: use name as key if no id (shouldn't happen)
            result[sender_name] = cnt
    return result

@app.post("/api/mark_read/{user_id}/{target_id}")
async def api_mark_read(user_id: str, target_id: str):
    """Mark as read messages where sender=target and receiver=user"""
    user = get_user_by_id(user_id)
    target = get_user_by_id(target_id)
    if not user or not target:
        return JSONResponse({"status":"error"}, status_code=404)

    conn = sqlite3.connect(CHAT_DB)
    c = conn.cursor()
    c.execute("""
        UPDATE messages SET read=1
        WHERE sender=? AND receiver=? AND read=0
    """, (target["name"], user["name"]))
    conn.commit()
    conn.close()

    # also notify client UI (optional) — send updated unread map to user's global WS if connected
    if user_id in global_connections:
        try:
            # send small 'unread_reset' event
            await global_connections[user_id].send_json({"type":"unread_reset","from_id": target_id})
        except Exception:
            pass

    return {"status": "ok"}
