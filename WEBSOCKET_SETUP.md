# 🔌 WebSocket (Socket.io) Implementation Guide

This guide explains how to use real-time WebSocket events in your application for instant updates.

---

## 📚 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Backend Setup](#backend-setup)
4. [Frontend Integration](#frontend-integration)
5. [Event Reference](#event-reference)
6. [Room System](#room-system)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

### What is WebSocket?

WebSocket provides **bi-directional, real-time communication** between the client and server. Unlike traditional HTTP requests, WebSocket maintains a persistent connection.

### Why Socket.io?

- ✅ **Auto-reconnection** - Handles disconnects gracefully
- ✅ **Fallback support** - Uses polling if WebSocket unavailable
- ✅ **Room system** - Easy to broadcast to specific groups
- ✅ **Event-based** - Clean, intuitive API

### What We Implemented (Phase 1)

✅ **Real-time Comments** - New comments appear instantly  
✅ **Real-time Upvotes** - Vote counts update live  
✅ **Real-time Comment Likes** - Like counts update instantly  
✅ **Comment Deletion** - Removed comments disappear live  

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WEBSOCKET FLOW                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  USER A (Frontend)                                           │
│    │                                                          │
│    │ 1. Socket.io client connects                            │
│    │ ──────────────────────────────────────────►            │
│    │                                           Backend        │
│    │ 2. Joins room: "post:123"                Socket.io      │
│    │ ──────────────────────────────────────────►            │
│    │                                                          │
│                                                              │
│  USER B (Frontend)                                           │
│    │                                                          │
│    │ 3. Adds comment to post 123                            │
│    │ ──────────────POST /api/posts/123/comments───────────► │
│    │                                           Backend        │
│    │ 4. Save to DB → Emit Socket event         Saves +       │
│    │ ◄────────────────comment:new─────────────Emits         │
│    │                                                          │
│    ▼                                                          │
│  Comment appears!                                            │
│                                                              │
│                                                              │
│  USER A (Frontend)                                           │
│    │                                                          │
│    │ 5. Receives Socket event                               │
│    │ ◄────────────────comment:new────────────────────────── │
│    │                                           Broadcast to   │
│    ▼                                           room:post:123  │
│  Comment appears instantly! (no API call)                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### How It Works With Redis

```javascript
// When user adds comment:

1. Save to DATABASE (permanent storage)
2. Invalidate REDIS cache (ensure fresh data)
3. Emit SOCKET event (instant UI update)

// Result:
- Connected users → See update instantly (WebSocket)
- New visitors → Get fast data (Redis cache)
- Everyone → Gets correct data (Database as source of truth)
```

---

## 🖥️ Backend Setup

### Installation

```bash
npm install socket.io
```

### File Structure

```
src/
├── socket/
│   ├── socket.config.js          # Socket.io initialization
│   ├── socket.middleware.js      # JWT authentication
│   └── handlers/
│       ├── comment.handler.js    # Comment events
│       └── post.handler.js       # Post/upvote events
```

### Configuration

**src/socket/socket.config.js**
- Initializes Socket.io server
- Configures CORS for frontend
- Manages connection/disconnection
- Provides helper functions to emit events

**src/socket/socket.middleware.js**
- Authenticates socket connections using JWT
- Extracts user info from token
- Allows anonymous connections (for public features)

**server.js**
```javascript
const http = require('http');
const { initializeSocket } = require('./src/socket/socket.config');

// Create HTTP server (needed for Socket.io)
const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server);

server.listen(PORT);
```

### Environment Variables

Add to `.env`:
```bash
# Frontend URL (used for Socket.io CORS)
FRONTEND_URL=http://localhost:3001
```

---

## 💻 Frontend Integration

### Installation

```bash
npm install socket.io-client
```

### Setup (React/Next.js)

**lib/socket.js**
```javascript
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

let socket = null;

export function initSocket(token) {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  });

  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
```

### Usage in Components

**Example: Post Detail Page**

```javascript
'use client';
import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket';

export default function PostPage({ postId }) {
  const [comments, setComments] = useState([]);
  const [upvoteCount, setUpvoteCount] = useState(0);

  useEffect(() => {
    // Fetch initial data
    fetchPost();
    fetchComments();

    // Connect to Socket.io
    const socket = getSocket();
    if (!socket) return;

    // Join post room
    socket.emit('join:post', postId);

    // Listen for real-time events
    socket.on('comment:new', ({ comment }) => {
      setComments(prev => [...prev, comment]);
      console.log('💬 New comment received:', comment);
    });

    socket.on('comment:deleted', ({ commentId }) => {
      setComments(prev => prev.filter(c => c.id !== commentId));
      console.log('🗑️  Comment deleted:', commentId);
    });

    socket.on('comment:liked', ({ commentId, liked, likeCount }) => {
      setComments(prev => 
        prev.map(c => 
          c.id === commentId 
            ? { ...c, like_count: likeCount } 
            : c
        )
      );
    });

    socket.on('post:upvoted', ({ upvoted, upvoteCount }) => {
      setUpvoteCount(upvoteCount);
      console.log('👍 Post upvoted:', upvoteCount);
    });

    socket.on('post:comment_count', ({ commentCount }) => {
      console.log('💬 Comment count updated:', commentCount);
    });

    // Cleanup
    return () => {
      socket.emit('leave:post', postId);
      socket.off('comment:new');
      socket.off('comment:deleted');
      socket.off('comment:liked');
      socket.off('post:upvoted');
      socket.off('post:comment_count');
    };
  }, [postId]);

  return (
    <div>
      <h1>Post {postId}</h1>
      <p>Upvotes: {upvoteCount}</p>
      
      <div>
        {comments.map(comment => (
          <div key={comment.id}>
            <p>{comment.content}</p>
            <span>{comment.like_count} likes</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 📡 Event Reference

### Client → Server Events (Joining Rooms)

#### `join:post`
Join a post room to receive updates about that post.

```javascript
socket.emit('join:post', postId);
```

**Response:**
```javascript
socket.on('joined:post', ({ postId }) => {
  console.log('Joined post:', postId);
});
```

#### `leave:post`
Leave a post room.

```javascript
socket.emit('leave:post', postId);
```

#### `join:board`
Join a board room to receive updates about posts in that board.

```javascript
socket.emit('join:board', boardSlug);
```

#### `leave:board`
Leave a board room.

```javascript
socket.emit('leave:board', boardSlug);
```

---

### Server → Client Events (Real-time Updates)

#### `comment:new`
Emitted when a new comment is added.

```javascript
socket.on('comment:new', ({ postId, comment }) => {
  // comment = {
  //   id, content, author, created_at, parent_id,
  //   like_count, user_has_liked
  // }
  console.log('New comment:', comment);
});
```

#### `comment:deleted`
Emitted when a comment is deleted.

```javascript
socket.on('comment:deleted', ({ postId, commentId }) => {
  console.log('Comment deleted:', commentId);
});
```

#### `comment:liked`
Emitted when a comment is liked/unliked.

```javascript
socket.on('comment:liked', ({ postId, commentId, liked, likeCount }) => {
  // liked = true (liked) or false (unliked)
  console.log('Comment like status:', liked, 'Count:', likeCount);
});
```

#### `post:upvoted`
Emitted when a post is upvoted/downvoted.

```javascript
socket.on('post:upvoted', ({ postId, upvoted, upvoteCount }) => {
  // upvoted = true (upvoted) or false (removed upvote)
  console.log('Post upvote count:', upvoteCount);
});
```

#### `post:comment_count`
Emitted when comment count changes.

```javascript
socket.on('post:comment_count', ({ postId, commentCount }) => {
  console.log('New comment count:', commentCount);
});
```

#### `post:created`
Emitted when a new post is created (to board viewers).

```javascript
socket.on('post:created', ({ boardSlug, post }) => {
  console.log('New post in board:', post);
});
```

#### `post:updated`
Emitted when a post is updated.

```javascript
socket.on('post:updated', ({ postId, updates }) => {
  console.log('Post updated:', updates);
});
```

#### `post:deleted`
Emitted when a post is deleted.

```javascript
socket.on('post:deleted', ({ postId, boardSlug }) => {
  console.log('Post deleted:', postId);
});
```

#### `post:status_changed`
Emitted when post status changes (to board viewers).

```javascript
socket.on('post:status_changed', ({ postId, newStatus }) => {
  console.log('Post status:', newStatus);
});
```

---

## 🏠 Room System

### What are Rooms?

Rooms are virtual channels that allow you to broadcast events to specific groups of users.

### Room Types

#### 1. **Post Rooms** (`post:{postId}`)
- Users viewing a specific post
- Receives: Comments, likes, upvotes for that post

```javascript
socket.emit('join:post', '123');
// User now receives all events for post 123
```

#### 2. **Board Rooms** (`board:{slug}`)
- Users viewing a specific board
- Receives: New posts, post status changes

```javascript
socket.emit('join:board', 'feature-requests');
// User now receives all events for that board
```

#### 3. **User Rooms** (`user:{userId}`)
- Automatically joined on connection (if authenticated)
- Receives: Personal notifications, mentions

### Best Practices

✅ **Join rooms when mounting components**
```javascript
useEffect(() => {
  socket.emit('join:post', postId);
  return () => socket.emit('leave:post', postId);
}, [postId]);
```

✅ **Leave rooms when unmounting**
```javascript
return () => {
  socket.emit('leave:post', postId);
};
```

✅ **Clean up event listeners**
```javascript
return () => {
  socket.off('comment:new');
  socket.off('post:upvoted');
};
```

---

## 🎯 Best Practices

### 1. **Use Socket.io WITH API Calls**

❌ **Don't** rely only on Socket.io:
```javascript
// BAD: Only Socket.io, no initial data
useEffect(() => {
  socket.on('comment:new', addComment);
}, []);
```

✅ **Do** fetch initial data, then use Socket.io for updates:
```javascript
// GOOD: API for initial data, Socket for updates
useEffect(() => {
  fetchComments(); // API call
  socket.on('comment:new', addComment); // Real-time updates
}, []);
```

### 2. **Handle Connection States**

```javascript
const [isConnected, setIsConnected] = useState(false);

useEffect(() => {
  const socket = getSocket();
  
  socket.on('connect', () => setIsConnected(true));
  socket.on('disconnect', () => setIsConnected(false));
  
  return () => {
    socket.off('connect');
    socket.off('disconnect');
  };
}, []);
```

### 3. **Optimize Re-renders**

```javascript
// Use useCallback to prevent unnecessary re-renders
const handleNewComment = useCallback((data) => {
  setComments(prev => [...prev, data.comment]);
}, []);

useEffect(() => {
  socket.on('comment:new', handleNewComment);
  return () => socket.off('comment:new', handleNewComment);
}, [handleNewComment]);
```

### 4. **Handle Duplicates**

```javascript
// Prevent duplicate comments (in case API and Socket both fire)
const handleNewComment = useCallback((data) => {
  setComments(prev => {
    const exists = prev.find(c => c.id === data.comment.id);
    if (exists) return prev; // Already exists, skip
    return [...prev, data.comment];
  });
}, []);
```

### 5. **Error Handling**

```javascript
useEffect(() => {
  const socket = getSocket();
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    toast.error('Real-time connection error');
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
  });
  
  return () => {
    socket.off('error');
    socket.off('connect_error');
  };
}, []);
```

---

## 🐛 Troubleshooting

### Socket Not Connecting

**Check CORS configuration:**
```javascript
// server.js - socket.config.js
cors: {
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST'],
  credentials: true,
}
```

**Check frontend URL:**
```javascript
// Frontend
const SOCKET_URL = 'http://localhost:3000'; // Match backend
```

### Events Not Received

**1. Verify you joined the room:**
```javascript
socket.emit('join:post', postId);
```

**2. Check event name spelling:**
```javascript
// Must match exactly
socket.on('comment:new', handler); // Correct
socket.on('commentNew', handler);  // Wrong!
```

**3. Verify room membership:**
```javascript
// Backend logs should show:
// "📝 User John joined post room: post:123"
```

### Duplicate Events

**Remove old listeners before adding new ones:**
```javascript
useEffect(() => {
  socket.off('comment:new'); // Remove old
  socket.on('comment:new', handler); // Add new
  
  return () => socket.off('comment:new');
}, [postId]);
```

### Connection Keeps Dropping

**Check firewall/proxy settings**
- Some networks block WebSocket
- Socket.io will fallback to polling (slower but works)

**Increase reconnection attempts:**
```javascript
const socket = io(SOCKET_URL, {
  reconnectionAttempts: 10, // Try more times
  reconnectionDelay: 2000,  // Wait longer
});
```

### Token Authentication Issues

**Ensure token is passed correctly:**
```javascript
const socket = io(SOCKET_URL, {
  auth: {
    token: localStorage.getItem('token'), // JWT token
  },
});
```

**Check backend logs:**
```
✅ Socket authenticated: John (user-123)
```

---

## 📊 Performance Tips

### 1. **Debounce Rapid Updates**

```javascript
import { debounce } from 'lodash';

const updateLikeCount = debounce((count) => {
  setLikeCount(count);
}, 100);

socket.on('comment:liked', ({ likeCount }) => {
  updateLikeCount(likeCount);
});
```

### 2. **Limit Room Subscriptions**

```javascript
// BAD: Joining too many rooms
posts.forEach(post => socket.emit('join:post', post.id));

// GOOD: Only join room for active post
socket.emit('join:post', activePostId);
```

### 3. **Clean Up Properly**

```javascript
useEffect(() => {
  // ... socket setup

  return () => {
    socket.emit('leave:post', postId);
    socket.off('comment:new');
    socket.off('post:upvoted');
    // Remove ALL listeners!
  };
}, [postId]);
```

---

## 🎉 Summary

✅ **Socket.io provides real-time updates**  
✅ **Works WITH Redis caching (not instead of)**  
✅ **Room system for targeted broadcasts**  
✅ **Auto-reconnection and fallback support**  
✅ **JWT authentication for secure connections**  

### Flow Recap

```
1. User loads page → API call (fast with Redis cache)
2. User joins Socket room → Subscribes to updates
3. Another user comments → Backend emits Socket event
4. All users in room → Receive update instantly
5. Cache invalidated → Next API call gets fresh data
```

**Result**: Fast initial load (Redis) + Instant updates (Socket.io) = Perfect UX! 🚀

---

## 📚 Resources

- **Socket.io Docs**: https://socket.io/docs/v4/
- **Socket.io Client API**: https://socket.io/docs/v4/client-api/
- **Redis + Socket.io**: https://socket.io/docs/v4/redis-adapter/

---

**Need help?** Check the backend logs for detailed Socket.io connection and event information.
