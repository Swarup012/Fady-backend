/**
 * Email Service - Send emails using Resend
 */
const { Resend } = require('resend');
const config = require('../config/env.config');

// Initialize Resend with API key
const resend = new Resend(config.resendApiKey);

class EmailService {
  /**
   * Send password reset email
   * @param {string} email - Recipient email address
   * @param {string} resetToken - Password reset token
   * @param {string} userName - User's name for personalization
   */
  async sendPasswordResetEmail(email, resetToken, userName = 'User') {
    try {
      const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;
      
      const { data, error } = await resend.emails.send({
        from: config.resendFromEmail || 'Feedy <onboarding@resend.dev>',
        to: email,
        subject: 'Reset Your Password - Feedy',
        html: this.getPasswordResetEmailTemplate(userName, resetUrl),
      });

      if (error) {
        console.error('❌ Resend API error:', error);
        throw new Error(`Failed to send email: ${error.message}`);
      }

      console.log('✅ Password reset email sent successfully:', data);
      return data;
    } catch (error) {
      console.error('❌ Error sending password reset email:', error);
      throw error;
    }
  }

  /**
   * HTML email template for password reset
   */
  getPasswordResetEmailTemplate(userName, resetUrl) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">🔐 Reset Your Password</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">
                Hi <strong>${userName}</strong>,
              </p>
              
              <p style="margin: 0 0 20px; color: #666666; font-size: 15px; line-height: 1.6;">
                We received a request to reset your password for your Feedy account. Click the button below to create a new password:
              </p>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" 
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 6px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Alternative Link -->
              <p style="margin: 30px 0 20px; color: #666666; font-size: 14px; line-height: 1.6;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 20px; padding: 15px; background-color: #f8f8f8; border-radius: 6px; word-break: break-all; font-size: 13px; color: #667eea; font-family: monospace;">
                ${resetUrl}
              </p>
              
              <!-- Important Info -->
              <div style="margin: 30px 0; padding: 20px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0 0 10px; color: #856404; font-size: 14px; font-weight: 600;">
                  ⚠️ Important:
                </p>
                <p style="margin: 0; color: #856404; font-size: 13px; line-height: 1.6;">
                  This password reset link will expire in <strong>1 hour</strong> for security reasons. If you didn't request this reset, you can safely ignore this email.
                </p>
              </div>
              
              <p style="margin: 20px 0 0; color: #999999; font-size: 13px; line-height: 1.6;">
                If you're having trouble clicking the button, please contact our support team.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f8f8; padding: 30px; text-align: center; border-top: 1px solid #eeeeee;">
              <p style="margin: 0 0 10px; color: #999999; font-size: 13px;">
                This is an automated email from <strong>Feedy</strong>
              </p>
              <p style="margin: 0; color: #cccccc; font-size: 12px;">
                © ${new Date().getFullYear()} Feedy. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  /**
   * Send organization invitation email
   * @param {string} email - Recipient email address
   * @param {string} token - Invitation token
   * @param {object} organizationInfo - Organization details
   * @param {string} inviterName - Name of person who invited
   * @param {string} role - Role being invited as
   */
  async sendInvitationEmail(email, token, organizationInfo, inviterName, role = 'member') {
    try {
      const inviteUrl = `${config.frontendUrl}/invite/${token}`;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);
      const expiryFormatted = expiryDate.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });

      // 🔧 DEV MODE: Always log invitation link for testing
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📧 INVITATION CREATED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('👤 To:', email);
      console.log('🏢 Organization:', organizationInfo.name);
      console.log('👔 Role:', role);
      console.log('📅 Expires:', expiryFormatted);
      console.log('');
      console.log('🔗 INVITATION LINK (Copy & Paste):');
      console.log(inviteUrl);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const fromEmail = config.resendFromEmail || 'Feedy <onboarding@resend.dev>';
      console.log('📨 DEBUG: Sending from:', fromEmail);

      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: email,
        subject: `You're invited to join ${organizationInfo.name} on Feedy`,
        html: this.getInvitationEmailTemplate(
          email,
          inviteUrl,
          organizationInfo,
          inviterName,
          role,
          expiryFormatted
        ),
      });

      if (error) {
        console.error('❌ Resend API error:', error);
        console.log('⚠️  Email failed but invitation was created successfully!');
        console.log('💡 Use the link above to test the invitation flow.\n');
        // Don't throw error - invitation was created successfully
        return { success: true, linkLogged: true };
      }

      console.log('✅ Invitation email sent successfully:', data);
      return data;
    } catch (error) {
      console.error('❌ Error sending invitation email:', error);
      throw error;
    }
  }

  /**
   * HTML email template for organization invitation
   */
  getInvitationEmailTemplate(email, inviteUrl, orgInfo, inviterName, role, expiryDate) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Organization Invitation</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f5f5f5;
    }
    .email-container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      color: #333333;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .invitation-box {
      background-color: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 25px 0;
      border-radius: 6px;
    }
    .invitation-box p {
      margin: 8px 0;
      color: #555555;
      line-height: 1.6;
    }
    .invitation-box strong {
      color: #333333;
    }
    .role-badge {
      display: inline-block;
      padding: 4px 12px;
      background-color: #667eea;
      color: white;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      text-transform: capitalize;
    }
    .cta-button {
      display: inline-block;
      padding: 16px 40px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 25px 0;
      transition: transform 0.2s;
    }
    .cta-button:hover {
      transform: translateY(-2px);
    }
    .info-text {
      color: #666666;
      font-size: 14px;
      line-height: 1.6;
      margin: 20px 0;
    }
    .expiry-notice {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin: 20px 0;
      border-radius: 6px;
    }
    .expiry-notice p {
      margin: 0;
      color: #856404;
      font-size: 14px;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e9ecef;
    }
    .footer p {
      margin: 5px 0;
      color: #6c757d;
      font-size: 13px;
    }
    .link-fallback {
      margin-top: 20px;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 6px;
      word-break: break-all;
    }
    .link-fallback p {
      margin: 5px 0;
      font-size: 12px;
      color: #666666;
    }
    .link-fallback a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>🎉 You're Invited!</h1>
    </div>
    
    <div class="content">
      <p class="greeting">
        Hi there,
      </p>
      
      <p class="greeting">
        <strong>${inviterName}</strong> has invited you to join <strong>${orgInfo.name}</strong> on Feedy.
      </p>
      
      <div class="invitation-box">
        <p><strong>Organization:</strong> ${orgInfo.name}</p>
        <p><strong>Your Role:</strong> <span class="role-badge">${role}</span></p>
        <p><strong>Invited by:</strong> ${inviterName}</p>
      </div>
      
      <p class="info-text">
        Feedy is a feedback management platform that helps teams collect, organize, and act on user feedback. 
        As a ${role}, you'll be able to collaborate with your team to improve your product based on real user insights.
      </p>
      
      <center>
        <a href="${inviteUrl}" class="cta-button">
          Accept Invitation
        </a>
      </center>
      
      <div class="expiry-notice">
        <p>⏰ <strong>Important:</strong> This invitation expires on ${expiryDate}. Please accept it before then.</p>
      </div>
      
      <p class="info-text">
        <strong>What happens next?</strong><br>
        • If you already have an account, log in to accept the invitation<br>
        • If you're new, you'll be prompted to create an account with <strong>${email}</strong><br>
        • After accepting, you'll get instant access to ${orgInfo.name}'s workspace
      </p>
      
      <div class="link-fallback">
        <p><strong>Button not working?</strong> Copy and paste this link into your browser:</p>
        <p><a href="${inviteUrl}">${inviteUrl}</a></p>
      </div>
    </div>
    
    <div class="footer">
      <p><strong>Feedy</strong> - Feedback Management Made Simple</p>
      <p>This is an automated email. Please do not reply.</p>
      <p>If you didn't expect this invitation, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Test email configuration
   */
  async testEmailConfiguration() {
    try {
      const { data, error } = await resend.emails.send({
        from: config.resendFromEmail || 'Feedy <onboarding@resend.dev>',
        to: 'delivered@resend.dev', // Resend test email
        subject: 'Feedy Email Configuration Test',
        html: '<p>Your email configuration is working correctly!</p>',
      });

      if (error) {
        console.error('❌ Email test failed:', error);
        return { success: false, error };
      }

      console.log('✅ Email test successful:', data);
      return { success: true, data };
    } catch (error) {
      console.error('❌ Email test error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();
