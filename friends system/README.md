# Friend System (Archived)

This folder contains all the friend system code that was removed from the main Tiger Client launcher.

## Why was it removed?

The friend system was a **local-only** implementation that didn't communicate between different user accounts. To work properly as a real friend system, it would need:

1. A backend server to coordinate between users
2. Real-time communication (WebSocket or polling)  
3. A database to store friend relationships
4. Authentication and user management

## Files in this folder:

### `main-handlers.js`
- All IPC handlers for the friend system (main process)
- Helper functions: `readFriends()`, `writeFriends()`, `validateMinecraftUsername()`
- Handlers for: add, accept, decline, remove, cancel friend requests
- Status update handler
- Debug handler for simulating incoming requests

### `renderer-logic.js`
- Frontend friend system logic (renderer process)
- Functions: `loadFriendsAndRequests()`, `renderFriendItem()`, `attachFriendEventListeners()`
- Event listeners for friend UI
- State management for current request type (incoming/outgoing)
- Debug console function

### `preload-bridges.js`
- IPC bridge functions for exposing friend handlers to renderer
- All `contextBridge` friend method declarations

### `html-markup.html`
- Friends sidebar button
- Friends view panel with sections
- Add Friend modal
- Element references for initialization

### `friends-styles.css`
- Complete styling for friend system UI
- Friend cards, request items, toggles, modals
- Animations and hover effects
- Responsive layout styles

## Features that were implemented:

✅ Add friends by Minecraft username (with Mojang API validation)
✅ Per-account friend data (UUID-based JSON files)
✅ Incoming/outgoing request toggle
✅ Accept/Decline incoming requests
✅ Cancel outgoing requests  
✅ Remove friends from list
✅ Online/Offline friend status display
✅ Self-friend prevention
✅ Debug function to simulate incoming requests

## How to re-integrate:

If you want to add this back to the launcher after implementing a proper backend:

1. **Main Process**: Add code from `main-handlers.js` to `main.js`
2. **Renderer**: Add code from `renderer-logic.js` to `renderer.js`
3. **Preload**: Add bridges from `preload-bridges.js` to `preload.js`
4. **HTML**: Add markup from `html-markup.html` to `index.html`
5. **CSS**: Add styles from `friends-styles.css` to `styles.css`
6. **Replace local storage** with API calls to your backend server

## Backend implementation options:

- **Simple**: Express.js + MongoDB + REST API with polling
- **Real-time**: Socket.io + Express + MongoDB for live updates
- **Managed**: Firebase Realtime Database or Firestore
- **Self-hosted**: Supabase or PocketBase

## Data structure:

```json
{
  "friends": [
    {
      "username": "Steve123",
      "status": "online|offline",
      "lastSeen": 1234567890,
      "currentServer": "Hypixel"
    }
  ],
  "requestsSent": {
    "Alex456": 1234567890
  },
  "requestsReceived": {
    "Notch": 1234567890
  },
  "myStatus": {
    "username": "YourName",
    "status": "online",
    "currentServer": "Hypixel",
    "lastUpdated": 1234567890
  }
}
```

---

**Note**: This was a fully functional local-only friend system. All code is preserved here for future reference or re-implementation with a proper backend.
