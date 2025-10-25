const express = require("express");
const router = express.Router();
const boardController = require("../controllers/board.controller");

// ✅ NO AUTHENTICATION REQUIRED FOR THESE ROUTES
// Public boards
router.get("/boards", boardController.getPublicBoards);

// Public board posts
router.get("/boards/:slug/posts", boardController.getPublicBoardPosts);

// Single public post
router.get("/posts/:id", boardController.getPublicPost);

router.get("/categories", boardController.getCategories);

module.exports = router;
