// src/services/email-template.service.js

const emailTemplateService = {
  /**
   * Generate batched completion email (one or multiple posts)
   */
  async generateBatchedCompletionEmail(posts, organization, userName, reasonsMap) {
    const postCount = posts.length;
    const verb = postCount === 1 ? 'has' : 'have';
    const noun = postCount === 1 ? 'feature' : 'features';
    
    const subject = postCount === 1
      ? `🎉 Feature Completed: ${posts[0].title}`
      : `🎉 ${postCount} Features You Care About Are Complete!`;

    const html = this.generateHTMLTemplate({
      organization,
      userName,
      posts,
      reasonsMap,
      postCount,
      verb,
      noun
    });

    return { subject, html };
  },

  /**
   * Generate rich HTML email template
   */
  generateHTMLTemplate({ organization, userName, posts, reasonsMap, postCount, verb, noun }) {
    const orgColor = organization.primary_color || '#3b82f6';
    const orgName = organization.name || 'Our Team';
    const orgLogo = organization.logo_url || '';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    // Generate unsubscribe token (will be added per user)
    const unsubscribeLink = `${frontendUrl}/unsubscribe?email=UNSUBSCRIBE_TOKEN`;

    // Generate post cards HTML
    const postCardsHTML = posts.map(post => {
      const reasons = reasonsMap[post.id] || [];
      const reasonBadges = reasons.map(reason => {
        const badgeColors = {
          created: '#10b981',
          upvoted: '#3b82f6',
          commented: '#8b5cf6'
        };
        const icons = {
          created: '✨',
          upvoted: '👍',
          commented: '💬'
        };
        return `
          <span style="display: inline-block; background: ${badgeColors[reason] || '#6b7280'}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-right: 8px; margin-bottom: 8px;">
            ${icons[reason] || '•'} ${reason.charAt(0).toUpperCase() + reason.slice(1)}
          </span>
        `;
      }).join('');

      const postUrl = `${frontendUrl}/feedback?post=${post.id}`;
      const boardName = post.board_name || 'Feedback';

      return `
        <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 16px; background: white;">
          <div style="display: flex; align-items: start; justify-content: space-between; margin-bottom: 12px;">
            <h3 style="margin: 0; font-size: 18px; color: #111827; font-weight: 600;">${post.title}</h3>
            <span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; white-space: nowrap; margin-left: 12px;">
              ✅ Completed
            </span>
          </div>
          
          ${post.description ? `
            <p style="margin: 12px 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
              ${this.truncateText(post.description, 150)}
            </p>
          ` : ''}
          
          <div style="margin: 12px 0;">
            ${reasonBadges}
          </div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <div style="color: #6b7280; font-size: 13px;">
              📋 ${boardName}
            </div>
            <a href="${postUrl}" style="display: inline-block; padding: 8px 16px; background: ${orgColor}; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
              View Details →
            </a>
          </div>
        </div>
      `;
    }).join('');

    const engagementSummary = this.generateEngagementSummary(reasonsMap);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${orgName} - Feature Completed</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 20px;">
          <tr>
            <td align="center">
              <!-- Main Container -->
              <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, ${orgColor} 0%, ${this.adjustColor(orgColor, -20)} 100%); padding: 40px 20px; text-align: center;">
                    ${orgLogo ? `
                      <img src="${orgLogo}" alt="${orgName}" style="max-width: 120px; height: auto; margin-bottom: 16px;">
                    ` : ''}
                    <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">
                      🎉 Feature${postCount > 1 ? 's' : ''} Completed!
                    </h1>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 32px 24px;">
                    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151; line-height: 1.6;">
                      Hi <strong>${userName}</strong>,
                    </p>
                    
                    <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151; line-height: 1.6;">
                      Great news! <strong>${postCount} ${noun}</strong> you were interested in ${verb} been completed by the ${orgName} team:
                    </p>
                    
                    <!-- Post Cards -->
                    ${postCardsHTML}
                    
                    <!-- Call to Action -->
                    <div style="text-align: center; margin: 32px 0; padding: 24px; background: #f3f4f6; border-radius: 12px;">
                      <p style="margin: 0 0 16px 0; font-size: 15px; color: #4b5563;">
                        Want to see what else we're working on?
                      </p>
                      <a href="${frontendUrl}/roadmap" style="display: inline-block; padding: 12px 24px; background: ${orgColor}; color: white; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;">
                        View Our Roadmap
                      </a>
                    </div>
                    
                    <!-- Engagement Summary -->
                    <div style="margin-top: 32px; padding: 16px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
                      <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.6;">
                        <strong>Why you're receiving this:</strong><br>
                        ${engagementSummary}
                      </p>
                    </div>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 24px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; text-align: center; line-height: 1.6;">
                      You're receiving this email because you interacted with ${postCount === 1 ? 'this feature request' : 'these feature requests'} on ${orgName}.
                    </p>
                    
                    <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
                      <a href="${frontendUrl}/notifications/preferences" style="color: #6b7280; text-decoration: underline;">Manage Preferences</a>
                      &nbsp;•&nbsp;
                      <a href="${unsubscribeLink}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a>
                    </p>
                    
                    <p style="margin: 16px 0 0 0; font-size: 11px; color: #9ca3af; text-align: center;">
                      © ${new Date().getFullYear()} ${orgName}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  },

  /**
   * Generate engagement summary text
   */
  generateEngagementSummary(reasonsMap) {
    const allReasons = new Set();
    Object.values(reasonsMap).forEach(reasons => {
      reasons.forEach(reason => allReasons.add(reason));
    });

    const reasonTexts = [];
    if (allReasons.has('created')) reasonTexts.push('created');
    if (allReasons.has('upvoted')) reasonTexts.push('upvoted');
    if (allReasons.has('commented')) reasonTexts.push('commented on');

    if (reasonTexts.length === 0) return 'you showed interest in this feedback';
    if (reasonTexts.length === 1) return `you ${reasonTexts[0]} this feedback`;
    if (reasonTexts.length === 2) return `you ${reasonTexts[0]} and ${reasonTexts[1]} this feedback`;
    return `you ${reasonTexts[0]}, ${reasonTexts[1]}, and ${reasonTexts[2]} this feedback`;
  },

  /**
   * Truncate text to specified length
   */
  truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  },

  /**
   * Adjust color brightness (for gradient)
   */
  adjustColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255))
      .toString(16).slice(1);
  },

  /**
   * Generate plain text version (fallback)
   */
  generatePlainTextEmail(posts, organization, userName, reasonsMap) {
    const postCount = posts.length;
    const noun = postCount === 1 ? 'feature' : 'features';
    const verb = postCount === 1 ? 'has' : 'have';
    
    let text = `Hi ${userName},\n\n`;
    text += `Great news! ${postCount} ${noun} you were interested in ${verb} been completed:\n\n`;
    
    posts.forEach((post, index) => {
      const reasons = reasonsMap[post.id] || [];
      text += `${index + 1}. ${post.title}\n`;
      text += `   Status: ✅ Completed\n`;
      if (reasons.length > 0) {
        text += `   You ${reasons.join(', ')} this\n`;
      }
      text += `\n`;
    });
    
    text += `\nView more at: ${process.env.FRONTEND_URL}/roadmap\n\n`;
    text += `---\n`;
    text += `You're receiving this because you interacted with these features on ${organization.name}.\n`;
    text += `Unsubscribe: ${process.env.FRONTEND_URL}/unsubscribe\n`;
    
    return text;
  }
};

module.exports = emailTemplateService;
