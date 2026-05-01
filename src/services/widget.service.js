const { supabaseAdmin } = require('../config/supabase.config');
const crypto = require('crypto');

/**
 * Widget Service
 * Manages widget instances and external users for embeddable feedback widget
 */
class WidgetService {
  /**
   * Generate a secure API key for widget
   */
  generateApiKey() {
    return `widget_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Create a new widget instance for an organization
   */
  async createWidget({ organization_id, name, default_board_id, allowed_domains, branding, settings }) {
    try {
      console.log('🔧 Creating widget for organization:', organization_id);

      const { data, error } = await supabaseAdmin
        .from('widget_instances')
        .insert({
          organization_id,
          name: name || 'Default Widget',
          api_key: this.generateApiKey(),
          default_board_id,
          allowed_domains: allowed_domains || [],
          branding: branding || {},
          settings: settings || {
            show_voting: true,
            allow_anonymous: false,
            show_roadmap: true,
          },
        })
        .select()
        .single();

      if (error) throw error;

      console.log('✅ Widget created:', data.id);
      return data;
    } catch (error) {
      console.error('❌ Create widget error:', error);
      throw error;
    }
  }

  /**
   * Get widget by API key
   */
  async getWidgetByApiKey(apiKey) {
    try {
      const { data, error } = await supabaseAdmin
        .from('widget_instances')
        .select('*')
        .eq('api_key', apiKey)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      return data;
    } catch (error) {
      console.error('❌ Get widget by API key error:', error);
      throw error;
    }
  }

  /**
   * Get widget by ID
   */
  async getWidgetById(widgetId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('widget_instances')
        .select('*')
        .eq('id', widgetId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('❌ Get widget by ID error:', error);
      throw error;
    }
  }

  /**
   * Get default widget for organization
   */
  async getDefaultWidget(organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('widget_instances')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('❌ Get default widget error:', error);
      throw error;
    }
  }

  /**
   * Get all widgets for an organization
   */
  async getOrganizationWidgets(organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('widget_instances')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ Get organization widgets error:', error);
      throw error;
    }
  }

  /**
   * Update widget
   */
  async updateWidget(widgetId, updates) {
    try {
      const { data, error } = await supabaseAdmin
        .from('widget_instances')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', widgetId)
        .select()
        .single();

      if (error) throw error;
      console.log('✅ Widget updated:', widgetId);
      return data;
    } catch (error) {
      console.error('❌ Update widget error:', error);
      throw error;
    }
  }

  /**
   * Delete widget
   */
  async deleteWidget(widgetId) {
    try {
      const { error } = await supabaseAdmin
        .from('widget_instances')
        .delete()
        .eq('id', widgetId);

      if (error) throw error;
      console.log('✅ Widget deleted:', widgetId);
      return true;
    } catch (error) {
      console.error('❌ Delete widget error:', error);
      throw error;
    }
  }

  /**
   * Validate widget origin
   * Check if the request origin is in the widget's allowed domains
   */
  async validateWidgetOrigin(apiKey, origin) {
    try {
      if (!origin) {
        return { valid: false, error: 'Origin header required' };
      }

      const widget = await this.getWidgetByApiKey(apiKey);
      if (!widget) {
        return { valid: false, error: 'Invalid API key' };
      }

      // If no allowed domains configured, allow all (for development)
      if (!widget.allowed_domains || widget.allowed_domains.length === 0) {
        console.warn('⚠️ Widget has no allowed domains configured, allowing all origins');
        return { valid: true, widget };
      }

      // Check if origin matches any allowed domain
      const isAllowed = widget.allowed_domains.some(domain =>
        origin.includes(domain)
      );

      if (!isAllowed) {
        return {
          valid: false,
          error: `Origin ${origin} not in allowed domains: ${widget.allowed_domains.join(', ')}`,
        };
      }

      return { valid: true, widget };
    } catch (error) {
      console.error('❌ Validate widget origin error:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Create or get external user
   */
  async createOrUpdateExternalUser({ widget_instance_id, external_user_id, email, name, context }) {
    try {
      console.log('👤 Creating/updating external user:', {
        widget_instance_id,
        external_user_id,
        email,
      });

      // Check if external user already exists
      const { data: existing, error: findError } = await supabaseAdmin
        .from('external_users')
        .select('*')
        .eq('widget_instance_id', widget_instance_id)
        .eq('external_user_id', external_user_id)
        .single();

      if (findError && findError.code !== 'PGRST116') throw findError;

      if (existing) {
        // Update existing user
        const { data, error } = await supabaseAdmin
          .from('external_users')
          .update({
            email,
            name,
            context: context || existing.context,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;
        console.log('✅ External user updated:', data.id);
        return data;
      }

      // Create new external user
      const { data, error } = await supabaseAdmin
        .from('external_users')
        .insert({
          widget_instance_id,
          external_user_id,
          email,
          name,
          context: context || {},
        })
        .select()
        .single();

      if (error) throw error;
      console.log('✅ External user created:', data.id);
      return data;
    } catch (error) {
      console.error('❌ Create/update external user error:', error);
      throw error;
    }
  }

  /**
   * Get external user by ID
   */
  async getExternalUser(externalUserId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('external_users')
        .select('*')
        .eq('id', externalUserId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('❌ Get external user error:', error);
      throw error;
    }
  }

  /**
   * Get external user by external_user_id and widget_instance_id
   */
  async getExternalUserByExternalId(widgetInstanceId, externalUserId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('external_users')
        .select('*')
        .eq('widget_instance_id', widgetInstanceId)
        .eq('external_user_id', externalUserId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('❌ Get external user by external ID error:', error);
      throw error;
    }
  }
}

module.exports = new WidgetService();
