# MyChat - Real-time Chat Application

A modern real-time chat application built with FastAPI (Python backend) and vanilla JavaScript (frontend), featuring WebSocket-based messaging, user authentication, and unread message tracking.

## Features

- 🔐 User authentication with secure password hashing (Argon2)
- 💬 Real-time messaging via WebSockets
- 👥 User status (online/offline) tracking
- 📬 Unread message counting
- 🎨 Modern, responsive UI
- 🔔 Browser notifications for new messages
- 📱 Mobile-friendly design

## Tech Stack

- **Backend**: FastAPI, Python 3.10+
- **Database**: SQLite
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Real-time**: WebSockets
- **Authentication**: Passlib with Argon2

## Installation

### Prerequisites

- Python 3.10 or higher
- pip (Python package manager)

### Setup

1. **Clone the repository** (or navigate to the project directory):
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

4. **Run the server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

5. **Open your browser** and navigate to:
   ```
   http://localhost:8000
   ```

## Usage

1. **Register a new account** or **login** with existing credentials
2. **Select a user** from the sidebar to start chatting
3. **Send messages** in real-time
4. **See unread message counts** in the user list
5. **Receive notifications** when you receive new messages

## Project Structure

```
mychat/
├── main.py                 # FastAPI application and routes
├── requirements.txt        # Python dependencies
├── templates/             # HTML templates
│   ├── index.html        # Main chat interface
│   ├── login.html        # Login/registration page
│   └── chat.html         # Alternative chat view
├── static/                # Static files
│   ├── chat.js           # Frontend JavaScript
│   └── style.css         # Styles
├── src/                  # React components (not currently used)
├── user_histories/       # User chat histories
└── *.db                  # SQLite database files
```

## Development

### Running in Development Mode

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The `--reload` flag enables auto-reload on code changes.

### Database

The application uses SQLite databases:
- `users.db` - User accounts and authentication
- `chathistory.db` - Message history

These are created automatically on first run.

## Security Notes

⚠️ **Important**: This is a development version. For production use, consider:

- Implementing secure cookie handling (signed cookies)
- Adding CSRF protection
- Implementing rate limiting
- Adding input validation and sanitization
- Using environment variables for sensitive configuration
- Setting up proper logging and monitoring

See `PROJECT_REVIEW.md` for detailed security recommendations and improvements.

## API Endpoints

- `GET /` - Login page
- `POST /login` - User login
- `POST /register` - User registration
- `GET /index` - Main chat interface
- `GET /chat/{target_id}` - Chat with specific user
- `GET /logout` - Logout
- `GET /history/{user_id}/{target_id}` - Get chat history
- `GET /api/unread/{user_id}` - Get unread message counts
- `POST /api/mark_read/{user_id}/{target_id}` - Mark messages as read
- `WebSocket /ws/{user_id}/{target_id}` - Real-time messaging
- `WebSocket /ws/status` - User status updates
- `WebSocket /ws/global/{user_id}` - Global notifications

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is open source and available under the MIT License.

## Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Note**: See `PROJECT_REVIEW.md` for a comprehensive code review and improvement recommendations.

