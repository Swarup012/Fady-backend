const { supabaseAdmin } = require("../config/supabase.config");
const ResponseUtil = require("../utils/response.util");
const path = require("path");
const crypto = require("crypto");

class UploadController {
  /**
   * Upload image to Supabase storage
   */
  async uploadImage(req, res) {
    try {
      if (!req.files || !req.files.file) {
        return ResponseUtil.error(res, "No file uploaded", 400);
      }

      const file = req.files.file;
      const folder = req.body.folder || "changelog";
      const organizationId = req.organization?.id;

      if (!organizationId) {
        return ResponseUtil.error(res, "Organization context required", 400);
      }

      // Validate file type
      const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.mimetype)) {
        return ResponseUtil.error(res, "Invalid file type. Only images are allowed", 400);
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        return ResponseUtil.error(res, "File size exceeds 5MB limit", 400);
      }

      // Generate unique filename
      const fileExt = path.extname(file.name);
      const fileName = `${crypto.randomBytes(16).toString("hex")}${fileExt}`;
      const filePath = `${organizationId}/${folder}/${fileName}`;

      // Upload to Supabase storage
      const { data, error } = await supabaseAdmin.storage
        .from("user-uploads")
        .upload(filePath, file.data, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error("Supabase storage error:", error);
        return ResponseUtil.error(res, "Failed to upload image", 500);
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage
        .from("user-uploads")
        .getPublicUrl(filePath);

      return ResponseUtil.success(res, "Image uploaded successfully", {
        url: urlData.publicUrl,
        path: filePath,
      });
    } catch (error) {
      console.error("Upload error:", error);
      return ResponseUtil.error(res, "Failed to upload image", 500);
    }
  }

  /**
   * Delete image from Supabase storage
   */
  async deleteImage(req, res) {
    try {
      const { url } = req.body;

      if (!url) {
        return ResponseUtil.error(res, "Image URL is required", 400);
      }

      // Extract path from URL
      const urlParts = url.split("/user-uploads/");
      if (urlParts.length < 2) {
        return ResponseUtil.error(res, "Invalid image URL", 400);
      }

      const filePath = urlParts[1];

      // Delete from Supabase storage
      const { error } = await supabaseAdmin.storage
        .from("user-uploads")
        .remove([filePath]);

      if (error) {
        console.error("Supabase storage delete error:", error);
        return ResponseUtil.error(res, "Failed to delete image", 500);
      }

      return ResponseUtil.success(res, "Image deleted successfully");
    } catch (error) {
      console.error("Delete error:", error);
      return ResponseUtil.error(res, "Failed to delete image", 500);
    }
  }
}

module.exports = new UploadController();
