const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase.config');
const { optionalAuth } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

/**
 * @route   POST /api/contact
 * @desc    Submit a contact form message
 * @access  Public (with optional authentication)
 */
router.post(
  '/',
  // Optional authentication - doesn't fail if no token
  optionalAuth,
  // Validation rules
  [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('subject')
      .trim()
      .isIn(['Feature Request', 'Bug Report', 'Billing', 'Other'])
      .withMessage('Invalid subject selected'),
    body('message')
      .trim()
      .isLength({ min: 10, max: 5000 })
      .withMessage('Message must be between 10 and 5000 characters'),
    body('honeypot')
      .isEmpty()
      .withMessage('Bot detected'),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, subject, message, userAgent, honeypot } = req.body;

      // Honeypot check - if filled, it's a bot
      if (honeypot) {
        return res.status(400).json({
          success: false,
          message: 'Invalid submission'
        });
      }

      // Rate limiting check - prevent spam (simple version)
      // In production, use Redis-based rate limiting
      const recentSubmissions = await supabaseAdmin
        .from('contact_messages')
        .select('created_at')
        .eq('email', email)
        .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // Last 5 minutes
        .limit(3);

      if (recentSubmissions.data && recentSubmissions.data.length >= 3) {
        return res.status(429).json({
          success: false,
          message: 'Too many submissions. Please try again later.'
        });
      }

      // Prepare data for insertion
      const contactData = {
        email: email.toLowerCase(),
        subject,
        message,
        user_id: req.user?.id || null,
        is_authenticated: !!req.user,
        user_agent: userAgent || req.headers['user-agent'] || null,
        ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || null,
        status: 'new'
      };

      // Insert into Supabase
      const { data, error } = await supabaseAdmin
        .from('contact_messages')
        .insert([contactData])
        .select()
        .single();

      if (error) {
        console.error('Error saving contact message:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to submit contact form. Please try again.'
        });
      }

      // Send notification email to admin (don't wait for it)
      const emailService = require('../services/email.service');
      emailService.sendContactNotification(data).catch(err => {
        console.error('Failed to send contact notification email:', err);
        // Don't fail the request if email fails
      });

      res.status(201).json({
        success: true,
        message: 'Your message has been received. We\'ll get back to you soon!',
        data: {
          id: data.id,
          created_at: data.created_at
        }
      });
    } catch (error) {
      console.error('Contact form error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit contact form. Please try again.'
      });
    }
  }
);

/**
 * @route   GET /api/contact/my-messages
 * @desc    Get authenticated user's contact messages
 * @access  Private
 */
router.get(
  '/my-messages',
  require('../middleware/auth.middleware').authenticate,
  async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('contact_messages')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching user messages:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch messages'
        });
      }

      res.json({
        success: true,
        data: data || []
      });
    } catch (error) {
      console.error('Error fetching user messages:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch messages'
      });
    }
  }
);

module.exports = router;
