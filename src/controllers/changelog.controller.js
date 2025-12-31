const changelogService = require("../services/changelog.service");
const ResponseUtil = require("../utils/response.util");

const changelogController = {
  /**
   * Get all changelogs (published only for public, all for org members)
   * GET /api/changelogs or /api/public/changelogs
   */
  async getAllChangelogs(req, res, next) {
    try {
      const { status, type, limit = 20, offset = 0 } = req.query;
      const organizationId = req.organization?.id;
      const userId = req.user?.id;

      if (!organizationId) {
        return ResponseUtil.error(
          res,
          "Organization context required",
          400
        );
      }

      const changelogs = await changelogService.getAllChangelogs({
        organizationId,
        userId,
        status,
        type,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      return ResponseUtil.success(res, "Changelogs retrieved successfully", {
        changelogs: changelogs.data,
        count: changelogs.count,
      });
    } catch (error) {
      console.error("Get all changelogs error:", error);
      next(error);
    }
  },

  /**
   * Get single changelog by slug
   * GET /api/changelogs/:slug or /api/public/changelogs/:slug
   */
  async getChangelogBySlug(req, res, next) {
    try {
      const { slug } = req.params;
      const organizationId = req.organization?.id;
      const userId = req.user?.id;

      const changelog = await changelogService.getChangelogBySlug(
        slug,
        organizationId,
        userId
      );

      // Increment view count
      await changelogService.incrementViewCount(changelog.id);

      return ResponseUtil.success(res, "Changelog retrieved successfully", {
        changelog,
      });
    } catch (error) {
      console.error("Get changelog error:", error);
      next(error);
    }
  },

  /**
   * Create new changelog
   * POST /api/changelogs
   */
  async createChangelog(req, res, next) {
    try {
      const {
        title,
        description,
        content,
        type = "new",
        status = "draft",
        labels = [],
        featured_image,
        linked_posts = [],
      } = req.body;

      const organizationId = req.organization?.id;
      const authorId = req.user.id;

      if (!organizationId) {
        return ResponseUtil.error(
          res,
          "Organization context required. Please ensure you're accessing via a valid subdomain.",
          400
        );
      }

      if (!title || !content) {
        return ResponseUtil.error(
          res,
          "Title and content are required",
          400
        );
      }

      const changelog = await changelogService.createChangelog({
        title,
        description,
        content,
        type,
        status,
        labels,
        featured_image,
        organization_id: organizationId,
        author_id: authorId,
        linked_posts,
      });

      return ResponseUtil.success(
        res,
        "Changelog created successfully",
        { changelog },
        201
      );
    } catch (error) {
      console.error("Create changelog error:", error);
      next(error);
    }
  },

  /**
   * Update changelog
   * PUT /api/changelogs/:id
   */
  async updateChangelog(req, res, next) {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        content,
        type,
        status,
        labels,
        featured_image,
        linked_posts,
      } = req.body;

      const organizationId = req.organization?.id;

      const changelog = await changelogService.updateChangelog(id, {
        title,
        description,
        content,
        type,
        status,
        labels,
        featured_image,
        organization_id: organizationId,
        linked_posts,
      });

      return ResponseUtil.success(res, "Changelog updated successfully", {
        changelog,
      });
    } catch (error) {
      console.error("Update changelog error:", error);
      next(error);
    }
  },

  /**
   * Delete changelog
   * DELETE /api/changelogs/:id
   */
  async deleteChangelog(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;

      await changelogService.deleteChangelog(id, organizationId);

      return ResponseUtil.success(res, "Changelog deleted successfully");
    } catch (error) {
      console.error("Delete changelog error:", error);
      next(error);
    }
  },

  /**
   * Publish changelog (changes status from draft to published)
   * POST /api/changelogs/:id/publish
   */
  async publishChangelog(req, res, next) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;

      const changelog = await changelogService.publishChangelog(
        id,
        organizationId
      );

      return ResponseUtil.success(res, "Changelog published successfully", {
        changelog,
      });
    } catch (error) {
      console.error("Publish changelog error:", error);
      next(error);
    }
  },

  /**
   * Get recent published changelogs (for navbar widget)
   * GET /api/changelogs/recent
   */
  async getRecentChangelogs(req, res, next) {
    try {
      const { limit = 5 } = req.query;
      const organizationId = req.organization?.id;

      const changelogs = await changelogService.getRecentPublished(
        organizationId,
        parseInt(limit)
      );

      return ResponseUtil.success(
        res,
        "Recent changelogs retrieved successfully",
        { changelogs }
      );
    } catch (error) {
      console.error("Get recent changelogs error:", error);
      next(error);
    }
  },
};

module.exports = changelogController;
