const express = require("express");
const router = express.Router();
const boardController = require("../controllers/board.controller");
const postController = require("../controllers/post.controller");
const changelogController = require("../controllers/changelog.controller");
const { optionalAuthenticate, authenticate } = require("../middleware/auth.middleware");
const { trackVote, trackComment } = require("../middleware/tracking.middleware");
const { body } = require("express-validator");

// Validation for comments
const commentValidation = [
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Comment content is required")
    .isLength({ max: 2000 })
    .withMessage("Comment must be less than 2000 characters"),
];

// ✅ OPTIONAL AUTHENTICATION - Public routes that work better with auth context
// Public boards
router.get("/boards", optionalAuthenticate, boardController.getPublicBoards);

// Single public board by slug (allows access to private boards for owners/admins)
router.get("/boards/:slug", optionalAuthenticate, boardController.getPublicBoardBySlug);

// Public board posts
router.get("/boards/:slug/posts", optionalAuthenticate, boardController.getPublicBoardPosts);

// Single public post
router.get("/posts/:id", optionalAuthenticate, boardController.getPublicPost);

// Public post comments (read-only for guests)
router.get("/posts/:id/comments", optionalAuthenticate, postController.getComments);

// ✅ PUBLIC INTERACTIONS (require authentication)
// Upvote post (requires auth)
router.post("/posts/:id/upvote", authenticate, trackVote, postController.toggleUpvote);

// Add comment (requires auth)
router.post(
  "/posts/:id/comments",
  authenticate,
  commentValidation,
  trackComment,
  postController.addComment
);

// Like comment (requires auth)
router.post(
  "/posts/:postId/comments/:commentId/like",
  authenticate,
  postController.toggleCommentLike
);

// Public changelogs
router.get("/changelogs", optionalAuthenticate, changelogController.getAllChangelogs);
router.get("/changelogs/recent", optionalAuthenticate, changelogController.getRecentChangelogs);
router.get("/changelogs/:slug", optionalAuthenticate, changelogController.getChangelogBySlug);

router.get("/categories", boardController.getCategories);

// Public roadmap - get all posts with roadmap statuses from public boards
router.get("/roadmap", optionalAuthenticate, postController.getPublicRoadmapPosts);

module.exports = router;
