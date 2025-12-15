// src/socket/handlers/post.handler.js
const { emitToPost, emitToBoard } = require('../socket.config');

/**
 * Emit post upvote event
 */
function emitPostUpvoted(postId, upvoted, upvoteCount, boardSlug = null) {
  // Emit to post viewers (people on post detail page)
  emitToPost(postId, 'post:upvoted', {
    postId,
    upvoted,
    upvoteCount,
  });
  
  // Also emit to board viewers (people on board list page)
  if (boardSlug) {
    emitToBoard(boardSlug, 'post:upvoted', {
      postId,
      boardSlug,
      upvoteCount,
    });
  }
}

/**
 * Emit post created event (to board viewers)
 */
function emitPostCreated(boardSlug, post) {
  emitToBoard(boardSlug, 'post:created', {
    boardSlug,
    post: {
      id: post.id,
      title: post.title,
      content: post.content,
      status: post.status,
      author: post.author,
      upvotes: post.upvotes || 0,
      comment_count: 0,
      created_at: post.created_at,
    },
  });
}

/**
 * Emit post updated event
 */
function emitPostUpdated(postId, boardSlug, updates) {
  // Emit to post viewers
  emitToPost(postId, 'post:updated', {
    postId,
    updates,
  });

  // Also emit to board viewers if status changed
  if (updates.status) {
    emitToBoard(boardSlug, 'post:status_changed', {
      postId,
      boardSlug,
      newStatus: updates.status,
    });
  }
}

/**
 * Emit post deleted event
 */
function emitPostDeleted(postId, boardSlug) {
  emitToPost(postId, 'post:deleted', { postId });
  emitToBoard(boardSlug, 'post:deleted', { postId, boardSlug });
}

/**
 * Emit post comment count updated
 */
function emitPostCommentCount(postId, commentCount, boardSlug = null) {
  // Emit to post viewers (people on post detail page)
  emitToPost(postId, 'post:comment_count', {
    postId,
    commentCount,
  });
  
  // Also emit to board viewers (people on board list page)
  if (boardSlug) {
    emitToBoard(boardSlug, 'post:comment_count', {
      postId,
      boardSlug,
      commentCount,
    });
  }
}

module.exports = {
  emitPostUpvoted,
  emitPostCreated,
  emitPostUpdated,
  emitPostDeleted,
  emitPostCommentCount,
};
