# MyChat - Real-time Chat Application

A modern, full-featured real-time chat application built with FastAPI (Python backend) and vanilla JavaScript (frontend), featuring WebSocket-based messaging, user authentication, online status tracking, and thematic room functionality.

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [WebSocket Architecture](#websocket-architecture)
- [Security Implementation](#security-implementation)
- [Frontend Architecture](#frontend-architecture)
- [Installation & Setup](#installation--setup)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Project Structure](#project-structure)
- [Deployment Considerations](#deployment-considerations)

## Features

- 🔐 **User Authentication**: Secure password hashing using Argon2 algorithm
- 💬 **Real-time Messaging**: WebSocket-based bidirectional communication
- 👥 **User Status Tracking**: Real-time online/offline status with connection-based health checks
- 📬 **Unread Message Counting**: Per-user unread message tracking
- 🏠 **Thematic Rooms**: Multi-user chat rooms with custom names and descriptions
- 💬 **Reply & Quote**: Reply to messages in room chats with quote preview
- 🎨 **Modern UI**: Responsive design with mobile-first approach
- 📱 **Mobile Optimized**: Telegram-like mobile interface with drawer navigation
- 🔔 **Browser Notifications**: Desktop notifications for new messages
- 🎨 **Message Styling**: Color-coded message bubbles in room chats

## Architecture Overview

### Backend Architecture

The application follows an **asynchronous event-driven architecture** using FastAPI's WebSocket support:

- **Single-threaded async I/O**: All operations use Python's `asyncio` for non-blocking I/O
- **Connection Management**: Multiple WebSocket connection pools for different purposes:
  - `connections`: Private chat connections (`{user_id: {target_id: websocket}}`)
  - `global_connections`: Global notification connections (`{user_id: websocket}`)
  - `room_connections`: Room chat connections (`{room_id: {user_id: websocket}}`)
  - `user_status_connections`: Status broadcast connections (set of websockets)
- **Database Layer**: SQLite with three separate databases for separation of concerns
- **Message Routing**: Intelligent message routing based on connection type and target

### Frontend Architecture

- **Vanilla JavaScript**: No framework dependencies, pure ES6+ JavaScript
- **Event-Driven UI**: DOM manipulation based on WebSocket events
- **State Management**: Client-side state for active chats, rooms, and WebSocket connections
- **Responsive Design**: CSS media queries with mobile-first approach
- **Progressive Enhancement**: Works without JavaScript for basic functionality

## Tech Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.10+ | Runtime environment |
| **FastAPI** | 0.121.0 | Web framework and API |
| **Uvicorn** | 0.38.0 | ASGI server with WebSocket support |
| **WebSockets** | 15.0.1 | WebSocket protocol implementation |
| **Passlib** | 1.7.4 | Password hashing (Argon2) |
| **Jinja2** | 3.1.6 | Template engine |
| **aiofiles** | 25.1.0 | Async file operations |
| **python-multipart** | 0.0.20 | Form data parsing |
| **SQLite3** | Built-in | Database engine |

### Frontend

| Technology | Purpose |
|------------|---------|
| **Vanilla JavaScript (ES6+)** | Client-side logic, WebSocket handling |
| **HTML5** | Semantic markup |
| **CSS3** | Styling with Flexbox, Grid, Media Queries |
| **WebSocket API** | Real-time bidirectional communication |
| **LocalStorage API** | Client-side data persistence |
| **Notification API** | Browser notifications |

### Development Tools

- **Uvicorn**: Development server with hot-reload (`--reload` flag)
- **Python venv**: Virtual environment for dependency isolation

## Database Schema

The application uses **three separate SQLite databases** for data separation:

### 1. `users.db` - User Management

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,              -- UUID v4 user identifier
    name TEXT UNIQUE,                  -- Unique username
    password_hash TEXT,                -- Argon2 hashed password
    online INTEGER                     -- Boolean: 0 = offline, 1 = online
)
```

### 2. `chathistory.db` - Private Chat Messages

```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,                       -- Sender user ID
    receiver TEXT,                     -- Receiver user ID
    text TEXT,                         -- Message content
    timestamp TEXT,                    -- ISO format timestamp
    read INTEGER DEFAULT 0             -- Boolean: 0 = unread, 1 = read
)
```

### 3. `rooms.db` - Room Management

**Rooms Table:**
```sql
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,               -- UUID v4 room identifier
    name TEXT NOT NULL,                -- Room name
    description TEXT,                  -- Room description
    creator_id TEXT NOT NULL,          -- User ID of creator
    created_at TEXT NOT NULL           -- ISO format timestamp
)
```

**Room Members Table:**
```sql
CREATE TABLE room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
)
```

**Room Messages Table:**
```sql
CREATE TABLE room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    reply_to_sender_id TEXT,           -- Optional: ID of replied message sender
    reply_to_sender_name TEXT,         -- Optional: Name of replied message sender
    reply_to_text TEXT,                -- Optional: Text of replied message
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
)
```

## WebSocket Architecture

The application uses **four distinct WebSocket endpoints** for different purposes:

### 1. Private Chat WebSocket
**Endpoint:** `/ws/{user_id}/{target_id}`

- **Purpose**: Bidirectional messaging between two users
- **Connection Pool**: `connections[user_id][target_id] = websocket`
- **Message Flow**: 
  - Client sends message → Server saves to DB → Server broadcasts to target's connection
- **Lifecycle**: Created when user opens a chat, closed when switching chats

### 2. Global Notification WebSocket
**Endpoint:** `/ws/global/{user_id}`

- **Purpose**: Connection health monitoring and global notifications
- **Connection Pool**: `global_connections[user_id] = websocket`
- **Features**:
  - **Ping/Pong Mechanism**: Server sends ping every 60 seconds, client responds with pong
  - **Connection Health**: Active connection = user is online
  - **Duplicate Prevention**: Closes old connection if new one is established
- **Lifecycle**: Established on login, closed on logout/disconnect

### 3. Status Broadcast WebSocket
**Endpoint:** `/ws/status`

- **Purpose**: Broadcast user online/offline status to all connected clients
- **Connection Pool**: `user_status_connections` (set of websockets)
- **Broadcast Frequency**: On every status change
- **Message Format**: JSON array of all users with their status

### 4. Room Chat WebSocket
**Endpoint:** `/ws/room/{room_id}/{user_id}`

- **Purpose**: Multi-user room messaging
- **Connection Pool**: `room_connections[room_id][user_id] = websocket`
- **Message Format**: 
  - Plain text for regular messages
  - JSON with `{text, reply_to}` for replies
- **Broadcast**: Messages broadcast to all room members
- **Access Control**: Only room members can connect

## Security Implementation

### Password Security

- **Algorithm**: Argon2 (via Passlib)
- **Hashing**: One-way hashing, passwords never stored in plain text
- **Verification**: `pwd_context.verify(plain_password, hashed_password)`

### Authentication

- **Method**: Cookie-based authentication
- **Cookie Encoding**: Base64 encoding (development only)
- **Cookie Name**: `user_id`
- **Session Management**: Stateless (cookie contains user ID)

### Input Validation

- **Username**: Unique constraint at database level
- **Message Content**: Stored as-is (sanitization recommended for production)
- **Room Access**: Membership verification before WebSocket connection

### Security Considerations for Production

⚠️ **Current implementation is for development only**. Production should include:

- Signed/encrypted cookies (e.g., using `itsdangerous`)
- CSRF protection
- Rate limiting (e.g., using `slowapi`)
- Input sanitization (HTML escaping, XSS prevention)
- SQL injection prevention (already using parameterized queries)
- HTTPS/WSS only
- Environment variables for sensitive configuration
- Proper logging and monitoring
- Session timeout mechanisms

## Frontend Architecture

### State Management

```javascript
// Global state variables
let activeUser = null;           // Currently active private chat
let activeRoom = null;           // Currently active room chat
let wsChats = {};                // Private chat WebSocket connections
let wsRooms = {};                // Room WebSocket connections
let allUsers = [];               // Cached user list
let allRooms = [];               // Cached room list
let replyToMessage = null;       // Reply context for room messages
```

### WebSocket Connection Lifecycle

1. **On Page Load**: 
   - Connect to `/ws/status` for status updates
   - Connect to `/ws/global/{user_id}` for health monitoring
   - Load user list and room list via REST API

2. **On Chat Open**:
   - Close previous chat WebSocket (if exists)
   - Open new WebSocket to `/ws/{user_id}/{target_id}`
   - Load chat history via REST API
   - Mark messages as read

3. **On Room Open**:
   - Close private chat WebSocket (if exists)
   - Open new WebSocket to `/ws/room/{room_id}/{user_id}`
   - Load room history via REST API
   - Clear reply context

4. **On Message Send**:
   - Check WebSocket connection state
   - Send message (plain text or JSON for replies)
   - Clear input and reply context

### UI Components

- **Sidebar**: User list and room list with online status indicators
- **Chat Container**: Message display area with scroll-to-bottom
- **Message Composer**: Input field with send button
- **Reply Indicator**: Shows reply context above composer
- **Mobile Drawer**: Slide-out navigation for mobile devices
- **Modals**: Room creation, user management, room deletion

### Responsive Design

- **Mobile Breakpoint**: `< 768px`
- **Features**:
  - Drawer navigation (Telegram-like)
  - Full-width chat container
  - Touch-optimized buttons
  - Safe area insets for notched devices
  - Dynamic viewport height (`100dvh`)

## Installation & Setup

### Prerequisites

- **Python 3.10 or higher**
- **pip** (Python package manager)
- **Modern web browser** with WebSocket support

### Step-by-Step Setup

1. **Clone or navigate to the project directory**:
   ```bash
   cd mychat
   ```

2. **Create a virtual environment** (recommended):
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the development server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   The `--reload` flag enables auto-reload on code changes.

5. **Access the application**:
   ```
   http://localhost:8000
   ```

### First Run

On first run, the application will:
- Create three SQLite database files (`users.db`, `chathistory.db`, `rooms.db`)
- Initialize all database tables
- Set all users to offline status
- Start the connection cleanup task

## API Documentation

### HTTP Endpoints

#### Authentication

- **`GET /`** - Login/Registration page
- **`POST /login`** - User login
  - **Body**: `FormData(username, password)`
  - **Response**: Redirect to `/index` or error
- **`POST /register`** - User registration
  - **Body**: `FormData(username, password)`
  - **Response**: Redirect to `/index` or error
- **`GET /logout`** - Logout user
  - **Response**: Redirect to `/`

#### Chat Interface

- **`GET /index`** - Main chat interface (requires authentication)
- **`GET /chat/{target_id}`** - Alternative chat view

#### REST API

- **`GET /api/unread/{user_id}`** - Get unread message counts
  - **Response**: `JSON {target_id: count, ...}`
- **`POST /api/mark_read/{user_id}/{target_id}`** - Mark messages as read
- **`GET /api/history/{user_id}/{target_id}`** - Get chat history
  - **Response**: `JSON [{sender, text, time, read}, ...]`

#### Room Management API

- **`POST /api/rooms/create`** - Create a new room
  - **Body**: `JSON {name, description}`
  - **Response**: `JSON {id, name, description, creator_id, created_at}`
- **`GET /api/rooms`** - Get all rooms for current user
  - **Response**: `JSON [{id, name, description, creator_id, member_count}, ...]`
- **`GET /api/rooms/{room_id}`** - Get room details
- **`DELETE /api/rooms/{room_id}`** - Delete a room (creator only)
- **`POST /api/rooms/{room_id}/add_user`** - Add user to room
  - **Body**: `JSON {user_id}`
- **`POST /api/rooms/{room_id}/remove_user`** - Remove user from room
  - **Body**: `JSON {user_id}`
- **`GET /api/rooms/{room_id}/members`** - Get room members
  - **Response**: `JSON [{id, name}, ...]`
- **`GET /api/rooms/{room_id}/history`** - Get room message history
  - **Response**: `JSON [{user, text, time, sender_id, room_id, reply_to?}, ...]`

### WebSocket Endpoints

#### Private Chat
- **`/ws/{user_id}/{target_id}`**
  - **Send**: Plain text message
  - **Receive**: `JSON {user, text, time}`

#### Global Notifications
- **`/ws/global/{user_id}`**
  - **Send**: `JSON {type: "pong"}` (response to ping)
  - **Receive**: `JSON {type: "ping"}` (every 60 seconds)

#### Status Updates
- **`/ws/status`**
  - **Receive**: `JSON [{id, name, online}, ...]` (on status change)

#### Room Chat
- **`/ws/room/{room_id}/{user_id}`**
  - **Send**: 
    - Plain text: `"Hello"`
    - Reply: `JSON {text: "Hello", reply_to: {sender_id, sender_name, text}}`
  - **Receive**: `JSON {user, text, time, sender_id, room_id, reply_to?}`

## Development

### Running in Development Mode

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Features:**
- Auto-reload on code changes
- Detailed error messages
- WebSocket connection logging

### Code Structure

- **`main.py`**: All backend logic (routes, WebSocket handlers, database functions)
- **`static/chat.js`**: Frontend JavaScript (WebSocket handling, UI updates)
- **`static/style.css`**: All styling (responsive design, themes)
- **`templates/`**: HTML templates (Jinja2)

### Debugging

**Backend Logging:**
- WebSocket connections: `[WS CONNECT]`, `[ROOM WS CONNECT]`
- Message sending: `[ROOM WS RECV]`
- Status updates: `[WS GLOBAL]`

**Frontend Logging:**
- Console logs prefixed with `[SEND]`, `[WS room]`, `[WS chat]`
- Open browser DevTools to see WebSocket messages and errors

### Testing

Currently, the application is tested manually. For production, consider:
- Unit tests for database functions
- Integration tests for API endpoints
- WebSocket connection tests
- Frontend E2E tests (e.g., Playwright, Cypress)

## Project Structure

```
mychat/
├── main.py                    # FastAPI application, routes, WebSocket handlers
├── requirements.txt           # Python dependencies
├── README.md                  # This file
├── .gitignore                 # Git ignore rules
│
├── templates/                 # HTML templates (Jinja2)
│   ├── index.html            # Main chat interface
│   ├── login.html            # Login/registration page
│   ├── chat.html             # Alternative chat view
│   ├── chat_messages.html    # Chat message template
│   └── search.html           # Search interface
│
├── static/                    # Static files
│   ├── chat.js               # Frontend JavaScript (WebSocket, UI logic)
│   ├── style.css             # All CSS (responsive, themes, animations)
│   └── favicon/              # Favicon files
│
├── src/                       # React components (not currently used)
│   ├── App.js
│   └── index.js
│
├── user_histories/            # Legacy: user chat history files (deprecated)
│
├── favicon/                   # Favicon files
│
└── *.db                       # SQLite database files (auto-generated)
    ├── users.db              # User accounts
    ├── chathistory.db        # Private chat messages
    └── rooms.db              # Rooms and room messages
```

## Deployment Considerations

### Production Checklist

- [ ] **Environment Variables**: Move configuration to environment variables
- [ ] **HTTPS/WSS**: Use SSL/TLS certificates (Let's Encrypt)
- [ ] **Cookie Security**: Implement signed cookies with secure flags
- [ ] **Rate Limiting**: Add rate limiting to prevent abuse
- [ ] **Input Sanitization**: Sanitize all user inputs (XSS prevention)
- [ ] **Database**: Consider PostgreSQL for production (SQLite is fine for small scale)
- [ ] **Logging**: Implement proper logging (e.g., using `logging` module)
- [ ] **Monitoring**: Add health checks and monitoring
- [ ] **Backup**: Implement database backup strategy
- [ ] **CORS**: Configure CORS properly if needed
- [ ] **Static Files**: Serve static files via CDN or reverse proxy (Nginx)
- [ ] **Process Manager**: Use systemd, supervisor, or PM2
- [ ] **Reverse Proxy**: Use Nginx or Caddy as reverse proxy

### Recommended Production Setup

```nginx
# Nginx configuration example
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Scaling Considerations

- **Horizontal Scaling**: WebSocket connections are in-memory, so multiple instances require:
  - Redis for shared connection state
  - Message queue for cross-instance messaging
- **Database**: SQLite doesn't support concurrent writes well; use PostgreSQL for multiple instances
- **Load Balancing**: Use sticky sessions for WebSocket connections

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the MIT License.

## Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Built with ❤️ using FastAPI, WebSockets, and Vanilla JavaScript**
