const { supabaseAdmin } = require('../config/supabase.config');
const axios = require('axios'); // ✅ Already installed — no new dependency needed

/**
 * FeedbackChatService
 * ===================
 * Provides AI chat capabilities grounded in a specific organization's feedback data.
 * Uses the Gemini REST API directly via axios — no new npm packages required.
 *
 * SECURITY ARCHITECTURE:
 * ─────────────────────
 * ALL data queries in this service are scoped exclusively to `organizationId` which
 * is derived from `req.user.organization_id` (set by the auth middleware from the JWT).
 *
 * - No client-supplied org ID is ever used to select data.
 * - supabaseAdmin is used with EXPLICIT .eq('organization_id', organizationId) on every query.
 * - The secondary enforcement is the URL param validation in the controller:
 *   the session org_id must match the :orgId URL param — 403 if not.
 */
class FeedbackChatService {
  constructor() {
    this.apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not set — AI Feedback Chat will fail at runtime');
    }
    // Gemini 2.5 Flash streaming endpoint (SSE)
    this.streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${this.apiKey}`;
  }

  /**
   * Fetches all clusters + top posts for the organization to build a context snapshot.
   * Uses supabaseAdmin with EXPLICIT organization_id scoping on every query.
   * @param {string} organizationId - Derived exclusively from the verified JWT session.
   */
  async buildOrgContext(organizationId) {
    // 1. Fetch organization name
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    // 2. Fetch all boards for this org
    const { data: boards, error: boardsError } = await supabaseAdmin
      .from('boards')
      .select('id, name, slug')
      .eq('organization_id', organizationId);

    if (boardsError) throw boardsError;
    if (!boards || boards.length === 0) {
      return { clusters: [], recentPosts: [], orgName: org?.name || 'your organization' };
    }

    const boardIds = boards.map((b) => b.id);
    const boardMap = Object.fromEntries(boards.map((b) => [b.id, b.name]));

    // 3. Fetch cluster labels for all boards in this org
    const { data: clusterLabels } = await supabaseAdmin
      .from('cluster_labels')
      .select('board_id, cluster_key, ai_label, ai_summary, severity_level')
      .in('board_id', boardIds);

    // 4. Fetch posts for stats aggregation
    const { data: posts } = await supabaseAdmin
      .from('posts')
      .select('board_id, cluster_key, upvotes, title, status')
      .in('board_id', boardIds)
      .eq('is_archived', false);

    // Aggregate stats per cluster key
    const clusterStats = {};
    for (const post of posts || []) {
      const key = `${post.board_id}:${post.cluster_key}`;
      if (!clusterStats[key]) {
        clusterStats[key] = { post_count: 0, total_upvotes: 0 };
      }
      clusterStats[key].post_count += 1;
      clusterStats[key].total_upvotes += post.upvotes || 0;
    }

    // Build enriched cluster list sorted by upvotes
    const clusters = (clusterLabels || [])
      .map((cl) => {
        const key = `${cl.board_id}:${cl.cluster_key}`;
        const stats = clusterStats[key] || { post_count: 0, total_upvotes: 0 };
        return {
          board: boardMap[cl.board_id] || 'Unknown Board',
          cluster_key: cl.cluster_key,
          label: cl.ai_label || cl.cluster_key,
          summary: cl.ai_summary,
          severity: cl.severity_level,
          post_count: stats.post_count,
          total_upvotes: stats.total_upvotes,
        };
      })
      .sort((a, b) => b.total_upvotes - a.total_upvotes);

    // 5. Fetch 20 most recent non-archived posts
    const { data: recentPosts } = await supabaseAdmin
      .from('posts')
      .select('title, status, upvotes, board_id, cluster_key, created_at')
      .in('board_id', boardIds)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(20);

    const enrichedRecent = (recentPosts || []).map((p) => ({
      ...p,
      board: boardMap[p.board_id] || 'Unknown Board',
    }));

    return {
      clusters,
      recentPosts: enrichedRecent,
      orgName: org?.name || 'your organization',
    };
  }

  /**
   * Builds a grounded system prompt including the org's real feedback data.
   * This is a secondary safeguard — the primary isolation is the DB query scoping.
   */
  buildSystemPrompt({ orgName, clusters, recentPosts }) {
    const clusterContext =
      clusters.length > 0
        ? clusters
            .map(
              (c) =>
                `• [${c.severity?.toUpperCase() || 'LOW'}] ${c.label} (${c.board}) — ${c.post_count} posts, ${c.total_upvotes} upvotes\n  Summary: ${c.summary || c.cluster_key}`
            )
            .join('\n')
        : 'No clusters have been generated yet.';

    const recentContext =
      recentPosts.length > 0
        ? recentPosts
            .map(
              (p) =>
                `• "${p.title}" [${p.status || 'open'}] — ${p.upvotes} upvotes (${p.board})`
            )
            .join('\n')
        : 'No recent posts.';

    return `You are an expert product analyst AI assistant for the organization "${orgName}".

You have access ONLY to the feedback data from this organization. You must NEVER reference, speculate about, invent, or compare data from any other organization. All analysis must be grounded exclusively in the data provided below.

═══════════════════════════════════════
FEEDBACK CLUSTER INSIGHTS (AI-grouped topics):
═══════════════════════════════════════
${clusterContext}

═══════════════════════════════════════
RECENT FEEDBACK POSTS (latest 20):
═══════════════════════════════════════
${recentContext}

═══════════════════════════════════════
YOUR CAPABILITIES:
═══════════════════════════════════════
- Summarize what users are reporting and what needs attention
- Identify high-priority or critical issues based on severity and upvotes
- Spot trends and patterns across clusters
- Help draft changelog notes or status updates based on completed feedback
- Answer questions about specific feedback topics or boards
- Recommend what to prioritize next

Always be concise, specific, and actionable. Reference actual cluster names and post titles when relevant. If a question cannot be answered from the data above, say so clearly — do not invent data.`;
  }

  /**
   * Streams an AI chat response to the Express `res` object using Server-Sent Events.
   * Calls Gemini REST API via axios (responseType: 'stream') — no new packages needed.
   *
   * @param {string} params.organizationId - MUST come from verified JWT session only.
   * @param {Array}  params.messages        - [{role: 'user'|'model', text: string}]
   * @param {Object} params.res             - Express response object
   */
  async streamChatResponse({ organizationId, messages, res }) {
    // Build org-scoped context
    const context = await this.buildOrgContext(organizationId);
    const systemPrompt = this.buildSystemPrompt(context);

    // Convert message history to Gemini's REST content format
    const contents = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    };

    // Set SSE headers before writing anything
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent nginx from buffering the stream

    // Send context metadata first so the frontend can show it immediately
    const contextMeta = {
      clustersUsed: context.clusters.length,
      postsUsed: context.recentPosts.length,
      orgName: context.orgName,
    };
    res.write(`data: ${JSON.stringify({ event: 'context', data: contextMeta })}\n\n`);

    try {
      // Call Gemini streaming REST endpoint via axios with responseType: 'stream'
      const geminiResponse = await axios.post(this.streamUrl, requestBody, {
        responseType: 'stream',
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' },
      });

      let buffer = '';

      geminiResponse.data.on('data', (chunk) => {
        buffer += chunk.toString('utf8');

        // Process complete SSE lines from the buffer
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              res.write(`data: ${JSON.stringify({ event: 'chunk', data: text })}\n\n`);
            }
          } catch {
            // Malformed JSON chunk — skip
          }
        }
      });

      geminiResponse.data.on('end', () => {
        res.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
        res.end();
      });

      geminiResponse.data.on('error', (streamErr) => {
        console.error('❌ Gemini stream error:', streamErr.message);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ event: 'error', data: 'Stream interrupted. Please try again.' })}\n\n`);
          res.end();
        }
      });

    } catch (aiError) {
      const status = aiError.response?.status;
      const errMsg = aiError.response?.data?.error?.message || aiError.message;
      console.error(`❌ FeedbackChatService AI error (${status}):`, errMsg);

      if (!res.writableEnded) {
        const userMsg =
          status === 429
            ? 'AI quota exceeded. Please wait a moment and try again.'
            : 'AI generation failed. Please try again.';
        res.write(`data: ${JSON.stringify({ event: 'error', data: userMsg })}\n\n`);
        res.end();
      }
    }
  }
  /**
   * Non-streaming version: fetches org context, calls Gemini, and returns
   * the full AI reply as a plain string.
   * Used by the sendMessage endpoint so we can persist the reply in the DB.
   *
   * @param {string} params.organizationId - MUST come from verified JWT session.
   * @param {Array}  params.messages        - [{role:'user'|'model', text:string}]
   * @returns {Promise<string>} The AI's full reply text.
   */
  async generateResponse({ organizationId, messages }) {
    const context = await this.buildOrgContext(organizationId);
    const systemPrompt = this.buildSystemPrompt(context);

    const contents = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const requestBody = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
    };

    // Non-streaming endpoint (no ?alt=sse)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;

    const response = await axios.post(url, requestBody, {
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' },
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty AI response');
    return text;
  }
}

module.exports = new FeedbackChatService();

