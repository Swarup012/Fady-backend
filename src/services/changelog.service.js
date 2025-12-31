const { supabaseAdmin } = require("../config/supabase.config");
const cache = require("./redis.service");

const changelogService = {
  /**
   * Get all changelogs with filtering
   * 🔴 CACHED: TTL 5 minutes (300 seconds)
   */
  async getAllChangelogs({ organizationId, userId, status, type, limit, offset }) {
    try {
      // 🔴 CACHE KEY: changelogs:org:{orgId}:{status}:{type}:{limit}:{offset}:{userId}
      const statusKey = status || "all";
      const typeKey = type || "all";
      const limitKey = limit || "all";
      const offsetKey = offset || 0;
      const userKey = userId || "public";
      const cacheKey = `changelogs:org:${organizationId}:${statusKey}:${typeKey}:${limitKey}:${offsetKey}:${userKey}`;
      
      // Try to get from cache first
      const cachedData = await cache.get(cacheKey);
      if (cachedData) {
        console.log(`🔴 Changelogs cache HIT for org: ${organizationId}`);
        return cachedData;
      }

      console.log(`❌ Changelogs cache MISS for org: ${organizationId} - fetching from database`);

      let query = supabaseAdmin
        .from("changelogs")
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url),
          changelog_links(
            id,
            post_id,
            post:posts(id, title)
          )
        `,
          { count: "exact" }
        )
        .eq("organization_id", organizationId)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      // If no user (public access), only show published
      if (!userId) {
        query = query.eq("status", "published");
      } else if (status) {
        // Authenticated users can filter by status
        query = query.eq("status", status);
      }

      if (type) {
        query = query.eq("type", type);
      }

      if (limit) {
        query = query.range(offset, offset + limit - 1);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      const result = { data, count };
      
      // 🔴 Cache the result for 5 minutes (300 seconds)
      await cache.set(cacheKey, result, 300);
      console.log(`🔴 Changelogs cached for org: ${organizationId}`);

      return result;
    } catch (error) {
      console.error("Get all changelogs service error:", error);
      throw error;
    }
  },

  /**
   * Get single changelog by slug
   * 🔴 CACHED: TTL 10 minutes (600 seconds)
   */
  async getChangelogBySlug(slug, organizationId, userId) {
    try {
      // 🔴 CACHE KEY: changelog:org:{orgId}:slug:{slug}
      const cacheKey = `changelog:org:${organizationId}:slug:${slug}`;
      
      // Try to get from cache first
      const cachedChangelog = await cache.get(cacheKey);
      if (cachedChangelog) {
        console.log(`🔴 Changelog cache HIT for slug: ${slug}`);
        
        // If draft and no user, deny access
        if (cachedChangelog.status === "draft" && !userId) {
          throw new Error("Changelog not found or access denied");
        }
        
        return cachedChangelog;
      }

      console.log(`❌ Changelog cache MISS for slug: ${slug} - fetching from database`);

      let query = supabaseAdmin
        .from("changelogs")
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url),
          changelog_links(
            id,
            post_id,
            post:posts(id, title)
          )
        `
        )
        .eq("slug", slug)
        .eq("organization_id", organizationId)
        .single();

      const { data, error } = await query;

      if (error) throw error;

      // If draft and no user, deny access
      if (data.status === "draft" && !userId) {
        throw new Error("Changelog not found or access denied");
      }

      // 🔴 Cache the result for 10 minutes (600 seconds)
      await cache.set(cacheKey, data, 600);
      console.log(`🔴 Changelog cached for slug: ${slug}`);

      return data;
    } catch (error) {
      console.error("Get changelog by slug error:", error);
      throw error;
    }
  },

  /**
   * Create changelog
   */
  async createChangelog(changelogData) {
    try {
      // Generate slug from title
      const slug = changelogData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // Extract linked_posts separately (it's not a column in changelogs table)
      const { linked_posts, ...changelogFields } = changelogData;

      const { data, error } = await supabaseAdmin
        .from("changelogs")
        .insert([
          {
            ...changelogFields,
            slug,
            published_at:
              changelogData.status === "published" ? new Date().toISOString() : null,
          },
        ])
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url)
        `
        )
        .single();

      if (error) throw error;

      // Create linked posts if provided
      if (linked_posts && linked_posts.length > 0) {
        await this.linkPosts(data.id, linked_posts);
      }

      // 🔴 Invalidate all changelog caches for this organization
      await cache.deletePattern(`changelogs:org:${changelogData.organization_id}:*`);
      console.log(`🗑️  Invalidated changelog cache for org: ${changelogData.organization_id}`);

      return data;
    } catch (error) {
      console.error("Create changelog error:", error);
      throw error;
    }
  },

  /**
   * Update changelog
   */
  async updateChangelog(id, updateData) {
    try {
      // Extract linked_posts separately (it's not a column in changelogs table)
      const { linked_posts, ...changelogFields } = updateData;

      // Update slug if title changed
      if (changelogFields.title) {
        changelogFields.slug = changelogFields.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
      }

      // Set published_at if status changed to published
      if (changelogFields.status === "published") {
        const { data: existing } = await supabaseAdmin
          .from("changelogs")
          .select("published_at")
          .eq("id", id)
          .single();

        if (!existing.published_at) {
          changelogFields.published_at = new Date().toISOString();
        }
      }

      const { data, error } = await supabaseAdmin
        .from("changelogs")
        .update(changelogFields)
        .eq("id", id)
        .eq("organization_id", changelogFields.organization_id)
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url)
        `
        )
        .single();

      if (error) throw error;

      // Update linked posts if provided
      if (linked_posts !== undefined) {
        // Remove old links
        await supabaseAdmin
          .from("changelog_links")
          .delete()
          .eq("changelog_id", id);

        // Add new links
        if (linked_posts.length > 0) {
          await this.linkPosts(id, linked_posts);
        }
      }

      // 🔴 Invalidate all changelog caches for this organization
      await cache.deletePattern(`changelogs:org:${changelogFields.organization_id}:*`);
      // Also invalidate the specific changelog cache by slug
      if (data.slug) {
        await cache.delete(`changelog:org:${changelogFields.organization_id}:slug:${data.slug}`);
      }
      console.log(`🗑️  Invalidated changelog cache for org: ${changelogFields.organization_id}`);

      return data;
    } catch (error) {
      console.error("Update changelog error:", error);
      throw error;
    }
  },

  /**
   * Delete changelog
   */
  async deleteChangelog(id, organizationId) {
    try {
      // Get the changelog slug before deleting for cache invalidation
      const { data: changelog } = await supabaseAdmin
        .from("changelogs")
        .select("slug")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .single();

      const { error } = await supabaseAdmin
        .from("changelogs")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (error) throw error;

      // 🔴 Invalidate all changelog caches for this organization
      await cache.deletePattern(`changelogs:org:${organizationId}:*`);
      // Also invalidate the specific changelog cache by slug
      if (changelog?.slug) {
        await cache.delete(`changelog:org:${organizationId}:slug:${changelog.slug}`);
      }
      console.log(`🗑️  Invalidated changelog cache for org: ${organizationId}`);

      return true;
    } catch (error) {
      console.error("Delete changelog error:", error);
      throw error;
    }
  },

  /**
   * Publish changelog
   */
  async publishChangelog(id, organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from("changelogs")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select(
          `
          *,
          author:users!author_id(id, name, email, avatar_url)
        `
        )
        .single();

      if (error) throw error;

      // 🔴 Invalidate all changelog caches for this organization
      await cache.deletePattern(`changelogs:org:${organizationId}:*`);
      // Also invalidate the specific changelog cache by slug
      if (data.slug) {
        await cache.delete(`changelog:org:${organizationId}:slug:${data.slug}`);
      }
      console.log(`🗑️  Invalidated changelog cache for org: ${organizationId}`);

      return data;
    } catch (error) {
      console.error("Publish changelog error:", error);
      throw error;
    }
  },

  /**
   * Get recent published changelogs
   * 🔴 CACHED: TTL 10 minutes (600 seconds)
   */
  async getRecentPublished(organizationId, limit = 5) {
    try {
      // 🔴 CACHE KEY: changelogs:org:{orgId}:recent:{limit}
      const cacheKey = `changelogs:org:${organizationId}:recent:${limit}`;
      
      // Try to get from cache first
      const cachedData = await cache.get(cacheKey);
      if (cachedData) {
        console.log(`🔴 Recent changelogs cache HIT for org: ${organizationId}`);
        return cachedData;
      }

      console.log(`❌ Recent changelogs cache MISS for org: ${organizationId} - fetching from database`);

      const { data, error } = await supabaseAdmin
        .from("changelogs")
        .select(
          `
          id,
          title,
          description,
          type,
          slug,
          published_at,
          view_count
        `
        )
        .eq("organization_id", organizationId)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      // 🔴 Cache the result for 10 minutes (600 seconds)
      await cache.set(cacheKey, data, 600);
      console.log(`🔴 Recent changelogs cached for org: ${organizationId}`);

      return data;
    } catch (error) {
      console.error("Get recent published changelogs error:", error);
      throw error;
    }
  },

  /**
   * Link posts to changelog
   */
  async linkPosts(changelogId, postIds) {
    try {
      const links = postIds.map((postId) => ({
        changelog_id: changelogId,
        post_id: postId,
      }));

      const { error } = await supabaseAdmin
        .from("changelog_links")
        .insert(links);

      if (error) throw error;

      return true;
    } catch (error) {
      console.error("Link posts error:", error);
      throw error;
    }
  },

  /**
   * Increment view count
   */
  async incrementViewCount(changelogId) {
    try {
      const { error } = await supabaseAdmin.rpc("increment_changelog_views", {
        changelog_id: changelogId,
      });

      // If RPC doesn't exist, use regular update
      if (error) {
        await supabaseAdmin
          .from("changelogs")
          .update({
            view_count: supabaseAdmin.raw("view_count + 1"),
          })
          .eq("id", changelogId);
      }

      return true;
    } catch (error) {
      console.error("Increment view count error:", error);
      // Don't throw error for view count failures
      return false;
    }
  },
};

module.exports = changelogService;
