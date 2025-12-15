// src/socket/socket.middleware.js
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase.config');

/**
 * Socket.io authentication middleware
 * Verifies JWT token and attaches user to socket
 */
async function socketAuthMiddleware(socket, next) {
  try {
    // Get token from handshake auth or query
    const token = 
      socket.handshake.auth?.token || 
      socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
      socket.handshake.query?.token;

    if (!token) {
      // Allow anonymous connections (for public features)
      console.log('⚠️  Anonymous socket connection allowed');
      socket.user = null;
      return next();
    }

    // Verify JWT token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.log('❌ Socket authentication failed:', error?.message);
      socket.user = null;
      // Still allow connection but mark as unauthenticated
      return next();
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from('users')
      .select('id, name, email, avatar_url, current_organization_id')
      .eq('id', user.id)
      .single();

    // Attach user to socket
    socket.user = {
      id: user.id,
      email: user.email,
      name: profile?.name || user.email?.split('@')[0],
      avatar_url: profile?.avatar_url,
      organization_id: profile?.current_organization_id,
    };

    console.log(`✅ Socket authenticated: ${socket.user.name} (${socket.user.id})`);
    next();
  } catch (error) {
    console.error('❌ Socket middleware error:', error);
    socket.user = null;
    // Allow connection anyway (graceful degradation)
    next();
  }
}

module.exports = socketAuthMiddleware;
