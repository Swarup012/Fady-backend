const express = require("express");
const router = express.Router();
const boardController = require("../controllers/board.controller");
const postController = require("../controllers/post.controller");
const { optionalAuthenticate } = require("../middleware/auth.middleware");

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

router.get("/categories", boardController.getCategories);

module.exports = router;
