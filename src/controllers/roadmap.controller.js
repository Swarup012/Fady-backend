// src/controllers/roadmap.controller.js
const roadmapService = require('../services/roadmap.service.js');
const  responseUtil  = require('../utils/response.util.js');

const roadmapController = {
  // GET /api/roadmap/all (Admin/Owner - All boards)
  getAllRoadmapItems: async (req, res) => {
    try {
      const { status, category, isPublic, boardSlug } = req.query;
      const organizationId = req.user?.current_organization_id;

      if (!organizationId) {
        return responseUtil.error(res, 'Organization not found', 400);
      }

      const filters = {};
      if (status) filters.status = status.split(',');
      if (category) filters.category = category;
      if (isPublic !== undefined) filters.isPublic = isPublic === 'true';
      if (boardSlug) filters.boardSlug = boardSlug;

      const result = await roadmapService.getAllRoadmapItems(organizationId, filters);
      return responseUtil.success(res, 'All roadmap items retrieved successfully', result);
    } catch (error) {
      console.error('Error fetching all roadmap items:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/boards/:boardSlug/roadmap (Public + Private)
  getRoadmapItems: async (req, res) => {
    try {
      const { boardSlug } = req.params;
      const { status, category, isPublic } = req.query;

      const filters = {};
      if (status) filters.status = status.split(',');
      if (category) filters.category = category;
      if (isPublic !== undefined) filters.isPublic = isPublic === 'true';

      const result = await roadmapService.getRoadmapItems(boardSlug, filters);
      return responseUtil.success(res, 'Roadmap items retrieved successfully', result);
    } catch (error) {
      console.error('Error fetching roadmap items:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/public/boards/:boardSlug/roadmap (Public only)
  getPublicRoadmapItems: async (req, res) => {
    try {
      const { boardSlug } = req.params;
      const { status, category } = req.query;

      const filters = { isPublic: true };
      if (status) filters.status = status.split(',');
      if (category) filters.category = category;

      const result = await roadmapService.getRoadmapItems(boardSlug, filters);
      return responseUtil.success(res, 'Public roadmap items retrieved successfully', result);
    } catch (error) {
      console.error('Error fetching public roadmap items:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/roadmap/:itemId
  getRoadmapItemById: async (req, res) => {
    try {
      const { itemId } = req.params;
      const item = await roadmapService.getRoadmapItemById(itemId);
      
      if (!item) {
        return responseUtil.error(res, 'Roadmap item not found', 404);
      }

      return responseUtil.success(res, 'Roadmap item retrieved successfully', { item });
    } catch (error) {
      console.error('Error fetching roadmap item:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/public/roadmap/:itemId (Public only)
  getPublicRoadmapItemById: async (req, res) => {
    try {
      const { itemId } = req.params;
      const item = await roadmapService.getRoadmapItemById(itemId);
      
      if (!item) {
        return responseUtil.error(res, 'Roadmap item not found', 404);
      }

      if (!item.is_public) {
        return responseUtil.error(res, 'Roadmap item is not public', 403);
      }

      return responseUtil.success(res, 'Roadmap item retrieved successfully', { item });
    } catch (error) {
      console.error('Error fetching roadmap item:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // POST /api/boards/:boardSlug/roadmap
  createRoadmapItem: async (req, res) => {
    try {
      const { boardSlug } = req.params;
      const userId = req.user.id;
      const itemData = req.body;

      const item = await roadmapService.createRoadmapItem(boardSlug, itemData, userId);
      return responseUtil.success(res, 'Roadmap item created successfully', { item }, 201);
    } catch (error) {
      console.error('Error creating roadmap item:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // PUT /api/roadmap/:itemId
  updateRoadmapItem: async (req, res) => {
    try {
      const { itemId } = req.params;
      const updates = req.body;

      const item = await roadmapService.updateRoadmapItem(itemId, updates);
      return responseUtil.success(res, 'Roadmap item updated successfully', { item });
    } catch (error) {
      console.error('Error updating roadmap item:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // DELETE /api/roadmap/:itemId
  deleteRoadmapItem: async (req, res) => {
    try {
      const { itemId } = req.params;
      await roadmapService.deleteRoadmapItem(itemId);
      return responseUtil.success(res, 'Roadmap item deleted successfully', null);
    } catch (error) {
      console.error('Error deleting roadmap item:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // POST /api/roadmap/:itemId/vote (Toggle vote - like your upvote system)
  voteRoadmapItem: async (req, res) => {
    try {
      const { itemId } = req.params;
      const userId = req.user.id;

      const result = await roadmapService.voteRoadmapItem(itemId, userId);
      const message = result.voted ? 'Vote added successfully' : 'Vote removed successfully';
      return responseUtil.success(res, message, result);
    } catch (error) {
      console.error('Error voting roadmap item:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/roadmap/:itemId/voted
  checkUserVote: async (req, res) => {
    try {
      const { itemId } = req.params;
      const userId = req.user.id;

      const result = await roadmapService.hasUserVoted(itemId, userId);
      return responseUtil.success(res, 'Vote status retrieved successfully', result);
    } catch (error) {
      console.error('Error checking vote:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/roadmap/:itemId/comments
  getComments: async (req, res) => {
    try {
      const { itemId } = req.params;
      const result = await roadmapService.getComments(itemId);
      return responseUtil.success(res, 'Comments retrieved successfully', result);
    } catch (error) {
      console.error('Error fetching comments:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // POST /api/roadmap/:itemId/comments
  addComment: async (req, res) => {
    try {
      const { itemId } = req.params;
      const { content, parentId } = req.body;
      const userId = req.user.id;

      const comment = await roadmapService.addComment(itemId, content, userId, parentId);
      return responseUtil.success(res, 'Comment added successfully', { comment }, 201);
    } catch (error) {
      console.error('Error adding comment:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // PUT /api/roadmap/comments/:commentId
  updateComment: async (req, res) => {
    try {
      const { commentId } = req.params;
      const { content } = req.body;

      const comment = await roadmapService.updateComment(commentId, content);
      return responseUtil.success(res, 'Comment updated successfully', { comment });
    } catch (error) {
      console.error('Error updating comment:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // DELETE /api/roadmap/:itemId/comments/:commentId
  deleteComment: async (req, res) => {
    try {
      const { commentId } = req.params;
      await roadmapService.deleteComment(commentId);
      return responseUtil.success(res, 'Comment deleted successfully', null);
    } catch (error) {
      console.error('Error deleting comment:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // POST /api/roadmap/:itemId/updates
  addUpdate: async (req, res) => {
    try {
      const { itemId } = req.params;
      const userId = req.user.id;
      const updateData = req.body;

      const update = await roadmapService.addUpdate(itemId, updateData, userId);
      return responseUtil.success(res, 'Update added successfully', { update }, 201);
    } catch (error) {
      console.error('Error adding update:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // POST /api/roadmap/:itemId/link-feedback
  linkFeedback: async (req, res) => {
    try {
      const { itemId } = req.params;
      const { feedbackId } = req.body;

      await roadmapService.linkFeedback(itemId, feedbackId);
      return responseUtil.success(res, 'Feedback linked successfully', null, 201);
    } catch (error) {
      if (error.message === 'Feedback already linked') {
        return responseUtil.error(res, 'Feedback already linked to this roadmap item', 400);
      }
      console.error('Error linking feedback:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // DELETE /api/roadmap/:itemId/link-feedback/:feedbackId
  unlinkFeedback: async (req, res) => {
    try {
      const { itemId, feedbackId } = req.params;

      await roadmapService.unlinkFeedback(itemId, feedbackId);
      return responseUtil.success(res, 'Feedback unlinked successfully', null);
    } catch (error) {
      console.error('Error unlinking feedback:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // PUT /api/boards/:boardSlug/roadmap/reorder
  reorderItems: async (req, res) => {
    try {
      const { itemIds } = req.body;

      await roadmapService.reorderItems(itemIds);
      return responseUtil.success(res, 'Items reordered successfully', null);
    } catch (error) {
      console.error('Error reordering items:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  // GET /api/boards/:boardSlug/roadmap/stats
  getRoadmapStats: async (req, res) => {
    try {
      const { boardSlug } = req.params;

      const stats = await roadmapService.getRoadmapStats(boardSlug);
      return responseUtil.success(res, 'Roadmap statistics retrieved successfully', stats);
    } catch (error) {
      console.error('Error fetching roadmap stats:', error);
      return responseUtil.error(res, error.message, 500);
    }
  }
};

module.exports = roadmapController;
