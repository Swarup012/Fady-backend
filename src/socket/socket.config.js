// src/socket/socket.config.js
const { Server } = require('socket.io');
const socketMiddleware = require('./socket.middleware');

let io = null;

/**
 * Initialize Socket.io server
 */
function initializeSocket(httpServer) {
  console.log('🔌 Initializing Socket.io server...');

  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Connection settings
    pingTimeout: 60000, // 60 seconds
    pingInterval: 25000, // 25 seconds
    transports: ['websocket', 'polling'], // Prefer WebSocket, fallback to polling
  });

  // Apply authentication middleware
  io.use(socketMiddleware);

  // Connection event
  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    const userName = socket.user?.name || 'Anonymous';
    
    console.log(`✅ Socket connected: ${socket.id} | User: ${userName} (${userId || 'guest'})`);

    // User joins their personal room (for notifications)
    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`👤 User ${userName} joined personal room: user:${userId}`);
    }

    // Handle room joining
    socket.on('join:post', (postId) => {
      const room = `post:${postId}`;
      socket.join(room);
      const socketsInRoom = io.sockets.adapter.rooms.get(room);
      const clientCount = socketsInRoom ? socketsInRoom.size : 0;
      console.log(`📝 [Socket.io] User "${userName}" (${userId || 'guest'}) joined room "${room}" - Now ${clientCount} client(s) in room`);
      socket.emit('joined:post', { postId });
    });

    socket.on('leave:post', (postId) => {
      socket.leave(`post:${postId}`);
      console.log(`🚪 User ${userName} left post room: post:${postId}`);
    });

    socket.on('join:board', (boardSlug) => {
      socket.join(`board:${boardSlug}`);
      console.log(`📋 User ${userName} joined board room: board:${boardSlug}`);
      socket.emit('joined:board', { boardSlug });
    });

    socket.on('leave:board', (boardSlug) => {
      socket.leave(`board:${boardSlug}`);
      console.log(`🚪 User ${userName} left board room: board:${boardSlug}`);
    });

    // Disconnect event
    socket.on('disconnect', (reason) => {
      console.log(`❌ Socket disconnected: ${socket.id} | User: ${userName} | Reason: ${reason}`);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`⚠️  Socket error for ${userName}:`, error);
    });
  });

  console.log('✅ Socket.io server initialized');
  return io;
}

/**
 * Get Socket.io instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized! Call initializeSocket() first.');
  }
  return io;
}

/**
 * Emit event to specific post room
 */
function emitToPost(postId, event, data) {
  if (!io) {
    console.error('❌ Socket.io not initialized, cannot emit event');
    return;
  }
  const room = `post:${postId}`;
  const socketsInRoom = io.sockets.adapter.rooms.get(room);
  const clientCount = socketsInRoom ? socketsInRoom.size : 0;
  console.log(`📡 [Socket.io] Emitting "${event}" to room "${room}" (${clientCount} clients connected)`);
  io.to(room).emit(event, data);
}

/**
 * Emit event to specific board room
 */
function emitToBoard(boardSlug, event, data) {
  if (!io) return;
  io.to(`board:${boardSlug}`).emit(event, data);
  console.log(`📡 Emitted ${event} to board:${boardSlug}`);
}

/**
 * Emit event to specific user
 */
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
  console.log(`📡 Emitted ${event} to user:${userId}`);
}

/**
 * Close Socket.io server gracefully
 */
async function closeSocket() {
  if (io) {
    console.log('🔌 Closing Socket.io server...');
    await new Promise((resolve) => {
      io.close(() => {
        console.log('✅ Socket.io server closed');
        resolve();
      });
    });
    io = null;
  }
}

module.exports = {
  initializeSocket,
  getIO,
  emitToPost,
  emitToBoard,
  emitToUser,
  closeSocket,
};
