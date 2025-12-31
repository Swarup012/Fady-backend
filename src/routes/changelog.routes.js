const express = require("express");
const router = express.Router();
const changelogController = require("../controllers/changelog.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { body } = require("express-validator");

// Validation rules
const createChangelogValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 3, max: 200 })
    .withMessage("Title must be between 3 and 200 characters"),
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Content is required"),
  body("type")
    .optional()
    .isIn(["new", "improved", "fixed"])
    .withMessage("Type must be one of: new, improved, fixed"),
  body("status")
    .optional()
    .isIn(["draft", "published"])
    .withMessage("Status must be either draft or published"),
];

// Note: Authentication is applied in app.js, no need to apply here

// Get recent changelogs (for navbar widget)
router.get("/changelogs/recent", changelogController.getRecentChangelogs);

// CRUD operations
router.get("/changelogs", changelogController.getAllChangelogs);
router.get("/changelogs/:slug", changelogController.getChangelogBySlug);
router.post(
  "/changelogs",
  createChangelogValidation,
  changelogController.createChangelog
);
router.put(
  "/changelogs/:id",
  createChangelogValidation,
  changelogController.updateChangelog
);
router.delete("/changelogs/:id", changelogController.deleteChangelog);

// Publish changelog
router.post("/changelogs/:id/publish", changelogController.publishChangelog);

module.exports = router;
