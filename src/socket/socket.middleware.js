// src/socket/socket.middleware.js
const jwt = require('jsonwebtoken');
const { supabase, supabaseAdmin } = require('../config/supabase.config');

/**
 * Socket.io authentication middleware.
 *
 * Priority order for auth:
 *  1. socket.handshake.auth.ticket  — short-lived WS ticket (preferred, cookie-based auth flow)
 *  2. socket.handshake.auth.token   — legacy raw JWT (backward compat, deprecated)
 *  3. No credential                 — allow as anonymous (public features)
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const { ticket, token: legacyToken } = socket.handshake.auth || {};

    // ── Path 1: WS Ticket (issued by GET /api/auth/ws-ticket) ────────────────
    if (ticket) {
      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET not configured — cannot validate WS ticket');
        socket.user = null;
        return next();
      }

      let payload;
      try {
        payload = jwt.verify(ticket, process.env.JWT_SECRET);
      } catch (err) {
        console.warn('⚠️ Invalid or expired WS ticket:', err.message);
        socket.user = null;
        return next(); // Degrade gracefully — don't block the connection
      }

      // Ensure this token was issued specifically as a WS ticket
      if (payload.purpose !== 'ws-ticket') {
        console.warn('⚠️ WS ticket has wrong purpose:', payload.purpose);
        socket.user = null;
        return next();
      }

      // Fetch the full user profile to attach to the socket
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('id, name, email, avatar_url, current_organization_id')
        .eq('id', payload.userId)
        .single();

      socket.user = profile
        ? {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            avatar_url: profile.avatar_url,
            organization_id: profile.current_organization_id,
          }
        : null;

      if (socket.user) {
        console.log(`✅ Socket authenticated via WS ticket: ${socket.user.name} (${socket.user.id})`);
      }

      return next();
    }

    // ── Path 2: Legacy raw JWT (backward compat) ──────────────────────────────
    const rawToken =
      legacyToken ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
      socket.handshake.query?.token;

    if (!rawToken) {
      // Anonymous connection — allow for public features
      console.log('⚠️  Anonymous socket connection allowed');
      socket.user = null;
      return next();
    }

    // Verify as Supabase token first
    const { data: { user }, error } = await supabase.auth.getUser(rawToken);

    if (error || !user) {
      // Try as custom JWT (Google OAuth path)
      try {
        const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
        const { data: profile } = await supabaseAdmin
          .from('users')
          .select('id, name, email, avatar_url, current_organization_id')
          .eq('id', decoded.userId)
          .single();

        socket.user = profile
          ? {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              avatar_url: profile.avatar_url,
              organization_id: profile.current_organization_id,
            }
          : null;

        if (socket.user) {
          console.log(`✅ Socket authenticated via custom JWT: ${socket.user.name}`);
        }
        return next();
      } catch {
        console.log('❌ Socket authentication failed — falling back to anonymous');
        socket.user = null;
        return next();
      }
    }

    // Supabase token verified
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, name, email, avatar_url, current_organization_id')
      .eq('id', user.id)
      .single();

    socket.user = {
      id: user.id,
      email: user.email,
      name: profile?.name || user.email?.split('@')[0],
      avatar_url: profile?.avatar_url,
      organization_id: profile?.current_organization_id,
    };

    console.log(`✅ Socket authenticated via Supabase token: ${socket.user.name} (${socket.user.id})`);
    next();
  } catch (error) {
    console.error('❌ Socket middleware error:', error);
    socket.user = null;
    next(); // Graceful degradation — never block the WS connection
  }
}

module.exports = socketAuthMiddleware;
