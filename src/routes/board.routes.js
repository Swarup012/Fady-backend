const express = require("express");
const router = express.Router();
const boardController = require("../controllers/board.controller");
const { authenticate, authorize } = require("../middleware/auth.middleware");
const { checkBoardLimit } = require("../middleware/plan-limits.middleware");
const { body } = require("express-validator");
const publicRoutes = require("./public.routes");

const createBoardValidation = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Board name is required")
    .isLength({ min: 3, max: 100 })
    .withMessage("Board name must be between 3 and 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be less than 500 characters"),
  body("is_private")
    .optional()
    .isBoolean()
    .withMessage("is_private must be a boolean"),
  body("icon")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Icon must be less than 50 characters"),
  body("category") // ✅ ADD CATEGORY VALIDATION
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Category must be between 2 and 100 characters"),
  body("visible_to_roles") // ✅ ADD VISIBLE_TO_ROLES VALIDATION
    .optional()
    .isArray()
    .withMessage("visible_to_roles must be an array"),
];

const updateBoardValidation = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage("Board name must be between 3 and 100 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description must be less than 500 characters"),
  body("is_private")
    .optional()
    .isBoolean()
    .withMessage("is_private must be a boolean"),
  body("icon")
    .optional()
    .trim()
    .isLength({ max: 10 })
    .withMessage("Icon must be less than 10 characters"),
];
// app.use("/api/public", publicRoutes);
// All routes require authentication

router.get("/categories", boardController.getCategories);
router.use(authenticate);

// router.get("/public", boardController.getPublicBoards);

// Public routes (all authenticated users can access)
router.get("/", boardController.getAllBoards);
router.get("/check-slug/:slug", boardController.checkSlug);
router.get("/:slug", boardController.getBoardBySlug);

// Board creation - any authenticated user can create (with plan limits)
router.post(
  "/",
  checkBoardLimit, // ✅ Check board limit before creation
  createBoardValidation,
  boardController.createBoard,
);

// Board update/delete - only admin or owner
router.put(
  "/:id",
  authorize(["admin", "owner"]),
  updateBoardValidation,
  boardController.updateBoard,
);
router.delete("/:id", authorize(["admin", "owner"]), boardController.deleteBoard);

module.exports = router;
