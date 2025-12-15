// src/socket/handlers/comment.handler.js
const { emitToPost } = require('../socket.config');

/**
 * Emit new comment event
 */
function emitCommentNew(postId, comment) {
  const eventData = {
    postId,
    comment: {
      id: comment.id,
      content: comment.content,
      author: comment.author,
      created_at: comment.created_at,
      parent_id: comment.parent_id,
      like_count: 0,
      user_has_liked: false,
    },
  };
  console.log(`📡 [Socket.io] Emitting comment:new to post:${postId}`, {
    commentId: comment.id,
    author: comment.author?.name,
  });
  emitToPost(postId, 'comment:new', eventData);
}

/**
 * Emit comment updated event
 */
function emitCommentUpdated(postId, comment) {
  emitToPost(postId, 'comment:updated', {
    postId,
    comment: {
      id: comment.id,
      content: comment.content,
      updated_at: comment.updated_at,
    },
  });
}

/**
 * Emit comment deleted event
 */
function emitCommentDeleted(postId, commentId) {
  emitToPost(postId, 'comment:deleted', {
    postId,
    commentId,
  });
}

/**
 * Emit comment liked event
 */
function emitCommentLiked(postId, commentId, liked, likeCount) {
  emitToPost(postId, 'comment:liked', {
    postId,
    commentId,
    liked,
    likeCount,
  });
}

module.exports = {
  emitCommentNew,
  emitCommentUpdated,
  emitCommentDeleted,
  emitCommentLiked,
};
