const { supabaseAdmin } = require('../config/supabase.config');

/**
 * AiChatConversationService
 * =========================
 * CRUD for ai_chat_conversations + ai_chat_messages.
 *
 * SECURITY: Every method receives organizationId and userId derived exclusively from
 * req.user (set by the authenticate middleware). They are NEVER sourced from 
 * client request bodies or URL params.
 *
 * supabaseAdmin is used so the service works regardless of RLS state
 * (RLS is a defence-in-depth layer for direct Supabase access, not for
 * this server-side code path). Manual .eq('organization_id', orgId) and 
 * .eq('user_id', userId) on every query is the primary enforcement layer here.
 */
class AiChatConversationService {

  // ─── Conversations ────────────────────────────────────────────────────────

  /**
   * List all conversations for an org and user, newest first.
   */
  async listConversations(organizationId, userId) {
    const { data, error } = await supabaseAdmin
      .from('ai_chat_conversations')
      .select('id, title, user_id, created_at, updated_at')
      .eq('organization_id', organizationId)
      .eq('user_id', userId) // <-- Explicit user filtering here
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
  }

  /**
   * Fetch a single conversation, verifying it belongs to the org AND the user.
   */
  async getConversation(conversationId, organizationId, userId) {
    const { data, error } = await supabaseAdmin
      .from('ai_chat_conversations')
      .select('id, title, user_id, organization_id, created_at, updated_at')
      .eq('id', conversationId)
      .eq('organization_id', organizationId) // ← org scope enforced
      .eq('user_id', userId) // ← user scope enforced
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a new conversation, deriving title from the first user message.
   */
  async createConversation(organizationId, userId, firstMessageText) {
    // Auto-generate a title from the first message (truncated)
    const title = firstMessageText
      ? firstMessageText.slice(0, 60) + (firstMessageText.length > 60 ? '…' : '')
      : 'New conversation';

    const { data, error } = await supabaseAdmin
      .from('ai_chat_conversations')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        title,
      })
      .select('id, title, user_id, created_at, updated_at')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update the updated_at timestamp and optionally the title of a conversation.
   */
  async touchConversation(conversationId, organizationId, userId, newTitle) {
    const updates = { updated_at: new Date().toISOString() };
    if (newTitle) updates.title = newTitle;

    const { error } = await supabaseAdmin
      .from('ai_chat_conversations')
      .update(updates)
      .eq('id', conversationId)
      .eq('organization_id', organizationId) // ← org scope enforced
      .eq('user_id', userId); // ← user scope enforced

    if (error) throw error;
  }

  /**
   * Delete a conversation (and all its messages via CASCADE).
   */
  async deleteConversation(conversationId, organizationId, userId) {
    const { error } = await supabaseAdmin
      .from('ai_chat_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('organization_id', organizationId) // ← org scope enforced
      .eq('user_id', userId); // ← user scope enforced

    if (error) throw error;
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  /**
   * Load all messages for a conversation.
   * Verifies the conversation belongs to the org AND user before fetching.
   */
  async getMessages(conversationId, organizationId, userId) {
    // First verify the conversation belongs to this org and user
    await this.getConversation(conversationId, organizationId, userId);

    const { data, error } = await supabaseAdmin
      .from('ai_chat_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Persist a single message in a conversation.
   * Does NOT call the AI — use feedbackChatService for that.
   *
   * @param {string} conversationId
   * @param {'user'|'assistant'} role
   * @param {string} content
   * @param {string} organizationId - for the org-scope verification
   * @param {string} userId - for the user-scope verification
   */
  async saveMessage(conversationId, role, content, organizationId, userId) {
    // Verify conversation is in this org and owned by user before inserting
    await this.getConversation(conversationId, organizationId, userId);

    const { data, error } = await supabaseAdmin
      .from('ai_chat_messages')
      .insert({ conversation_id: conversationId, role, content })
      .select('id, role, content, created_at')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Save both the user turn and the AI turn atomically (two inserts).
   * Updates the conversation's updated_at timestamp after.
   *
   * @param {string} conversationId
   * @param {string} userText        - The user's message
   * @param {string} assistantText   - The AI's full reply
   * @param {string} organizationId  - org scope
   * @param {string} userId          - user scope
   * @returns {{ userMessage, assistantMessage }}
   */
  async saveExchange(conversationId, userText, assistantText, organizationId, userId) {
    // Verify conversation scope and ownership
    await this.getConversation(conversationId, organizationId, userId);

    const { data, error } = await supabaseAdmin
      .from('ai_chat_messages')
      .insert([
        { conversation_id: conversationId, role: 'user',      content: userText },
        { conversation_id: conversationId, role: 'assistant', content: assistantText },
      ])
      .select('id, role, content, created_at');

    if (error) throw error;

    // Touch the conversation updated_at so it bubbles to top of list
    await this.touchConversation(conversationId, organizationId, userId);

    return {
      userMessage:      data.find(m => m.role === 'user'),
      assistantMessage: data.find(m => m.role === 'assistant'),
    };
  }
}

module.exports = new AiChatConversationService();
