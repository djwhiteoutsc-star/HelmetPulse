/**
 * CardPulse Backend Server with Airtable Auth
 * 
 * Features:
 * - User registration & login via Airtable
 * - JWT token management
 * - Access logging
 * - Persistent watchlist storage
 * - Firecrawl API for eBay scraping
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 🔑 API KEYS - Set via environment variables
// ============================================
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// eBay API Credentials (Production for real data)
const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_ENVIRONMENT = 'PRODUCTION'; // PRODUCTION for real sold prices (5K calls/day)

// Email Configuration
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'HelmetPulse <noreply@helmetpulse.com>';

// reCAPTCHA Configuration
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

// Initialize Anthropic client
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Initialize Nodemailer transporter
let emailTransporter = null;
if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: EMAIL_PORT == 465, // true for 465, false for other ports
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });
    console.log('✓ Email configured');
} else {
    console.log('⚠ Email not configured - password reset codes will be logged only');
}

// Initialize Supabase client for helmet data
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// eBay OAuth token cache
let ebayAccessToken = null;
let ebayTokenExpiry = 0;

// Airtable table IDs (more reliable than names)
const TABLES = {
    USERS: 'tblGhbSWtKe9R57dr',
    JWT_TOKENS: 'tblZzDYW0cr7JtsqK',
    ACCESS_LOGS: 'tblzaGZy1LYvABqSf'
};

// Cache for price lookups (24 hours to reduce API calls)
const cache = new NodeCache({ stdTTL: 86400 }); // 24 hours = 86400 seconds

// eBay API rate limiting (prevent burst limit violations)
let lastEbayApiCall = 0;
const EBAY_API_MIN_DELAY = 600; // Minimum 600ms between calls (max ~1.6 calls/second, safe buffer)

async function throttleEbayApi() {
    const now = Date.now();
    const timeSinceLastCall = now - lastEbayApiCall;

    if (timeSinceLastCall < EBAY_API_MIN_DELAY) {
        const delay = EBAY_API_MIN_DELAY - timeSinceLastCall;
        console.log(`⏱️ Throttling eBay API call (waiting ${delay}ms to avoid rate limit)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    lastEbayApiCall = Date.now();
}

// Middleware
app.set('trust proxy', 1); // Trust first proxy (Render's load balancer)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve static files (for production)
app.use(express.static(path.join(__dirname, '.')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ============================================
// AIRTABLE HELPERS
// ============================================
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

// Debug endpoint to test Airtable connection
app.get('/api/debug/airtable', async (req, res) => {
    const testUrl = `${AIRTABLE_BASE_URL}/${TABLES.USERS}?maxRecords=1`;

    console.log('=== AIRTABLE DEBUG ===');
    console.log('Base ID:', AIRTABLE_BASE_ID);
    console.log('API Key (first 20 chars):', AIRTABLE_API_KEY ? AIRTABLE_API_KEY.substring(0, 20) + '...' : 'NOT SET');
    console.log('Table ID:', TABLES.USERS);
    console.log('Full URL:', testUrl);

    try {
        const response = await fetch(testUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
        });

        const data = await response.text();
        console.log('Response status:', response.status);
        console.log('Response body:', data);

        res.json({
            baseId: AIRTABLE_BASE_ID || 'NOT SET',
            apiKeySet: !!AIRTABLE_API_KEY,
            apiKeyPrefix: AIRTABLE_API_KEY ? AIRTABLE_API_KEY.substring(0, 20) : null,
            tableId: TABLES.USERS,
            testUrl: testUrl,
            responseStatus: response.status,
            responseBody: JSON.parse(data)
        });
    } catch (error) {
        res.json({
            baseId: AIRTABLE_BASE_ID || 'NOT SET',
            apiKeySet: !!AIRTABLE_API_KEY,
            tableId: TABLES.USERS,
            testUrl: testUrl,
            error: error.message
        });
    }
});

// Format date for Airtable (MM/DD/YYYY)
function formatDateForAirtable(date = new Date()) {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

async function airtableRequest(table, method = 'GET', body = null, recordId = null) {
    let url = `${AIRTABLE_BASE_URL}/${encodeURIComponent(table)}`;
    if (recordId) url += `/${recordId}`;
    
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        }
    };
    
    if (body && (method === 'POST' || method === 'PATCH')) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
        const error = await response.text();
        console.error('Airtable error:', response.status, error);
        throw new Error(`Airtable error: ${response.status}`);
    }
    
    return response.json();
}

async function findUserByEmail(email) {
    const formula = `{Email Address} = '${email.replace(/'/g, "\\'")}'`;
    const url = `${AIRTABLE_BASE_URL}/${encodeURIComponent(TABLES.USERS)}?filterByFormula=${encodeURIComponent(formula)}`;
    
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
    });
    
    const data = await response.json();
    return data.records && data.records.length > 0 ? data.records[0] : null;
}

async function findTokenByValue(token) {
    const formula = `{Token Value} = '${token.replace(/'/g, "\\'")}'`;
    const url = `${AIRTABLE_BASE_URL}/${encodeURIComponent(TABLES.JWT_TOKENS)}?filterByFormula=${encodeURIComponent(formula)}`;
    
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
    });
    
    const data = await response.json();
    return data.records && data.records.length > 0 ? data.records[0] : null;
}

async function getUserById(recordId) {
    return airtableRequest(TABLES.USERS, 'GET', null, recordId);
}

// ============================================
// AUTH HELPERS
// ============================================
function hashPassword(password) {
    // Using SHA256 with salt (matches your "Hashed Password" field format)
    return '$2b$12$' + crypto.createHash('sha256').update(password + 'cardpulse_secure_salt_2024').digest('base64').substring(0, 53);
}

function generateToken() {
    // Generate JWT-like token
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ 
        iat: Date.now(),
        exp: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        jti: crypto.randomBytes(16).toString('hex')
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', 'cardpulse_jwt_secret')
        .update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           req.ip || 
           'Unknown';
}

function getDeviceInfo(req) {
    const ua = req.headers['user-agent'] || 'Unknown';
    // Simplify user agent
    if (ua.includes('Chrome')) return 'Chrome Browser';
    if (ua.includes('Firefox')) return 'Firefox Browser';
    if (ua.includes('Safari')) return 'Safari Browser';
    if (ua.includes('Edge')) return 'Edge Browser';
    return ua.substring(0, 50);
}

// ============================================
// AUTH MIDDLEWARE
// ============================================
async function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        // Find token in Airtable
        const tokenRecord = await findTokenByValue(token);
        
        if (!tokenRecord) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        // Check if revoked
        if (tokenRecord.fields['Revoked']) {
            return res.status(401).json({ error: 'Token has been revoked' });
        }
        
        // Check if expired
        const expDate = new Date(tokenRecord.fields['Expiration Date']);
        if (expDate < new Date()) {
            return res.status(401).json({ error: 'Token has expired' });
        }
        
        // Get user from linked record
        const userLinks = tokenRecord.fields['User'];
        if (!userLinks || userLinks.length === 0) {
            return res.status(401).json({ error: 'Token not linked to user' });
        }
        
        const user = await getUserById(userLinks[0]);
        req.user = user;
        req.userId = user.id;
        req.tokenRecord = tokenRecord;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
}

async function optionalAuth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    
    if (token) {
        try {
            const tokenRecord = await findTokenByValue(token);
            if (tokenRecord && !tokenRecord.fields['Revoked']) {
                const userLinks = tokenRecord.fields['User'];
                if (userLinks && userLinks.length > 0) {
                    const user = await getUserById(userLinks[0]);
                    req.user = user;
                    req.userId = user.id;
                }
            }
        } catch (e) {
            // Ignore auth errors for optional auth
        }
    }
    next();
}

// ============================================
// ACCESS LOG HELPER
// ============================================
async function logAccess(userId, eventType, req, tokenRecordId = null, notes = '') {
    try {
        const fields = {
            'IP Address': getClientIP(req),
            'Event Type': eventType,
            'Timestamp': formatDateForAirtable(),
            'Device Info': getDeviceInfo(req),
            'Notes': notes
        };
        
        if (userId) {
            fields['User'] = [userId];
        }
        
        if (tokenRecordId) {
            fields['JWT Token'] = [tokenRecordId];
        }
        
        await airtableRequest(TABLES.ACCESS_LOGS, 'POST', { fields });
    } catch (error) {
        console.error('Failed to log access:', error);
    }
}

// ============================================
// CAPTCHA VERIFICATION
// ============================================

async function verifyCaptcha(token) {
    if (!RECAPTCHA_SECRET_KEY) {
        console.warn('⚠️ RECAPTCHA_SECRET_KEY not configured - skipping captcha verification');
        return true; // Allow registration if captcha not configured
    }

    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${RECAPTCHA_SECRET_KEY}&response=${token}`
        });

        const data = await response.json();
        return data.success === true;
    } catch (error) {
        console.error('Captcha verification error:', error);
        return false;
    }
}

// ============================================
// AUTH ENDPOINTS
// ============================================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name, captchaToken } = req.body;

        // Validation
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email required' });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Verify CAPTCHA
        if (!captchaToken) {
            return res.status(400).json({ error: 'Please complete the CAPTCHA verification' });
        }
        const captchaValid = await verifyCaptcha(captchaToken);
        if (!captchaValid) {
            return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
        }

        // Check if user exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Create user in Airtable
        const hashedPassword = hashPassword(password);
        const userRecord = await airtableRequest(TABLES.USERS, 'POST', {
            fields: {
                'Full Name': name || email.split('@')[0],
                'Email Address': email.toLowerCase(),
                'Hashed Password': hashedPassword,
                'Account Created': formatDateForAirtable(),
                'Last Login': formatDateForAirtable(),
                'Watchlist': '[]'
            }
        });

        // Create JWT token
        const token = generateToken();
        const tokenRecord = await airtableRequest(TABLES.JWT_TOKENS, 'POST', {
            fields: {
                'Token Value': token,
                'Expiration Date': formatDateForAirtable(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
                'Issued At': formatDateForAirtable(),
                'Revoked': false,
                'User': [userRecord.id],
                'Device Info': getDeviceInfo(req),
                'IP Address': getClientIP(req)
            }
        });

        // Log the registration
        await logAccess(userRecord.id, 'Login Success', req, tokenRecord.id, 'New account registration');

        console.log(`✓ New user registered: ${email}`);

        res.json({
            success: true,
            token,
            user: {
                id: userRecord.id,
                email: userRecord.fields['Email Address'],
                name: userRecord.fields['Full Name']
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const user = await findUserByEmail(email);
        
        if (!user) {
            await logAccess(null, 'Login Failure', req, null, `Failed login attempt for: ${email}`);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Verify password
        const hashedInput = hashPassword(password);
        if (user.fields['Hashed Password'] !== hashedInput) {
            await logAccess(user.id, 'Login Failure', req, null, 'Invalid password');
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Create new JWT token
        const token = generateToken();
        const tokenRecord = await airtableRequest(TABLES.JWT_TOKENS, 'POST', {
            fields: {
                'Token Value': token,
                'Expiration Date': formatDateForAirtable(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
                'Issued At': formatDateForAirtable(),
                'Revoked': false,
                'User': [user.id],
                'Device Info': getDeviceInfo(req),
                'IP Address': getClientIP(req)
            }
        });

        // Update last login
        await airtableRequest(TABLES.USERS, 'PATCH', {
            fields: { 'Last Login': formatDateForAirtable() }
        }, user.id);

        // Log successful login
        await logAccess(user.id, 'Login Success', req, tokenRecord.id);

        console.log(`✓ User logged in: ${email}`);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.fields['Email Address'],
                name: user.fields['Full Name']
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        // Revoke the token
        await airtableRequest(TABLES.JWT_TOKENS, 'PATCH', {
            fields: { 'Revoked': true }
        }, req.tokenRecord.id);

        // Log logout
        await logAccess(req.userId, 'Logout', req, req.tokenRecord.id);

        res.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ============================================
// EMAIL HELPERS
// ============================================
async function sendResetEmail(email, resetToken, userName) {
    if (!emailTransporter) {
        console.log(`⚠ Email not configured - Reset code for ${email}: ${resetToken}`);
        return false;
    }

    try {
        await emailTransporter.sendMail({
            from: EMAIL_FROM,
            to: email,
            subject: 'Reset Your HelmetPulse Password',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #6366f1;">Reset Your Password</h2>
                    <p>Hi ${userName || 'there'},</p>
                    <p>We received a request to reset your HelmetPulse password. Use the code below to reset your password:</p>
                    <div style="background: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
                        <h1 style="color: #1f2937; letter-spacing: 8px; margin: 0; font-size: 32px;">${resetToken}</h1>
                    </div>
                    <p>This code will expire in <strong>1 hour</strong>.</p>
                    <p>If you didn't request this, you can safely ignore this email.</p>
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                    <p style="color: #6b7280; font-size: 14px;">HelmetPulse - Real-time helmet price tracking</p>
                </div>
            `
        });
        console.log(`✓ Reset email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('Failed to send reset email:', error);
        return false;
    }
}

// Forgot Password - Request reset token
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await findUserByEmail(email);

        if (!user) {
            // Don't reveal if email exists or not
            return res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
        }

        // Generate reset token (6 random digits)
        const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store reset token in user record
        await airtableRequest(TABLES.USERS, 'PATCH', {
            fields: {
                'Reset Token': resetToken,
                'Reset Token Expires': formatDateForAirtable(resetExpires)
            }
        }, user.id);

        // Log the reset request
        await logAccess(user.id, 'Password Reset Requested', req, null, `Reset token generated for ${email}`);

        // Send email with reset token
        const userName = user.fields['Full Name'];
        await sendResetEmail(email, resetToken, userName);

        const response = {
            success: true,
            message: 'If that email exists, a reset code has been sent to your email'
        };

        // Include debug token only if email is not configured (for testing)
        if (!emailTransporter) {
            response._debug_token = resetToken;
        }

        res.json(response);

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// Reset Password - Use token to set new password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({ error: 'Email, token, and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await findUserByEmail(email);

        if (!user) {
            return res.status(400).json({ error: 'Invalid reset token' });
        }

        // Verify token and expiration
        const storedToken = user.fields['Reset Token'];
        const expiresAt = user.fields['Reset Token Expires'] ? new Date(user.fields['Reset Token Expires']) : null;

        if (!storedToken || storedToken !== token) {
            await logAccess(user.id, 'Password Reset Failed', req, null, 'Invalid token');
            return res.status(400).json({ error: 'Invalid reset token' });
        }

        if (!expiresAt || expiresAt < new Date()) {
            await logAccess(user.id, 'Password Reset Failed', req, null, 'Expired token');
            return res.status(400).json({ error: 'Reset token has expired' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear reset token
        await airtableRequest(TABLES.USERS, 'PATCH', {
            fields: {
                'Password Hash': hashedPassword,
                'Reset Token': '',
                'Reset Token Expires': ''
            }
        }, user.id);

        // Log successful password reset
        await logAccess(user.id, 'Password Reset Success', req, null, 'Password changed via reset token');

        console.log(`✓ Password reset successful for: ${email}`);

        res.json({
            success: true,
            message: 'Password reset successful. You can now log in with your new password.'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            email: req.user.fields['Email Address'],
            name: req.user.fields['Full Name']
        }
    });
});

// ============================================
// WATCHLIST ENDPOINTS
// ============================================

// Get user's watchlist
app.get('/api/watchlist', authenticateToken, (req, res) => {
    try {
        const watchlistJson = req.user.fields['Watchlist'] || '[]';
        const watchlist = JSON.parse(watchlistJson);
        res.json({ watchlist });
    } catch (error) {
        console.error('Get watchlist error:', error);
        res.json({ watchlist: [] });
    }
});

// Save entire watchlist
app.put('/api/watchlist', authenticateToken, async (req, res) => {
    try {
        const { watchlist } = req.body;
        
        if (!Array.isArray(watchlist)) {
            return res.status(400).json({ error: 'Watchlist must be an array' });
        }

        // Enforce max cards limit (10 for free tier)
        if (watchlist.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 cards allowed' });
        }

        // Save to Airtable
        await airtableRequest(TABLES.USERS, 'PATCH', {
            fields: { 'Watchlist': JSON.stringify(watchlist) }
        }, req.userId);

        res.json({ success: true, watchlist });
    } catch (error) {
        console.error('Save watchlist error:', error);
        res.status(500).json({ error: 'Failed to save watchlist' });
    }
});

// Add card to watchlist
app.post('/api/watchlist/add', authenticateToken, async (req, res) => {
    try {
        const { card } = req.body;
        
        if (!card || !card.name) {
            return res.status(400).json({ error: 'Card data required' });
        }

        // Get current watchlist
        const watchlistJson = req.user.fields['Watchlist'] || '[]';
        const watchlist = JSON.parse(watchlistJson);
        
        if (watchlist.length >= 10) {
            return res.status(400).json({ error: 'Maximum 10 cards allowed' });
        }

        // Add card
        card.id = card.id || Date.now();
        card.addedAt = new Date().toISOString();
        watchlist.push(card);

        // Save to Airtable
        await airtableRequest(TABLES.USERS, 'PATCH', {
            fields: { 'Watchlist': JSON.stringify(watchlist) }
        }, req.userId);

        res.json({ success: true, card, watchlist });
    } catch (error) {
        console.error('Add card error:', error);
        res.status(500).json({ error: 'Failed to add card' });
    }
});

// Remove card from watchlist
app.delete('/api/watchlist/:cardId', authenticateToken, async (req, res) => {
    try {
        const cardId = parseInt(req.params.cardId);

        const watchlistJson = req.user.fields['Watchlist'] || '[]';
        let watchlist = JSON.parse(watchlistJson);

        watchlist = watchlist.filter(c => c.id !== cardId);

        await airtableRequest(TABLES.USERS, 'PATCH', {
            fields: { 'Watchlist': JSON.stringify(watchlist) }
        }, req.userId);

        res.json({ success: true, watchlist });
    } catch (error) {
        console.error('Remove card error:', error);
        res.status(500).json({ error: 'Failed to remove card' });
    }
});

// ============================================
// HELMET SUGGESTIONS ENDPOINT
// ============================================

// Get helmet suggestions for autocomplete
app.get('/api/helmets/suggestions', async (req, res) => {
    try {
        const query = req.query.q || '';

        if (!query || query.length < 2) {
            return res.json({ suggestions: [] });
        }

        if (!supabase) {
            return res.status(500).json({ error: 'Database not configured' });
        }

        // Search helmets by name (case-insensitive partial match) - fetch more to allow grouping
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type, design_type')
            .or(`name.ilike.%${query}%,player.ilike.%${query}%,team.ilike.%${query}%`)
            .order('player')
            .limit(50);

        if (error) {
            console.error('Supabase search error:', error);
            return res.status(500).json({ error: 'Search failed' });
        }

        // Group helmets by player + team + helmet_type + design_type
        const groupedMap = new Map();

        for (const h of helmets) {
            const key = [
                (h.player || '').toLowerCase().trim(),
                (h.team || '').toLowerCase().trim(),
                (h.helmet_type || '').toLowerCase().trim(),
                (h.design_type || '').toLowerCase().trim()
            ].join('|');

            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    ids: [h.id],
                    name: h.name,
                    player: h.player,
                    team: h.team,
                    helmetType: h.helmet_type,
                    designType: h.design_type
                });
            } else {
                groupedMap.get(key).ids.push(h.id);
            }
        }

        // Fetch prices for all helmet IDs and calculate median per group
        const allIds = helmets.map(h => h.id);
        const { data: prices } = await supabase
            .from('helmet_prices')
            .select('helmet_id, median_price')
            .in('helmet_id', allIds);

        // Map prices by helmet_id
        const pricesByHelmetId = new Map();
        if (prices) {
            for (const p of prices) {
                if (!pricesByHelmetId.has(p.helmet_id)) {
                    pricesByHelmetId.set(p.helmet_id, []);
                }
                pricesByHelmetId.get(p.helmet_id).push(p.median_price);
            }
        }

        // Calculate median price for each group
        const suggestions = [];
        for (const [key, group] of groupedMap) {
            // Collect all prices for this group's helmet IDs
            const groupPrices = [];
            for (const id of group.ids) {
                const helmetPrices = pricesByHelmetId.get(id) || [];
                groupPrices.push(...helmetPrices);
            }

            // Calculate median
            let medianPrice = null;
            if (groupPrices.length > 0) {
                groupPrices.sort((a, b) => a - b);
                const mid = Math.floor(groupPrices.length / 2);
                medianPrice = groupPrices.length % 2 === 0
                    ? (groupPrices[mid - 1] + groupPrices[mid]) / 2
                    : groupPrices[mid];
            }

            suggestions.push({
                ids: group.ids,
                id: group.ids[0], // Primary ID for the group
                name: group.name,
                player: group.player,
                team: group.team,
                helmetType: group.helmetType,
                designType: group.designType,
                medianPrice: medianPrice,
                priceCount: groupPrices.length
            });
        }

        // Sort by player name and limit to 10
        suggestions.sort((a, b) => (a.player || '').localeCompare(b.player || ''));

        res.json({ suggestions: suggestions.slice(0, 10) });
    } catch (error) {
        console.error('Suggestions error:', error);
        res.status(500).json({ error: 'Failed to get suggestions' });
    }
});

// Get prices for a specific helmet from database
app.get('/api/helmets/:id/prices', async (req, res) => {
    try {
        const helmetId = req.params.id;

        if (!supabase) {
            return res.status(500).json({ error: 'Database not configured' });
        }

        // Get the helmet info
        const { data: helmet, error: helmetError } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type')
            .eq('id', helmetId)
            .single();

        if (helmetError || !helmet) {
            return res.status(404).json({ error: 'Helmet not found' });
        }

        // Get the latest price for this helmet
        const { data: prices, error: priceError } = await supabase
            .from('helmet_prices')
            .select('median_price, min_price, max_price, total_results, source, scraped_at')
            .eq('helmet_id', helmetId)
            .order('scraped_at', { ascending: false })
            .limit(5);

        if (priceError) {
            console.error('Price fetch error:', priceError);
            return res.status(500).json({ error: 'Failed to fetch prices' });
        }

        if (!prices || prices.length === 0) {
            return res.json({
                helmet,
                medianPrice: null,
                minPrice: null,
                maxPrice: null,
                totalResults: 0,
                source: null,
                message: 'No price data available for this helmet'
            });
        }

        // Use the most recent price
        const latestPrice = prices[0];

        // Calculate average if multiple sources
        const avgMedian = prices.reduce((sum, p) => sum + (p.median_price || 0), 0) / prices.length;

        res.json({
            helmet,
            medianPrice: latestPrice.median_price || avgMedian,
            minPrice: latestPrice.min_price || Math.min(...prices.map(p => p.min_price || Infinity)),
            maxPrice: latestPrice.max_price || Math.max(...prices.map(p => p.max_price || 0)),
            totalResults: prices.reduce((sum, p) => sum + (p.total_results || 0), 0),
            source: latestPrice.source || 'database',
            priceHistory: prices
        });
    } catch (error) {
        console.error('Helmet prices error:', error);
        res.status(500).json({ error: 'Failed to get helmet prices' });
    }
});

// Get prices for multiple helmet IDs (grouped helmets)
app.post('/api/helmets/grouped-prices', async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No helmet IDs provided' });
        }

        if (!supabase) {
            return res.status(500).json({ error: 'Database not configured' });
        }

        // Get all prices for these helmet IDs
        const { data: prices, error: priceError } = await supabase
            .from('helmet_prices')
            .select('helmet_id, median_price, min_price, max_price, total_results, source, scraped_at')
            .in('helmet_id', ids)
            .order('scraped_at', { ascending: false });

        if (priceError) {
            console.error('Price fetch error:', priceError);
            return res.status(500).json({ error: 'Failed to fetch prices' });
        }

        if (!prices || prices.length === 0) {
            return res.json({
                medianPrice: null,
                minPrice: null,
                maxPrice: null,
                totalResults: 0,
                source: 'database',
                message: 'No price data available'
            });
        }

        // Collect all median prices and calculate overall median
        const allMedianPrices = prices.map(p => p.median_price).filter(p => p !== null);
        const allMinPrices = prices.map(p => p.min_price).filter(p => p !== null);
        const allMaxPrices = prices.map(p => p.max_price).filter(p => p !== null);

        let medianPrice = null;
        if (allMedianPrices.length > 0) {
            allMedianPrices.sort((a, b) => a - b);
            const mid = Math.floor(allMedianPrices.length / 2);
            medianPrice = allMedianPrices.length % 2 === 0
                ? (allMedianPrices[mid - 1] + allMedianPrices[mid]) / 2
                : allMedianPrices[mid];
        }

        res.json({
            medianPrice,
            minPrice: allMinPrices.length > 0 ? Math.min(...allMinPrices) : null,
            maxPrice: allMaxPrices.length > 0 ? Math.max(...allMaxPrices) : null,
            totalResults: prices.reduce((sum, p) => sum + (p.total_results || 0), 0),
            source: 'database',
            priceCount: allMedianPrices.length
        });
    } catch (error) {
        console.error('Grouped prices error:', error);
        res.status(500).json({ error: 'Failed to get grouped prices' });
    }
});

// ============================================
// HAIKU QUERY OPTIMIZER
// ============================================

async function optimizeQueryWithHaiku(rawQuery) {
    // Simple string normalization - no LLM, no hallucinations, no cost
    console.log(`🔧 Normalizing query: "${rawQuery}"`);

    let optimizedQuery = rawQuery;

    // Fix common year formats: 23/24 → 2023-24, 24/25 → 2024-25
    optimizedQuery = optimizedQuery.replace(/\b(\d{2})\/(\d{2})\b/g, (match, y1, y2) => {
        const year1 = parseInt(y1) < 50 ? `20${y1}` : `19${y1}`;
        const year2 = parseInt(y2) < 50 ? `20${y2}` : `19${y2}`;
        return `${year1}-${year2}`;
    });

    // Remove serial numbers like /25, /99, /10, /999 (they don't search well on eBay)
    optimizedQuery = optimizedQuery.replace(/\s*\/\d{1,4}\b/g, '');

    // Clean up extra spaces
    optimizedQuery = optimizedQuery.replace(/\s+/g, ' ').trim();

    const wasOptimized = optimizedQuery !== rawQuery;

    if (wasOptimized) {
        console.log(`✓ Normalized: "${rawQuery}" → "${optimizedQuery}"`);
    } else {
        console.log(`✓ No changes needed: "${rawQuery}"`);
    }

    return {
        optimizedQuery,
        originalQuery: rawQuery,
        wasOptimized
    };
}

// ============================================
// EBAY API INTEGRATION
// ============================================

async function getEbayAccessToken() {
    // Return cached token if still valid
    if (ebayAccessToken && Date.now() < ebayTokenExpiry) {
        return ebayAccessToken;
    }

    console.log('🔑 Getting new eBay access token...');

    const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
    const tokenUrl = EBAY_ENVIRONMENT === 'PRODUCTION'
        ? 'https://api.ebay.com/identity/v1/oauth2/token'
        : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${credentials}`
            },
            body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('eBay OAuth error:', error);
            throw new Error(`eBay OAuth failed: ${response.status}`);
        }

        const data = await response.json();
        ebayAccessToken = data.access_token;
        ebayTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early

        console.log('✓ eBay access token obtained');
        return ebayAccessToken;
    } catch (error) {
        console.error('eBay OAuth error:', error);
        throw error;
    }
}

async function searchEbayWithAPI(query, category, retryCount = 0) {
    const MAX_RETRIES = 3;

    // Use Finding API for sold listings (Browse API only returns active listings)
    // Finding API doesn't require OAuth, just the App ID
    const apiUrl = EBAY_ENVIRONMENT === 'PRODUCTION'
        ? 'https://svcs.ebay.com/services/search/FindingService/v1'
        : 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1';

    // Category mapping
    const categoryMap = {
        'sports': '212',
        'pokemon': '183454',
        'mtg': '19107',
        'yugioh': '183453'
    };

    // Build Finding API XML request
    const params = new URLSearchParams({
        'OPERATION-NAME': 'findCompletedItems',
        'SERVICE-VERSION': '1.0.0',
        'SECURITY-APPNAME': EBAY_APP_ID,
        'RESPONSE-DATA-FORMAT': 'JSON',
        'REST-PAYLOAD': '',
        'keywords': query,
        'paginationInput.entriesPerPage': '100',
        'sortOrder': 'EndTimeSoonest'
    });

    // Add category filter
    if (category && categoryMap[category]) {
        params.append('categoryId', categoryMap[category]);
    }

    // Add sold items filter
    params.append('itemFilter(0).name', 'SoldItemsOnly');
    params.append('itemFilter(0).value', 'true');

    console.log(`📡 eBay Finding API search: "${query}"`);
    console.log(`   URL: ${apiUrl}?${params.toString().substring(0, 200)}...`);

    try {
        // Throttle API calls to prevent burst rate limit
        await throttleEbayApi();

        const response = await fetch(`${apiUrl}?${params.toString()}`);

        if (!response.ok) {
            // Handle rate limit errors with retry
            if ((response.status === 429 || response.status === 500) && retryCount < MAX_RETRIES) {
                const backoffDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                console.log(`⚠️ Rate limit hit (${response.status}), retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                return searchEbayWithAPI(query, category, retryCount + 1);
            }

            const error = await response.text();
            console.error('eBay Finding API error:', response.status, error);
            throw new Error(`eBay Finding API error: ${response.status}`);
        }

        const data = await response.json();
        console.log(`   API Response received, parsing...`);

        const searchResult = data.findCompletedItemsResponse?.[0];

        if (!searchResult || searchResult.ack?.[0] !== 'Success') {
            console.log('⚠️ No results from eBay Finding API');
            return {
                query,
                totalResults: 0,
                averagePrice: null,
                medianPrice: null,
                minPrice: null,
                maxPrice: null,
                listings: [],
                fetchedAt: new Date().toISOString(),
                ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
            };
        }

        const items = searchResult.searchResult?.[0]?.item || [];

        if (items.length === 0) {
            console.log('⚠️ No completed items found');
            return {
                query,
                totalResults: 0,
                averagePrice: null,
                medianPrice: null,
                minPrice: null,
                maxPrice: null,
                listings: [],
                fetchedAt: new Date().toISOString(),
                ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
            };
        }

        // Parse listings - only items that actually SOLD (not just ended)
        const listings = items
            .filter(item => {
                const sellingState = item.sellingStatus?.[0];
                const sold = sellingState?.sellingState?.[0] === 'EndedWithSales';
                const price = parseFloat(sellingState?.currentPrice?.[0]?.__value__ || 0);
                return sold && price > 0;
            })
            .map(item => ({
                title: item.title?.[0] || 'Unknown',
                price: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0)
            }))
            .filter(l => l.price >= 0.25 && l.price <= 5000);

        console.log(`✓ Found ${listings.length} sold eBay listings`);

        if (listings.length === 0) {
            return {
                query,
                totalResults: 0,
                averagePrice: null,
                medianPrice: null,
                minPrice: null,
                maxPrice: null,
                listings: [],
                fetchedAt: new Date().toISOString(),
                ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
            };
        }

        // Dedupe
        const seen = new Set();
        const uniqueListings = listings.filter(l => {
            const key = l.price.toFixed(2);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const filtered = removeOutliers(uniqueListings);
        const prices = filtered.map(l => l.price);
        const recentPrices = prices.slice(0, Math.min(3, prices.length));
        const recentMedian = recentPrices.length > 0 ? getMedian(recentPrices) : null;

        return {
            query,
            totalResults: filtered.length,
            averagePrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100 : null,
            medianPrice: recentMedian ? Math.round(recentMedian * 100) / 100 : null,
            minPrice: prices.length > 0 ? Math.min(...prices) : null,
            maxPrice: prices.length > 0 ? Math.max(...prices) : null,
            listings: filtered.slice(0, 15),
            fetchedAt: new Date().toISOString(),
            ebayUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
        };
    } catch (error) {
        console.error('eBay Finding API search error:', error);
        throw error;
    }
}

// ============================================
// PRICE ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        ebayApiConfigured: !!(EBAY_APP_ID && EBAY_CERT_ID),
        firecrawlConfigured: !!FIRECRAWL_API_KEY,
        airtableConfigured: !!AIRTABLE_API_KEY,
        anthropicConfigured: !!ANTHROPIC_API_KEY,
        queryOptimizer: !!anthropic ? 'enabled' : 'disabled',
        timestamp: new Date().toISOString()
    });
});

// Main price lookup
app.post('/api/prices', optionalAuth, async (req, res) => {
    try {
        const { query, category } = req.body;

        if (!query || query.length < 3) {
            return res.status(400).json({ error: 'Query must be at least 3 characters' });
        }

        // Check cache first (before optimization to save Haiku calls too)
        const cacheKey = `${query}-${category}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            console.log(`✓ Cache hit for: ${query}`);
            return res.json(cached);
        }

        // Optimize query with Haiku
        const { optimizedQuery, wasOptimized } = await optimizeQueryWithHaiku(query);

        // Also cache by optimized query to avoid duplicate scrapes
        const optimizedCacheKey = `${optimizedQuery}-${category}`;
        const optimizedCached = cache.get(optimizedCacheKey);
        if (optimizedCached) {
            console.log(`✓ Cache hit for optimized query: ${optimizedQuery}`);
            // Also cache under original query for next time
            cache.set(cacheKey, optimizedCached);
            return res.json(optimizedCached);
        }

        console.log(`→ Fetching prices for: ${optimizedQuery}${wasOptimized ? ` (optimized from: ${query})` : ''}`);

        // Try eBay Production API first (5K calls/day), fallback to Firecrawl if it fails
        let data;
        try {
            data = await searchEbayWithAPI(optimizedQuery, category);
            console.log('✓ Using eBay Production API');
        } catch (ebayError) {
            console.log('⚠️ eBay API failed, falling back to Firecrawl:', ebayError.message);
            data = await scrapeEbayWithFirecrawl(optimizedQuery, category);
        }

        // Add optimization info to response
        data.originalQuery = query;
        data.optimizedQuery = optimizedQuery;
        data.wasOptimized = wasOptimized;

        if (data.totalResults > 0) {
            cache.set(cacheKey, data);
            if (wasOptimized) {
                cache.set(optimizedCacheKey, data);
            }
        }

        res.json(data);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SCRAPING FUNCTION
// ============================================
async function scrapeEbayWithFirecrawl(query, category) {
    if (!FIRECRAWL_API_KEY) {
        throw new Error('Firecrawl API key not configured');
    }

    const params = new URLSearchParams({
        _nkw: query,
        LH_Sold: '1',
        LH_Complete: '1',
        _sop: '13',
        _ipg: '120',
        rt: 'nc',
        LH_SoldBefore: Math.floor(Date.now() / 1000), // Now
        LH_SoldAfter: Math.floor((Date.now() - (90 * 24 * 60 * 60 * 1000)) / 1000) // 90 days ago
    });

    const categoryMap = {
        'sports': '212',
        'pokemon': '183454',
        'mtg': '19107',
        'yugioh': '183453'
    };

    if (category && categoryMap[category]) {
        params.append('_sacat', categoryMap[category]);
    }

    const ebayUrl = `https://www.ebay.com/sch/i.html?${params.toString()}`;
    console.log('📍 eBay URL:', ebayUrl);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
        },
        body: JSON.stringify({
            url: ebayUrl,
            formats: ['markdown', 'html'],
            waitFor: 3000,
            timeout: 30000
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('Firecrawl error:', response.status, errText);
        
        if (response.status === 401) throw new Error('Invalid Firecrawl API key');
        if (response.status === 402) throw new Error('Firecrawl credits exhausted');
        throw new Error(`Firecrawl error: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
        throw new Error('Failed to get page content');
    }

    const listings = [];

    // Parse from Markdown first (Firecrawl returns better markdown than HTML)
    if (result.data?.markdown) {
        console.log(`Markdown received: ${result.data.markdown.length} chars`);

        // Parse markdown for sold listings
        // Format: "Title\n$XX.XX\nSold..." or variations
        const lines = result.data.markdown.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for price patterns
            const priceMatch = line.match(/\$\s*([\d,]+\.?\d{0,2})/);
            if (!priceMatch) continue;

            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (isNaN(price) || price < 0.25 || price > 5000) continue;

            // Look for "Sold" keyword nearby (within 3 lines)
            let hasSold = false;
            for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 3); j++) {
                if (lines[j].toLowerCase().includes('sold')) {
                    hasSold = true;
                    break;
                }
            }

            if (!hasSold) continue;

            // Try to find title (usually a few lines before the price)
            let title = 'eBay Listing';
            for (let j = Math.max(0, i - 5); j < i; j++) {
                const potentialTitle = lines[j].trim();
                if (potentialTitle.length > 15 &&
                    !potentialTitle.includes('$') &&
                    !potentialTitle.toLowerCase().includes('shop on ebay') &&
                    !potentialTitle.toLowerCase().includes('sponsored')) {
                    title = potentialTitle.substring(0, 100);
                    break;
                }
            }

            console.log(`  ✓ Found listing: ${title.substring(0, 60)} - $${price}`);
            listings.push({ title, price });
        }
    }

    console.log(`📊 Total listings parsed from markdown: ${listings.length}`);

    if (listings.length === 0) {
        return {
            query,
            totalResults: 0,
            averagePrice: null,
            medianPrice: null,
            minPrice: null,
            maxPrice: null,
            listings: [],
            fetchedAt: new Date().toISOString(),
            ebayUrl
        };
    }

    // Dedupe
    const seen = new Set();
    const uniqueListings = listings.filter(l => {
        const key = l.price.toFixed(2);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(`After deduplication: ${uniqueListings.length} unique listings`);

    const filtered = removeOutliers(uniqueListings);
    console.log(`After outlier removal: ${filtered.length} listings`);

    const prices = filtered.map(l => l.price);
    const recentPrices = prices.slice(0, Math.min(3, prices.length));
    const recentMedian = recentPrices.length > 0 ? getMedian(recentPrices) : null;

    console.log(`✓ Final result: ${filtered.length} listings, median: $${recentMedian}`);

    return {
        query,
        totalResults: filtered.length,
        averagePrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100 : null,
        medianPrice: recentMedian ? Math.round(recentMedian * 100) / 100 : null,
        minPrice: prices.length > 0 ? Math.min(...prices) : null,
        maxPrice: prices.length > 0 ? Math.max(...prices) : null,
        listings: filtered.slice(0, 15),
        fetchedAt: new Date().toISOString(),
        ebayUrl
    };
}

function getMedian(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function removeOutliers(listings) {
    if (listings.length < 4) return listings;
    const prices = listings.map(l => l.price).sort((a, b) => a - b);
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    return listings.filter(l => l.price >= q1 - iqr * 1.5 && l.price <= q3 + iqr * 1.5);
}

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   📈 CardPulse Server (Airtable Edition)                      ║
╠═══════════════════════════════════════════════════════════════╣
║   Local:      http://localhost:${PORT}                          ║
║   Health:     http://localhost:${PORT}/health                   ║
║   eBay API:   ${EBAY_APP_ID && EBAY_CERT_ID ? '✓ Production API (5K/day + 24hr cache)' : '✗ Not configured'}             ║
║   Firecrawl:  ${FIRECRAWL_API_KEY ? '✓ Fallback ready' : '✗ Missing'}                                  ║
║   Airtable:   ${AIRTABLE_API_KEY ? '✓ Configured' : '✗ Missing'}                                     ║
║   Anthropic:  ${ANTHROPIC_API_KEY ? '✓ Query Optimizer ON' : '✗ Query Optimizer OFF'}                            ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});
