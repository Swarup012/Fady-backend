const { supabaseAdmin } = require('../config/supabase.config');
const cache = require('./redis.service');

/**
 * Dashboard Service
 * Pre-aggregates all dashboard stats server-side so the frontend
 * doesn't need to fetch all posts and compute in the browser.
 * 
 * Cached for 60 seconds in Redis. Cache is invalidated when posts are created/updated.
 */
class DashboardService {
  /**
   * Get all dashboard stats for an organization
   * Runs all Supabase queries in parallel, computes trends, caches result
   */
  async getDashboardStats(organizationId) {
    const cacheKey = `dashboard:stats:${organizationId}`;

    // Check cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [
      totalBoardsResult,
      totalPostsResult,
      aggregationsResult,
      statusDistributionResult,
      recentPostsResult,
      mostUpvotedResult,
      trendingResult,
      topBoardsResult,
      topContributorsResult,
    ] = await Promise.all([
      // 1. Total boards
      supabaseAdmin
        .from('boards')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId),

      // 2. Total posts (non-archived)
      supabaseAdmin
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('is_archived', false),

      // 3. Aggregated stats in one query
      this._getAggregations(organizationId),

      // 4. Status distribution
      this._getStatusDistribution(organizationId),

      // 5. Recent posts (6)
      supabaseAdmin
        .from('posts')
        .select('id, title, status, upvotes, comment_count, created_at, author:users!author_id(id, name, avatar_url), board:boards!board_id(id, name, slug)')
        .eq('organization_id', organizationId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(6),

      // 6. Most upvoted (5)
      supabaseAdmin
        .from('posts')
        .select('id, title, status, upvotes, comment_count, created_at, author:users!author_id(id, name, avatar_url), board:boards!board_id(id, name, slug)')
        .eq('organization_id', organizationId)
        .eq('is_archived', false)
        .order('upvotes', { ascending: false })
        .limit(5),

      // 7. Posts from last 30 days for trending + feedback trend calculation
      supabaseAdmin
        .from('posts')
        .select('id, title, status, upvotes, comment_count, created_at, author:users!author_id(id, name, avatar_url), board:boards!board_id(id, name, slug)')
        .eq('organization_id', organizationId)
        .eq('is_archived', false)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false }),

      // 8. Top boards by post count
      this._getTopBoards(organizationId),

      // 9. Top contributors
      this._getTopContributors(organizationId),
    ]);

    // Extract data and handle errors
    const totalBoards = totalBoardsResult.count || 0;
    const totalPosts = totalPostsResult.count || 0;
    const aggregations = aggregationsResult || {};
    const statusDistribution = statusDistributionResult || {};
    const recentPosts = recentPostsResult.data || [];
    const mostUpvoted = mostUpvotedResult.data || [];
    const monthPosts = trendingResult.data || [];
    const topBoards = topBoardsResult || [];
    const topContributors = topContributorsResult || [];

    // Filter to last 7 days for trending
    const weekPosts = monthPosts.filter(p => p.created_at >= sevenDaysAgo);

    // Compute trending (score = upvotes*2 + comments*3, top 5)
    const trending = weekPosts
      .map(p => ({
        ...p,
        score: (p.upvotes || 0) * 2 + (p.comment_count || 0) * 3,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Compute 7-day sparkline trends
    const pendingTrend = this._generateTrend(weekPosts, p => p.status === 'under-review');
    const newThisWeekTrend = this._generateTrend(weekPosts, () => true);
    const trendingTrend = this._generateTrend(weekPosts, p => {
      const score = (p.upvotes || 0) * 2 + (p.comment_count || 0) * 3;
      return score > 5;
    });

    // Active users trend (unique authors per day, last 7 days)
    const activeUsersTrend = this._generateUniqueTrend(weekPosts);

    // 30-day feedback volume trend
    const feedbackTrend = this._generateFeedbackTrend(monthPosts);

    const stats = {
      totalBoards,
      totalPosts,
      totalVotes: aggregations.totalVotes || 0,
      totalComments: aggregations.totalComments || 0,
      pendingPosts: statusDistribution['under-review'] || 0,
      newThisWeek: aggregations.newThisWeek || 0,
      activeUsers: aggregations.activeUsers || 0,
      statusDistribution,
      pendingTrend,
      newThisWeekTrend,
      activeUsersTrend,
      trendingTrend,
      recentPosts,
      mostUpvoted,
      trending,
      topBoards,
      topContributors,
      feedbackTrend,
      cached: false,
    };

    // Cache for 60 seconds
    await cache.set(cacheKey, stats, 60);

    return stats;
  }

  /**
   * Get aggregated stats in a single query (instead of looping all posts in browser)
   */
  async _getAggregations(organizationId) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabaseAdmin
        .from('posts')
        .select('upvotes, comment_count, author_id, created_at')
        .eq('organization_id', organizationId)
        .eq('is_archived', false);

      if (error) {
        console.error('Dashboard aggregations error:', error);
        return { totalVotes: 0, totalComments: 0, newThisWeek: 0, activeUsers: 0 };
      }

      let totalVotes = 0;
      let totalComments = 0;
      let newThisWeek = 0;
      const thirtyDayAuthors = new Set();

      for (const post of data) {
        totalVotes += post.upvotes || 0;
        totalComments += post.comment_count || 0;
        if (post.created_at >= sevenDaysAgo) newThisWeek++;
        if (post.created_at >= thirtyDaysAgo && post.author_id) {
          thirtyDayAuthors.add(post.author_id);
        }
      }

      return {
        totalVotes,
        totalComments,
        newThisWeek,
        activeUsers: thirtyDayAuthors.size,
      };
    } catch (error) {
      console.error('Dashboard aggregations error:', error);
      return { totalVotes: 0, totalComments: 0, newThisWeek: 0, activeUsers: 0 };
    }
  }

  /**
   * Get status distribution counts
   */
  async _getStatusDistribution(organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('posts')
        .select('status')
        .eq('organization_id', organizationId)
        .eq('is_archived', false);

      if (error) return {};

      const distribution = {};
      for (const post of data) {
        distribution[post.status] = (distribution[post.status] || 0) + 1;
      }
      return distribution;
    } catch (error) {
      console.error('Dashboard status distribution error:', error);
      return {};
    }
  }

  /**
   * Get top 5 boards by post count
   */
  async _getTopBoards(organizationId) {
    try {
      const { data: boards, error: boardsError } = await supabaseAdmin
        .from('boards')
        .select('id, name, slug')
        .eq('organization_id', organizationId);

      if (boardsError || !boards) return [];

      const { data: posts, error: postsError } = await supabaseAdmin
        .from('posts')
        .select('board_id')
        .eq('organization_id', organizationId)
        .eq('is_archived', false);

      if (postsError) return [];

      // Count posts per board
      const boardCounts = {};
      for (const post of posts) {
        boardCounts[post.board_id] = (boardCounts[post.board_id] || 0) + 1;
      }

      return boards
        .map(b => ({ ...b, postCount: boardCounts[b.id] || 0 }))
        .sort((a, b) => b.postCount - a.postCount)
        .slice(0, 5);
    } catch (error) {
      console.error('Dashboard top boards error:', error);
      return [];
    }
  }

  /**
   * Get top 5 contributors by post count
   */
  async _getTopContributors(organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('posts')
        .select('author_id, upvotes, author:users!author_id(id, name, avatar_url)')
        .eq('organization_id', organizationId)
        .eq('is_archived', false);

      if (error || !data) return [];

      const contributors = {};
      for (const post of data) {
        if (!post.author_id || !post.author) continue;
        if (!contributors[post.author_id]) {
          contributors[post.author_id] = { ...post.author, posts: 0, votes: 0 };
        }
        contributors[post.author_id].posts += 1;
        contributors[post.author_id].votes += post.upvotes || 0;
      }

      return Object.values(contributors)
        .sort((a, b) => b.posts - a.posts)
        .slice(0, 5);
    } catch (error) {
      console.error('Dashboard top contributors error:', error);
      return [];
    }
  }

  /**
   * Generate 7-day sparkline trend data (counts per day)
   */
  _generateTrend(posts, filterFn) {
    const now = new Date();
    return Array.from({ length: 7 }).map((_, i) => {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - (6 - i));
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const count = posts.filter(p => {
        if (!filterFn(p)) return false;
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && createdAt < dayEnd;
      }).length;

      return {
        date: dayStart.toISOString().split('T')[0],
        value: count,
      };
    });
  }

  /**
   * Generate 7-day trend of unique active users per day
   */
  _generateUniqueTrend(posts) {
    const now = new Date();
    return Array.from({ length: 7 }).map((_, i) => {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - (6 - i));
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const uniqueAuthors = new Set(
        posts
          .filter(p => {
            const createdAt = new Date(p.created_at);
            return createdAt >= dayStart && createdAt < dayEnd && p.author_id;
          })
          .map(p => p.author_id)
      );

      return {
        date: dayStart.toISOString().split('T')[0],
        value: uniqueAuthors.size,
      };
    });
  }

  /**
   * Generate 30-day feedback volume trend
   * Returns [{ day: "Mar 2", count: 5 }, ...] for the chart
   */
  _generateFeedbackTrend(posts) {
    const now = new Date();
    return Array.from({ length: 30 }).map((_, i) => {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - (29 - i));
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const count = posts.filter(p => {
        const createdAt = new Date(p.created_at);
        return createdAt >= dayStart && createdAt < dayEnd;
      }).length;

      return {
        day: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count,
      };
    });
  }

  /**
   * Invalidate dashboard cache for an organization
   * Call this when posts are created, updated, or deleted
   */
  async invalidateCache(organizationId) {
    await cache.delete(`dashboard:stats:${organizationId}`);
  }
}

module.exports = new DashboardService();
