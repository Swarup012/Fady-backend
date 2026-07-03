const { supabaseAdmin } = require('../config/supabase.config');
const cache = require('./redis.service');
const axios = require('axios');

/**
 * ClusterService
 * ==============
 * Manages the full hybrid clustering lifecycle:
 *
 *  1. triggerClusterAssignment()   — called after post creation (fire-and-forget)
 *     → calls Next.js /api/clusters/assign (Genkit AI + rule-based fallback)
 *
 *  2. assignPostClusterKey()       — persists cluster_key to posts table
 *     → called by /api/clusters/assign-post (internal)
 *
 *  3. checkDebounce()              — Redis debounce for label refreshes
 *     → 5-minute window: prevents duplicate AI label generation
 *
 *  4. getSamplePosts()             — returns up to N posts from a cluster
 *     → used to feed the AI label flow with real content
 *
 *  5. upsertClusterLabel()         — saves AI label+summary to cluster_labels table
 *     → called after successful label generation
 *
 *  6. getExistingClusters()        — returns all cluster_key values for a board
 *     → used when assigning a new post to give AI context
 *
 *  7. getBoardClusters()           — full cluster list with labels + post counts
 *     → the main query for dashboard display
 *
 *  8. ruleBasedLabel()             — deterministic fallback label from cluster_key
 *     → "login_issues" → "Login Issues"
 */
class ClusterService {
  /**
   * Fire-and-forget: triggers cluster assignment for a newly created post.
   * Fetches existing cluster keys first so the AI has board-level context.
   */
  async triggerClusterAssignment(boardId, postId, title, description = '') {
    try {
      const existingClusters = await this.getExistingClusters(boardId);

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const internalSecret = process.env.INTERNAL_API_SECRET || '';

      // Non-blocking fire-and-forget
      axios.post(`${frontendUrl}/api/clusters/assign`, {
        post_id: postId,
        board_id: boardId,
        title,
        description,
        existing_clusters: existingClusters,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': internalSecret,
        }
      })
        .then(() => {
          console.log(`✅ Cluster assignment triggered for post ${postId}`);
        })
        .catch((err) => {
          console.error(`❌ Cluster assign fetch failed for post ${postId}:`, err.response?.data || err.message);
        });
    } catch (err) {
      console.error('❌ triggerClusterAssignment error:', err.message);
    }
  }

  /**
   * Persist cluster_key to a post (called from internal PATCH endpoint).
   * Also invalidates relevant caches.
   */
  async assignPostClusterKey(postId, boardId, clusterKey) {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .update({ cluster_key: clusterKey })
      .eq('id', postId)
      .eq('board_id', boardId)
      .select('id, cluster_key')
      .single();

    if (error) throw error;

    // Invalidate cluster cache for this board
    await cache.delete(`clusters:board:${boardId}`);
    console.log(`✅ cluster_key "${clusterKey}" saved to post ${postId}`);
    return data;
  }

  /**
   * Redis debounce check for label refresh.
   * Returns true if a refresh is already queued (caller should skip).
   * Returns false and sets the debounce key if not queued.
   * TTL: 5 minutes (300 seconds).
   */
  async checkDebounce(boardId, clusterKey) {
    const debounceKey = `cluster_label_debounce:${boardId}:${clusterKey}`;
    const exists = await cache.exists(debounceKey);
    if (exists) return true; // already queued

    await cache.set(debounceKey, 'pending', 300);
    return false; // caller should proceed
  }

  /**
   * Returns up to `limit` posts for a specific cluster on a board.
   * Used to feed the AI label generation flow.
   */
  async getSamplePosts(boardId, clusterKey, limit = 5) {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('title, description')
      .eq('board_id', boardId)
      .eq('cluster_key', clusterKey)
      .eq('is_archived', false)
      .order('upvotes', { ascending: false }) // highest-voted posts first = best signal
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Upsert AI-generated label and summary into cluster_labels table.
   * Uses ON CONFLICT to update if record already exists.
   */
  async upsertClusterLabel(boardId, clusterKey, label, summary, severityLevel) {
    const { data, error } = await supabaseAdmin
      .from('cluster_labels')
      .upsert(
        {
          board_id: boardId,
          cluster_key: clusterKey,
          ai_label: label,
          ai_summary: summary,
          severity_level: severityLevel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'board_id,cluster_key' }
      )
      .select()
      .single();

    if (error) throw error;

    // Invalidate cluster cache so the dashboard picks up the new label
    await cache.delete(`clusters:board:${boardId}`);
    console.log(`✅ AI label upserted for cluster "${clusterKey}" on board ${boardId}`);
    return data;
  }

  /**
   * Returns all distinct cluster_key values on a board.
   * Used when assigning a new post so the AI knows existing clusters.
   * Cached for 2 minutes.
   */
  async getExistingClusters(boardId) {
    const cacheKey = `clusters:board:${boardId}:keys`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('cluster_key')
      .eq('board_id', boardId)
      .not('cluster_key', 'is', null)
      .eq('is_archived', false);

    if (error) {
      console.error('❌ getExistingClusters error:', error);
      return [];
    }

    // Deduplicate
    const keys = [...new Set((data || []).map((p) => p.cluster_key))];
    await cache.set(cacheKey, keys, 120); // 2 min cache
    return keys;
  }

  /**
   * Full cluster list for a board with:
   *  - post_count
   *  - ai_label (or rule-based fallback)
   *  - ai_summary
   *  - is_ai_generated flag
   *
   * Cached for 60 seconds.
   */
  async getBoardClusters(boardId) {
    const cacheKey = `clusters:board:${boardId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // 1. Get all posts with cluster_key for this board
    const { data: posts, error: postsError } = await supabaseAdmin
      .from('posts')
      .select('cluster_key, upvotes')
      .eq('board_id', boardId)
      .not('cluster_key', 'is', null)
      .eq('is_archived', false);

    if (postsError) throw postsError;

    // 2. Aggregate post counts and total upvotes per cluster
    const clusterStats = {};
    for (const post of posts || []) {
      const key = post.cluster_key;
      if (!clusterStats[key]) {
        clusterStats[key] = { post_count: 0, total_upvotes: 0 };
      }
      clusterStats[key].post_count += 1;
      clusterStats[key].total_upvotes += (post.upvotes || 0);
    }

    if (Object.keys(clusterStats).length === 0) {
      return [];
    }

    // 3. Fetch AI labels for this board
    const { data: labels, error: labelsError } = await supabaseAdmin
      .from('cluster_labels')
      .select('cluster_key, ai_label, ai_summary, severity_level')
      .eq('board_id', boardId);

    if (labelsError) {
      console.warn('⚠️ Could not fetch cluster_labels, using fallback:', labelsError.message);
    }

    const labelMap = {};
    for (const l of labels || []) {
      labelMap[l.cluster_key] = l;
    }

    // 4. Calculate priority score and merge stats
    // Configurable weights for priority scoring:
    const WEIGHTS = {
      upvotes: 3,
      posts: 1,
    };
    
    const SEVERITY_POINTS = {
      critical: 100,
      high: 50,
      medium: 25,
      low: 0,
    };

    const clusters = Object.entries(clusterStats)
      .map(([key, stats]) => {
        const severity = labelMap[key]?.severity_level || 'low';
        const severityPoints = SEVERITY_POINTS[severity] || 0;
        
        const priority_score = severityPoints + (stats.total_upvotes * WEIGHTS.upvotes) + (stats.post_count * WEIGHTS.posts);
        
        return {
          cluster_key: key,
          label: labelMap[key]?.ai_label || this.ruleBasedLabel(key),
          summary: labelMap[key]?.ai_summary || null,
          severity_level: severity,
          post_count: stats.post_count,
          total_upvotes: stats.total_upvotes,
          priority_score: priority_score,
          is_ai_generated: !!labelMap[key]?.ai_label,
        };
      })
      .sort((a, b) => b.priority_score - a.priority_score);

    await cache.set(cacheKey, clusters, 60);
    return clusters;
  }

  /**
   * Deterministic fallback label from a cluster_key.
   * "login_issues"      → "Login Issues"
   * "slow_performance"  → "Slow Performance"
   */
  ruleBasedLabel(clusterKey) {
    return (clusterKey || 'uncategorized')
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Returns clusters across ALL boards for an organization.
   * Useful for an org-level overview.
   */
  async getOrganizationClusters(organizationId) {
    // Get all board IDs for this org
    const { data: boards, error: boardsError } = await supabaseAdmin
      .from('boards')
      .select('id, name, slug')
      .eq('organization_id', organizationId);

    if (boardsError) throw boardsError;

    const results = await Promise.all(
      (boards || []).map(async (board) => {
        const clusters = await this.getBoardClusters(board.id);
        return { board, clusters };
      })
    );

    return results.filter((r) => r.clusters.length > 0);
  }
}

module.exports = new ClusterService();
