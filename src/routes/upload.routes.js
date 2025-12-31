const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/upload.controller");

// Upload image
router.post("/image", uploadController.uploadImage);

// Delete image
router.delete("/image", uploadController.deleteImage);

module.exports = router;
