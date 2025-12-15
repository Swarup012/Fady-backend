const { supabaseAdmin } = require('../config/supabase.config');
const crypto = require('crypto');

class StorageService {
  /**
   * Upload avatar to Supabase Storage
   */
  async uploadAvatar(userId, file) {
    try {
      // Generate unique filename
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${userId}-${crypto.randomBytes(8).toString('hex')}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      console.log('📤 Uploading avatar:', filePath);

      // Upload to Supabase Storage
      const { data, error } = await supabaseAdmin.storage
        .from('user-uploads')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error('❌ Upload error:', error);
        throw error;
      }

      // Get public URL
      const { data: publicData } = supabaseAdmin.storage
        .from('user-uploads')
        .getPublicUrl(filePath);

      console.log('✅ Avatar uploaded:', publicData.publicUrl);

      return {
        path: filePath,
        url: publicData.publicUrl,
      };
    } catch (error) {
      console.error('❌ Upload avatar error:', error);
      throw error;
    }
  }

  /**
   * Delete avatar from Supabase Storage
   */
  async deleteAvatar(filePath) {
    try {
      if (!filePath) return;

      console.log('🗑️  Deleting avatar:', filePath);

      const { error } = await supabaseAdmin.storage
        .from('user-uploads')
        .remove([filePath]);

      if (error) {
        console.error('❌ Delete error:', error);
        // Don't throw - deletion errors shouldn't block the operation
      } else {
        console.log('✅ Avatar deleted');
      }
    } catch (error) {
      console.error('❌ Delete avatar error:', error);
      // Don't throw - deletion errors shouldn't block the operation
    }
  }

  /**
   * Extract file path from Supabase URL
   */
  extractFilePath(url) {
    if (!url) return null;

    try {
      // Example URL: https://xxx.supabase.co/storage/v1/object/public/user-uploads/avatars/filename.jpg
      const parts = url.split('/user-uploads/');
      if (parts.length > 1) {
        return parts[1];
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}

module.exports = new StorageService();
