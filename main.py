from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import sqlite3
from datetime import datetime
import uuid
import asyncio
import base64
import json
from passlib.context import CryptContext

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# -------------------- DB --------------------
USERS_DB = "users.db"
CHAT_DB = "chathistory.db"
ROOMS_DB = "rooms.db"

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

    # rooms.db - Rooms and room messages
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    # Rooms table
    c.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            creator_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    # Room members table
    c.execute("""
        CREATE TABLE IF NOT EXISTS room_members (
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (room_id, user_id),
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
    """)
    # Room messages table
    c.execute("""
        CREATE TABLE IF NOT EXISTS room_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            reply_to_sender_id TEXT,
            reply_to_sender_name TEXT,
            reply_to_text TEXT,
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()

# -------------------- Users SQLite --------------------
def add_user(user_id, name, password_hash):
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        # New users start as offline - will be set online when global WS connects
        c.execute("INSERT OR IGNORE INTO users(id, name, password_hash, online) VALUES (?, ?, ?, ?)",
                  (user_id, name, password_hash, 0))
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
room_connections = {}  # {room_id: {user_id: websocket}}

async def broadcast_user_status():
    # Update status based on actual connections
    # Users with active global_connections are online
    all_users = get_all_users()
    # Create a set of actually connected user IDs
    connected_user_ids = set(global_connections.keys())
    
    # Update database to reflect actual connection state
    for user in all_users:
        user_id = user["id"]
        is_actually_online = user_id in connected_user_ids
        # Only update if status differs to avoid unnecessary DB writes
        if bool(user["online"]) != is_actually_online:
            set_user_online(user_id, is_actually_online)
            user["online"] = is_actually_online
    
    # Broadcast updated status to all status WebSocket clients
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
    # If there's already a connection for this user, close it first
    if user_id in global_connections:
        try:
            old_ws = global_connections[user_id]
            await old_ws.close()
        except Exception:
            pass
        del global_connections[user_id]
    
    global_connections[user_id] = websocket
    # Set user as online when they establish global connection
    set_user_online(user_id, True)
    await broadcast_user_status()
    
    try:
        while True:
            # Wait for messages from client (ping/pong or notifications)
            # Use receive_text with timeout to keep connection alive
            try:
                # Wait for any message with a timeout
                data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                # If we receive a message, process it
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "pong":
                        # Client responded to ping, connection is alive
                        continue
                except Exception:
                    # Not JSON or other error, ignore
                    pass
            except asyncio.TimeoutError:
                # Timeout - send ping to check if connection is alive
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception as e:
                    # Connection is dead, break the loop
                    print(f"[WS GLOBAL] Ping failed for {user_id}: {e}")
                    break
            except WebSocketDisconnect:
                # Normal disconnect
                break
            except Exception as e:
                # Other error, log and break
                print(f"[WS GLOBAL] Error for {user_id}: {e}")
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS GLOBAL] Unexpected error for {user_id}: {e}")
    finally:
        # Clean up: remove from connections and set offline
        if user_id in global_connections and global_connections[user_id] == websocket:
            del global_connections[user_id]
        # Set user as offline when they disconnect
        set_user_online(user_id, False)
        await broadcast_user_status()

# -------------------- Periodic Cleanup --------------------
async def periodic_connection_cleanup():
    """Periodically check and clean up dead connections"""
    # Note: This cleanup is now minimal - the global_ws handler manages its own lifecycle
    # We only check for connections that might have been left in the dict due to errors
    while True:
        await asyncio.sleep(120)  # Check every 2 minutes (less aggressive)
        # The global_ws handler already manages connection health with pings
        # We don't need to ping here - that would interfere with the handler
        # This cleanup is just a safety net for edge cases
        pass  # Removed aggressive ping checking - let global_ws handle it

# -------------------- Startup --------------------
@app.on_event("startup")
async def startup_event():
    init_db()
    # Set all users offline on startup (they'll be set online when they connect)
    conn = sqlite3.connect(USERS_DB)
    c = conn.cursor()
    try:
        c.execute("UPDATE users SET online=0")
        conn.commit()
    finally:
        conn.close()
    # Start periodic cleanup task
    asyncio.create_task(periodic_connection_cleanup())

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
    # New users start as offline - will be set online when global WS connects
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

    # Don't set online here - wait for global WebSocket connection
    # The status will be set when /ws/global/{user_id} connects
    response = RedirectResponse("/index", status_code=303)
    response.set_cookie("user_id", user["id"])
    response.set_cookie("username", encode_cookie(username))
    # Status will be updated when global WS connects
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

            # отправляем получателю - только в его приватный чат с отправителем
            # connections[target_id][user_id] - это WS где target_id чатит с user_id
            if target_id in connections and user_id in connections[target_id]:
                try:
                    ws = connections[target_id][user_id]
                    await ws.send_json(message_data)
                except Exception as e:
                    print(f"[WARN] send to connections[{target_id}][{user_id}] failed: {e}")
                    # при ошибке — удаляем это ws
                    try:
                        del connections[target_id][user_id]
                        if not connections[target_id]:
                            del connections[target_id]
                    except Exception:
                        pass

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

# -------------------- Rooms Management --------------------
def create_room(room_id: str, name: str, description: str, creator_id: str):
    """Create a new room"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        created_at = datetime.now().isoformat()
        c.execute("""
            INSERT INTO rooms (id, name, description, creator_id, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (room_id, name, description, creator_id, created_at))
        # Add creator as member
        c.execute("""
            INSERT INTO room_members (room_id, user_id, added_at)
            VALUES (?, ?, ?)
        """, (room_id, creator_id, created_at))
        conn.commit()
    finally:
        conn.close()

def delete_room(room_id: str, user_id: str):
    """Delete a room (only by creator)"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        # Check if user is creator
        c.execute("SELECT creator_id FROM rooms WHERE id=?", (room_id,))
        row = c.fetchone()
        if not row or row[0] != user_id:
            return False
        # Delete room (cascade will delete members and messages)
        c.execute("DELETE FROM rooms WHERE id=?", (room_id,))
        conn.commit()
        return True
    finally:
        conn.close()

def get_room(room_id: str):
    """Get room info"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, name, description, creator_id, created_at
            FROM rooms WHERE id=?
        """, (room_id,))
        row = c.fetchone()
        if row:
            return {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "creator_id": row[3],
                "created_at": row[4]
            }
    finally:
        conn.close()
    return None

def get_user_rooms(user_id: str):
    """Get all rooms user is a member of"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        c.execute("""
            SELECT r.id, r.name, r.description, r.creator_id, r.created_at,
                   COUNT(rm.user_id) as member_count
            FROM rooms r
            INNER JOIN room_members rm ON r.id = rm.room_id
            WHERE rm.user_id = ?
            GROUP BY r.id
            ORDER BY r.created_at DESC
        """, (user_id,))
        rooms = []
        for row in c.fetchall():
            creator = get_user_by_id(row[3])
            rooms.append({
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "creator_id": row[3],
                "creator_name": creator["name"] if creator else "Unknown",
                "member_count": row[5],
                "created_at": row[4]
            })
    finally:
        conn.close()
    return rooms

def add_user_to_room(room_id: str, user_id: str, adder_id: str):
    """Add user to room (only by creator)"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        # Check if adder is creator
        c.execute("SELECT creator_id FROM rooms WHERE id=?", (room_id,))
        row = c.fetchone()
        if not row or row[0] != adder_id:
            return False
        # Check if user is already member
        c.execute("SELECT 1 FROM room_members WHERE room_id=? AND user_id=?", (room_id, user_id))
        if c.fetchone():
            return True  # Already member
        # Add user
        added_at = datetime.now().isoformat()
        c.execute("""
            INSERT INTO room_members (room_id, user_id, added_at)
            VALUES (?, ?, ?)
        """, (room_id, user_id, added_at))
        conn.commit()
        return True
    finally:
        conn.close()

def remove_user_from_room(room_id: str, user_id: str, remover_id: str):
    """Remove user from room (only by creator, can't remove creator)"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        # Check if remover is creator
        c.execute("SELECT creator_id FROM rooms WHERE id=?", (room_id,))
        row = c.fetchone()
        if not row or row[0] != remover_id:
            return False
        # Can't remove creator
        if user_id == row[0]:
            return False
        # Remove user
        c.execute("DELETE FROM room_members WHERE room_id=? AND user_id=?", (room_id, user_id))
        conn.commit()
        return True
    finally:
        conn.close()

def get_room_members(room_id: str):
    """Get all members of a room"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        c.execute("""
            SELECT user_id FROM room_members WHERE room_id = ?
        """, (room_id,))
        member_ids = [row[0] for row in c.fetchall()]
        # Get user names from users database
        members = []
        for user_id in member_ids:
            user = get_user_by_id(user_id)
            if user:
                members.append({"id": user_id, "name": user["name"]})
    finally:
        conn.close()
    return members

def is_room_member(room_id: str, user_id: str):
    """Check if user is member of room"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        c.execute("SELECT 1 FROM room_members WHERE room_id=? AND user_id=?", (room_id, user_id))
        return c.fetchone() is not None
    finally:
        conn.close()

def save_room_message(room_id: str, sender_id: str, sender_name: str, text: str,
                     reply_to_sender_id: str = None, reply_to_sender_name: str = None,
                     reply_to_text: str = None):
    """Save message to room"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        timestamp = datetime.now().strftime("%H:%M")
        c.execute("""
            INSERT INTO room_messages (room_id, sender_id, sender_name, text, timestamp,
                                     reply_to_sender_id, reply_to_sender_name, reply_to_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (room_id, sender_id, sender_name, text, timestamp,
              reply_to_sender_id, reply_to_sender_name, reply_to_text))
        conn.commit()
    finally:
        conn.close()

def get_room_history(room_id: str):
    """Get room message history"""
    conn = sqlite3.connect(ROOMS_DB)
    c = conn.cursor()
    try:
        c.execute("""
            SELECT sender_name, text, timestamp, sender_id,
                   reply_to_sender_id, reply_to_sender_name, reply_to_text
            FROM room_messages
            WHERE room_id = ?
            ORDER BY id ASC
        """, (room_id,))
        messages = []
        for row in c.fetchall():
            msg = {
                "user": row[0],
                "text": row[1],
                "time": row[2],
                "sender_id": row[3]
            }
            if row[4]:  # reply_to_sender_id
                msg["reply_to"] = {
                    "sender_id": row[4],
                    "sender_name": row[5],
                    "text": row[6]
                }
            messages.append(msg)
    finally:
        conn.close()
    return messages

# -------------------- Rooms API --------------------
@app.post("/api/rooms/create")
async def api_create_room(request: Request):
    """Create a new room"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    data = await request.json()
    name = data.get("name", "").strip()
    description = data.get("description", "").strip()
    
    if not name:
        return JSONResponse({"error": "Room name required"}, status_code=400)
    
    room_id = str(uuid.uuid4())
    create_room(room_id, name, description, user_id)
    
    room = get_room(room_id)
    creator = get_user_by_id(user_id)
    return {
        "id": room["id"],
        "name": room["name"],
        "description": room["description"],
        "creator_id": room["creator_id"],
        "creator_name": creator["name"] if creator else "Unknown",
        "member_count": 1
    }

@app.delete("/api/rooms/{room_id}")
async def api_delete_room(request: Request, room_id: str):
    """Delete a room"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    if delete_room(room_id, user_id):
        return {"status": "ok"}
    return JSONResponse({"error": "Not authorized or room not found"}, status_code=403)

@app.get("/api/rooms")
async def api_get_rooms(request: Request):
    """Get all rooms for current user"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    rooms = get_user_rooms(user_id)
    return rooms

@app.post("/api/rooms/{room_id}/add_user")
async def api_add_user_to_room(request: Request, room_id: str):
    """Add user to room"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    data = await request.json()
    target_user_id = data.get("user_id")
    
    if not target_user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)
    
    if add_user_to_room(room_id, target_user_id, user_id):
        return {"status": "ok"}
    return JSONResponse({"error": "Not authorized"}, status_code=403)

@app.post("/api/rooms/{room_id}/remove_user")
async def api_remove_user_from_room(request: Request, room_id: str):
    """Remove user from room"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    data = await request.json()
    target_user_id = data.get("user_id")
    
    if not target_user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)
    
    if remove_user_from_room(room_id, target_user_id, user_id):
        return {"status": "ok"}
    return JSONResponse({"error": "Not authorized"}, status_code=403)

@app.get("/api/rooms/{room_id}/members")
async def api_get_room_members(request: Request, room_id: str):
    """Get room members"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    if not is_room_member(room_id, user_id):
        return JSONResponse({"error": "Not a member"}, status_code=403)
    
    members = get_room_members(room_id)
    return members

@app.get("/api/rooms/{room_id}/history")
async def api_get_room_history(request: Request, room_id: str):
    """Get room message history"""
    user_id = request.cookies.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    
    if not is_room_member(room_id, user_id):
        return JSONResponse({"error": "Not a member"}, status_code=403)
    
    messages = get_room_history(room_id)
    return messages

# -------------------- Room WebSocket --------------------
@app.websocket("/ws/room/{room_id}/{user_id}")
async def room_websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    """WebSocket endpoint for room chat"""
    await websocket.accept()
    
    # Check if user is member
    if not is_room_member(room_id, user_id):
        await websocket.close(code=1008, reason="Not a member")
        return
    
    # Add to room connections
    if room_id not in room_connections:
        room_connections[room_id] = {}
    room_connections[room_id][user_id] = websocket
    
    sender_info = get_user_by_id(user_id)
    sender_name = sender_info["name"] if sender_info else user_id
    
    print(f"[ROOM WS CONNECT] {user_id} -> room {room_id}")
    
    try:
        while True:
            data = await websocket.receive_text()
            print(f"[ROOM WS RECV] from {user_id} in room {room_id}: {data}")
            
            # Parse message data (could be JSON with reply info)
            text = data
            reply_to = None
            try:
                msg_data = json.loads(data)
                # Check if it's actually a JSON object with our structure
                if isinstance(msg_data, dict) and "text" in msg_data:
                    text = msg_data.get("text", data)
                    reply_to = msg_data.get("reply_to")
                else:
                    # JSON but not our format - treat as plain text
                    text = data
                    reply_to = None
            except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
                # Plain text message - use data as-is
                text = data
                reply_to = None
            
            timestamp = datetime.now().strftime("%H:%M")
            
            # Extract reply information
            reply_to_sender_id = None
            reply_to_sender_name = None
            reply_to_text = None
            
            if reply_to:
                reply_to_sender_id = reply_to.get("sender_id")
                reply_to_sender_name = reply_to.get("sender_name")
                reply_to_text = reply_to.get("text")
            
            # Save message to database
            save_room_message(room_id, user_id, sender_name, text,
                            reply_to_sender_id, reply_to_sender_name, reply_to_text)
            
            # Prepare message data with sender info
            message_data = {
                "user": sender_name,
                "text": text,
                "time": timestamp,
                "sender_id": user_id,
                "room_id": room_id
            }
            
            # Add reply info if present
            if reply_to:
                message_data["reply_to"] = {
                    "sender_id": reply_to_sender_id,
                    "sender_name": reply_to_sender_name,
                    "text": reply_to_text
                }
            
            # Broadcast to all room members
            for member_id, ws in list(room_connections[room_id].items()):
                try:
                    await ws.send_json(message_data)
                except Exception as e:
                    print(f"[WARN] send to room member {member_id} failed: {e}")
                    # Remove dead connection
                    try:
                        del room_connections[room_id][member_id]
                    except Exception:
                        pass
            
            # If room is empty, remove it
            if not room_connections[room_id]:
                del room_connections[room_id]
    
    except WebSocketDisconnect:
        print(f"[ROOM WS DISCONNECT] {user_id} -> room {room_id}")
        try:
            if room_id in room_connections and user_id in room_connections[room_id]:
                del room_connections[room_id][user_id]
                if not room_connections[room_id]:
                    del room_connections[room_id]
        except Exception as e:
            print(f"[ERROR] cleaning room connections after disconnect: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
        await asyncio.sleep(0.1)
    except Exception as exc:
        print(f"[ERROR] room_websocket_endpoint exception {user_id}->room {room_id}: {exc}")
        try:
            if room_id in room_connections and user_id in room_connections[room_id]:
                del room_connections[room_id][user_id]
                if not room_connections[room_id]:
                    del room_connections[room_id]
        except Exception as e:
            print(f"[ERROR] cleanup after exception: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
        await asyncio.sleep(0.1)
