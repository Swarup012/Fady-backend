const clusterService = require('../services/cluster.service');
const ResponseUtil = require('../utils/response.util');

/**
 * ClusterController
 * =================
 * Handles HTTP layer for all clustering operations.
 *
 * Public (admin-authenticated) routes:
 *   GET  /api/clusters/boards/:boardId         → getBoardClusters
 *
 * Internal routes (x-internal-secret header):
 *   PATCH /api/clusters/assign-post            → assignPostClusterKey
 *   POST  /api/clusters/check-debounce         → checkDebounce
 *   GET   /api/clusters/sample-posts           → getSamplePosts
 *   POST  /api/clusters/upsert-label           → upsertClusterLabel
 */
class ClusterController {
  /**
   * GET /api/clusters/boards/:boardId
   * Returns clusters for a board with labels and post counts.
   * Used by the admin dashboard.
   */
  async getBoardClusters(req, res, next) {
    try {
      const { boardId } = req.params;

      if (!boardId) {
        return ResponseUtil.error(res, 'boardId is required', 400);
      }

      const clusters = await clusterService.getBoardClusters(boardId);

      return ResponseUtil.success(res, 'Clusters retrieved successfully', {
        clusters,
        count: clusters.length,
      });
    } catch (error) {
      console.error('❌ getBoardClusters controller error:', error);
      next(error);
    }
  }

  /**
   * PATCH /api/clusters/assign-post  (internal)
   * Persists a cluster_key to a post.
   * Called by the Next.js /api/clusters/assign endpoint after AI resolves.
   */
  async assignPostClusterKey(req, res, next) {
    try {
      const { post_id, board_id, cluster_key } = req.body;

      if (!post_id || !board_id || !cluster_key) {
        return ResponseUtil.error(res, 'post_id, board_id, and cluster_key are required', 400);
      }

      const result = await clusterService.assignPostClusterKey(post_id, board_id, cluster_key);

      return ResponseUtil.success(res, 'Post cluster key assigned', { post: result });
    } catch (error) {
      console.error('❌ assignPostClusterKey controller error:', error);
      next(error);
    }
  }

  /**
   * POST /api/clusters/check-debounce  (internal)
   * Returns 204 if a label refresh is already queued (debounce hit).
   * Returns 200 if the caller should proceed.
   */
  async checkDebounce(req, res, next) {
    try {
      const { board_id, cluster_key } = req.body;

      if (!board_id || !cluster_key) {
        return ResponseUtil.error(res, 'board_id and cluster_key are required', 400);
      }

      const isDebounced = await clusterService.checkDebounce(board_id, cluster_key);

      if (isDebounced) {
        // 204 = already queued, caller should skip
        return res.status(204).end();
      }

      return ResponseUtil.success(res, 'Proceed with label refresh');
    } catch (error) {
      console.error('❌ checkDebounce controller error:', error);
      next(error);
    }
  }

  /**
   * GET /api/clusters/sample-posts?board_id=&cluster_key=&limit=  (internal)
   * Returns sample posts for a cluster to feed AI label generation.
   */
  async getSamplePosts(req, res, next) {
    try {
      const { board_id, cluster_key, limit } = req.query;

      if (!board_id || !cluster_key) {
        return ResponseUtil.error(res, 'board_id and cluster_key are required', 400);
      }

      const posts = await clusterService.getSamplePosts(
        board_id,
        cluster_key,
        parseInt(limit, 10) || 5
      );

      return ResponseUtil.success(res, 'Sample posts retrieved', { posts });
    } catch (error) {
      console.error('❌ getSamplePosts controller error:', error);
      next(error);
    }
  }

  /**
   * POST /api/clusters/upsert-label  (internal)
   * Stores AI-generated label + summary in cluster_labels table.
   */
  async upsertClusterLabel(req, res, next) {
    try {
      const { board_id, cluster_key, label, summary, severity_level } = req.body;

      if (!board_id || !cluster_key || !label || !summary || !severity_level) {
        return ResponseUtil.error(res, 'board_id, cluster_key, label, summary, and severity_level are required', 400);
      }

      const result = await clusterService.upsertClusterLabel(board_id, cluster_key, label, summary, severity_level);

      return ResponseUtil.success(res, 'Cluster label upserted', { cluster_label: result });
    } catch (error) {
      console.error('❌ upsertClusterLabel controller error:', error);
      next(error);
    }
  }
}

module.exports = new ClusterController();
