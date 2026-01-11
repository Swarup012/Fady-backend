const express = require("express");
const router = express.Router();
const postController = require("../controllers/post.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { checkPostLimit } = require("../middleware/plan-limits.middleware");
const { trackPostCreation, trackVote, trackComment } = require("../middleware/tracking.middleware");
const { rateLimitPostCreation, rateLimitCommentCreation, rateLimitVote } = require("../middleware/rate-limit.middleware");
const { body } = require("express-validator");

// Validation rules
const createPostValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 5, max: 500 })
    .withMessage("Title must be between 5 and 500 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Description must be less than 5000 characters"),
];

const commentValidation = [
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Comment content is required")
    .isLength({ max: 2000 })
    .withMessage("Comment must be less than 2000 characters"),
];

// All routes require authentication
router.use(authenticate);

// Get all posts (for admin dashboard)
router.get("/posts", postController.getAllPosts);

// Post routes
router.get("/boards/:slug/posts", postController.getPostsByBoard);
router.post(
  "/boards/:slug/posts",
  rateLimitPostCreation, // 🚦 Rate limit (10/hour for external, 20/hour for members)
  checkPostLimit, // ✅ Check post limit before creation
  createPostValidation,
  trackPostCreation, // 📊 Track user after post creation
  postController.createPost,
);
router.get("/posts/:id", postController.getPost);
router.put("/posts/:id", createPostValidation, postController.updatePost);
router.patch("/posts/:id/status", postController.updatePostStatus);
router.delete("/posts/:id", postController.deletePost);
router.post(
  "/posts/:id/upvote",
  rateLimitVote, // 🚦 Rate limit (100 votes/hour)
  trackVote, // 📊 Track vote action
  postController.toggleUpvote
);

// Comment routes
router.get("/posts/:id/comments", postController.getComments);
router.post(
  "/posts/:id/comments",
  rateLimitCommentCreation, // 🚦 Rate limit (30 comments/hour)
  commentValidation,
  trackComment, // 📊 Track comment action
  postController.addComment,
);
router.post(
  "/posts/:postId/comments/:commentId/like",
  postController.toggleCommentLike,
);
router.delete(
  "/posts/:postId/comments/:commentId",
  postController.deleteComment,
);

module.exports = router;
