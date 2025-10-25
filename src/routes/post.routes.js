const express = require("express");
const router = express.Router();
const postController = require("../controllers/post.controller");
const { authenticate } = require("../middleware/auth.middleware");
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

// Post routes
router.get("/boards/:slug/posts", postController.getPostsByBoard);
router.post(
  "/boards/:slug/posts",
  createPostValidation,
  postController.createPost,
);
router.get("/posts/:id", postController.getPost);
router.put("/posts/:id", createPostValidation, postController.updatePost);
router.patch("/posts/:id/status", postController.updatePostStatus);
router.delete("/posts/:id", postController.deletePost);
router.post("/posts/:id/upvote", postController.toggleUpvote);

// Comment routes
router.get("/posts/:id/comments", postController.getComments);
router.post(
  "/posts/:id/comments",
  commentValidation,
  postController.addComment,
);
router.delete(
  "/posts/:postId/comments/:commentId",
  postController.deleteComment,
);

module.exports = router;
