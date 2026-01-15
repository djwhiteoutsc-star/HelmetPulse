/**
 * CardPulse Backend Server with Supabase Auth
 *
 * Features:
 * - User registration & login via Supabase
 * - JWT token management
 * - Access logging
 * - Persistent watchlist storage
 * - Helmet price data from retailer imports
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe Configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = STRIPE_SECRET_KEY ? Stripe(STRIPE_SECRET_KEY) : null;

// Email Configuration (Resend or SMTP)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'HelmetPulse <onboarding@resend.dev>';

// reCAPTCHA Configuration
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

// Security secrets (MUST be set in environment variables for production)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const PASSWORD_SALT = process.env.PASSWORD_SALT || crypto.randomBytes(16).toString('hex');

// Warn if using auto-generated secrets (not persistent across restarts)
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  WARNING: JWT_SECRET not set - using random value (tokens will invalidate on restart)');
}
if (!process.env.PASSWORD_SALT) {
    console.warn('⚠️  WARNING: PASSWORD_SALT not set - using random value (legacy passwords may break)');
}

// Initialize email (Resend API or Nodemailer SMTP)
let emailTransporter = null;
let useResend = false;

if (RESEND_API_KEY) {
    useResend = true;
    console.log('✓ Email configured (Resend API)');
} else if (EMAIL_HOST && EMAIL_USER && EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: EMAIL_PORT == 465,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });
    console.log('✓ Email configured (SMTP)');
} else {
    console.log('⚠ Email not configured - password reset codes will be logged only');
}

// Initialize Supabase client for helmet data
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Middleware
app.set('trust proxy', 1); // Trust first proxy (Render's load balancer)

// CORS - restrict to your domains in production
const allowedOrigins = [
    'https://www.helmetpulse.com',
    'https://helmetpulse.com',
    'https://helmetpulse.onrender.com',
    'http://localhost:3000'
];
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true
}));

app.use(express.json({ limit: '1mb' })); // Limit payload size

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// Serve static files (for production)
app.use(express.static(path.join(__dirname, '.')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per 15 minutes
    message: { error: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// ============================================
// SUPABASE AUTH HELPERS
// ============================================

// Validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function findUserByEmail(email) {
    if (!email || !isValidEmail(email) || !supabase) return null;

    const { data, error } = await supabase
        .from('auth_users')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

    if (error || !data) return null;
    return data;
}

async function findUserById(userId) {
    if (!userId || !supabase) return null;

    const { data, error } = await supabase
        .from('auth_users')
        .select('*')
        .eq('id', userId)
        .single();

    if (error || !data) return null;
    return data;
}

async function findTokenByValue(token) {
    if (!token || typeof token !== 'string' || !supabase) return null;

    const { data, error } = await supabase
        .from('auth_tokens')
        .select('*, auth_users(*)')
        .eq('token_value', token)
        .single();

    if (error || !data) return null;
    return data;
}

async function createUser(email, passwordHash, fullName) {
    if (!supabase) throw new Error('Database not configured');

    const { data, error } = await supabase
        .from('auth_users')
        .insert({
            email: email.toLowerCase(),
            password_hash: passwordHash,
            full_name: fullName
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function createToken(userId, tokenValue, expirationDate, deviceInfo = null) {
    if (!supabase) throw new Error('Database not configured');

    const { data, error } = await supabase
        .from('auth_tokens')
        .insert({
            user_id: userId,
            token_value: tokenValue,
            expiration_date: expirationDate,
            device_info: deviceInfo
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function revokeToken(tokenId) {
    if (!supabase) return;

    await supabase
        .from('auth_tokens')
        .update({ revoked: true })
        .eq('id', tokenId);
}

async function logAccess(userId, eventType, req, tokenId = null, notes = '') {
    if (!supabase) return;

    try {
        await supabase
            .from('auth_access_logs')
            .insert({
                user_id: userId,
                token_id: tokenId,
                event_type: eventType,
                ip_address: getClientIP(req),
                device_info: getDeviceInfo(req),
                notes: notes
            });
    } catch (error) {
        console.error('Failed to log access:', error);
    }
}

async function getUserWatchlist(userId) {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('auth_user_watchlists')
        .select('watchlist_data')
        .eq('user_id', userId)
        .single();

    if (error || !data) return [];
    return data.watchlist_data || [];
}

async function saveUserWatchlist(userId, watchlistData) {
    if (!supabase) throw new Error('Database not configured');

    const { error } = await supabase
        .from('auth_user_watchlists')
        .upsert({
            user_id: userId,
            watchlist_data: watchlistData
        }, { onConflict: 'user_id' });

    if (error) throw error;
}

// ============================================
// AUTH HELPERS
// ============================================

// Legacy hash function - for backwards compatibility with existing passwords
// TODO: Migrate all users to bcrypt and remove this function
function hashPasswordLegacy(password) {
    return '$2b$12$' + crypto.createHash('sha256').update(password + PASSWORD_SALT).digest('base64').substring(0, 53);
}

// Proper bcrypt hash for new passwords
async function hashPasswordSecure(password) {
    return await bcrypt.hash(password, 12);
}

// Verify password - tries bcrypt first, then legacy
async function verifyPassword(password, storedHash) {
    if (!storedHash) return false;

    // Try bcrypt compare first (works for real bcrypt hashes)
    try {
        const bcryptMatch = await bcrypt.compare(password, storedHash);
        if (bcryptMatch) return true;
    } catch (e) {
        // bcrypt.compare failed - hash might be legacy format
    }

    // Fall back to legacy hash comparison
    return hashPasswordLegacy(password) === storedHash;
}

// For backwards compatibility during transition
function hashPassword(password) {
    return hashPasswordLegacy(password);
}

function generateToken() {
    // Generate secure JWT-like token
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iat: Date.now(),
        exp: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        jti: crypto.randomBytes(16).toString('hex')
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET)
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
        // Find token in Supabase
        const tokenRecord = await findTokenByValue(token);

        if (!tokenRecord) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Check if revoked
        if (tokenRecord.revoked) {
            return res.status(401).json({ error: 'Token has been revoked' });
        }

        // Check if expired
        const expDate = new Date(tokenRecord.expiration_date);
        if (expDate < new Date()) {
            return res.status(401).json({ error: 'Token has expired' });
        }

        // Get user from joined data
        const user = tokenRecord.auth_users;
        if (!user) {
            return res.status(401).json({ error: 'Token not linked to user' });
        }

        req.user = user;
        req.userId = user.id;
        req.tokenId = tokenRecord.id;
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
            if (tokenRecord && !tokenRecord.revoked) {
                const user = tokenRecord.auth_users;
                if (user) {
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
// STRIPE ENDPOINTS
// ============================================

// Create Stripe checkout session for additional slots
app.post('/api/stripe/create-checkout', authenticateToken, async (req, res) => {
    try {
        if (!stripe) {
            return res.status(500).json({ error: 'Stripe not configured' });
        }

        const { quantity = 1 } = req.body; // Number of 5-slot bundles to purchase
        const userId = req.user.id;

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Additional Helmet Slots',
                        description: `+${quantity * 5} helmet tracking slots`,
                    },
                    unit_amount: 199, // $1.99 in cents
                },
                quantity: quantity,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin || 'http://localhost:3000'}/?checkout=success`,
            cancel_url: `${req.headers.origin || 'http://localhost:3000'}/?checkout=cancelled`,
            client_reference_id: userId.toString(),
            metadata: {
                user_id: userId.toString(),
                slots_purchased: (quantity * 5).toString()
            }
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
        console.error('Stripe checkout error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Stripe webhook handler
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(400).send('Stripe not configured');
    }

    const sig = req.headers['stripe-signature'];

    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

        // Handle successful payment
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const userId = parseInt(session.metadata.user_id);
            const slotsPurchased = parseInt(session.metadata.slots_purchased);

            console.log(`✓ Payment successful for user ${userId}: +${slotsPurchased} slots`);

            // Get current slots and increment
            const { data: currentUser } = await supabase
                .from('auth_users')
                .select('purchased_slots')
                .eq('id', userId)
                .single();

            const currentSlots = currentUser?.purchased_slots || 0;
            const newSlots = currentSlots + slotsPurchased;

            // Update user's purchased slots in database
            const { error } = await supabase
                .from('auth_users')
                .update({ purchased_slots: newSlots })
                .eq('id', userId);

            if (error) {
                console.error('Failed to update purchased slots:', error);
                // Still return 200 to acknowledge webhook
            } else {
                console.log(`✓ User ${userId} now has ${newSlots} purchased slots (total: ${10 + newSlots})`);
            }
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Webhook error:', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

// Get user's slot information
app.get('/api/user/slots', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('auth_users')
            .select('purchased_slots')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        const purchasedSlots = user.purchased_slots || 0;
        const totalSlots = 10 + purchasedSlots; // Base 10 + purchased

        res.json({
            baseSlots: 10,
            purchasedSlots,
            totalSlots
        });
    } catch (error) {
        console.error('Get slots error:', error);
        res.status(500).json({ error: 'Failed to get slot information' });
    }
});

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
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
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

        // Create user in Supabase with bcrypt password
        const hashedPassword = await hashPasswordSecure(password);
        const userRecord = await createUser(email, hashedPassword, name || email.split('@')[0]);

        // Create JWT token
        const token = generateToken();
        const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const tokenRecord = await createToken(userRecord.id, token, expirationDate.toISOString(), getDeviceInfo(req));

        // Log the registration
        await logAccess(userRecord.id, 'Login Success', req, tokenRecord.id, 'New account registration');

        console.log(`✓ New user registered: ${email}`);

        res.json({
            success: true,
            token,
            user: {
                id: userRecord.id,
                email: userRecord.email,
                name: userRecord.full_name
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

        // Verify password (supports both bcrypt and legacy hashes)
        const storedHash = user.password_hash;
        const passwordValid = await verifyPassword(password, storedHash);
        if (!passwordValid) {
            await logAccess(user.id, 'Login Failure', req, null, 'Invalid password');
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Create new JWT token
        const token = generateToken();
        const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const tokenRecord = await createToken(user.id, token, expirationDate.toISOString(), getDeviceInfo(req));

        // Update last login
        if (supabase) {
            await supabase
                .from('auth_users')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', user.id);
        }

        // Log successful login
        await logAccess(user.id, 'Login Success', req, tokenRecord.id);

        console.log(`✓ User logged in: ${email}`);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.full_name
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
        await revokeToken(req.tokenId);

        // Log logout
        await logAccess(req.userId, 'Logout', req, req.tokenId);

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
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f04a30;">Reset Your Password</h2>
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
    `;

    // Use Resend API
    if (useResend) {
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: EMAIL_FROM,
                    to: [email],
                    subject: 'Reset Your HelmetPulse Password',
                    html: htmlContent
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Resend API error');
            }

            console.log(`✓ Reset email sent to ${email} (Resend)`);
            return true;
        } catch (error) {
            console.error('Failed to send reset email (Resend):', error);
            return false;
        }
    }

    // Use Nodemailer SMTP
    if (emailTransporter) {
        try {
            await emailTransporter.sendMail({
                from: EMAIL_FROM,
                to: email,
                subject: 'Reset Your HelmetPulse Password',
                html: htmlContent
            });
            console.log(`✓ Reset email sent to ${email} (SMTP)`);
            return true;
        } catch (error) {
            console.error('Failed to send reset email (SMTP):', error);
            return false;
        }
    }

    // No email configured
    console.log(`⚠ Email not configured - Reset code for ${email}: ${resetToken}`);
    return false;
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

        // Generate reset token (6 cryptographically secure random digits)
        const resetToken = crypto.randomInt(100000, 999999).toString();
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store reset token in user record
        if (supabase) {
            await supabase
                .from('auth_users')
                .update({
                    reset_token: resetToken,
                    reset_token_expires: resetExpires.toISOString()
                })
                .eq('id', user.id);
        }

        // Log the reset request
        await logAccess(user.id, 'Password Reset Requested', req, null, `Reset token generated for ${email}`);

        // Send email with reset token
        const userName = user.full_name;
        await sendResetEmail(email, resetToken, userName);

        const response = {
            success: true,
            message: 'If that email exists, a reset code has been sent to your email'
        };

        // Include debug token only if NO email is configured (for local testing only)
        if (!emailTransporter && !useResend) {
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

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const user = await findUserByEmail(email);

        if (!user) {
            return res.status(400).json({ error: 'Invalid reset token' });
        }

        // Verify token and expiration
        const storedToken = user.reset_token;
        const expiresAt = user.reset_token_expires ? new Date(user.reset_token_expires) : null;

        if (!storedToken || storedToken !== token) {
            await logAccess(user.id, 'Password Reset Failed', req, null, 'Invalid token');
            return res.status(400).json({ error: 'Invalid reset token' });
        }

        if (!expiresAt || expiresAt < new Date()) {
            await logAccess(user.id, 'Password Reset Failed', req, null, 'Expired token');
            return res.status(400).json({ error: 'Reset token has expired' });
        }

        // Hash new password with bcrypt
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update password and clear reset token
        if (supabase) {
            await supabase
                .from('auth_users')
                .update({
                    password_hash: hashedPassword,
                    reset_token: null,
                    reset_token_expires: null
                })
                .eq('id', user.id);
        }

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
            email: req.user.email,
            name: req.user.full_name
        }
    });
});

// ============================================
// WATCHLIST ENDPOINTS
// ============================================

// Get user's watchlist
app.get('/api/watchlist', authenticateToken, async (req, res) => {
    try {
        const watchlist = await getUserWatchlist(req.userId);
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

        // Save to Supabase
        await saveUserWatchlist(req.userId, watchlist);

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
        const watchlist = await getUserWatchlist(req.userId);

        if (watchlist.length >= 10) {
            return res.status(400).json({ error: 'Maximum 10 cards allowed' });
        }

        // Add card
        card.id = card.id || Date.now();
        card.addedAt = new Date().toISOString();
        watchlist.push(card);

        // Save to Supabase
        await saveUserWatchlist(req.userId, watchlist);

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

        let watchlist = await getUserWatchlist(req.userId);
        watchlist = watchlist.filter(c => c.id !== cardId);

        await saveUserWatchlist(req.userId, watchlist);

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

        // Search helmets by player name - now includes current_price directly
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type, design_type, current_price')
            .or(`player.ilike.%${query}%,name.ilike.%${query}%`)
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
                    designType: h.design_type,
                    prices: h.current_price ? [h.current_price] : []
                });
            } else {
                groupedMap.get(key).ids.push(h.id);
                if (h.current_price) {
                    groupedMap.get(key).prices.push(h.current_price);
                }
            }
        }

        // Build suggestions using stored current_price (no extra queries needed)
        const suggestions = [];
        for (const [key, group] of groupedMap) {
            // Calculate median of group prices (if multiple helmets in group)
            let medianPrice = null;
            if (group.prices.length > 0) {
                group.prices.sort((a, b) => a - b);
                const mid = Math.floor(group.prices.length / 2);
                medianPrice = group.prices.length % 2 === 0
                    ? (group.prices[mid - 1] + group.prices[mid]) / 2
                    : group.prices[mid];
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
                priceCount: group.prices.length
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

        // Get the helmet info with current_price directly
        const { data: helmet, error: helmetError } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type, current_price')
            .eq('id', helmetId)
            .single();

        if (helmetError || !helmet) {
            return res.status(404).json({ error: 'Helmet not found' });
        }

        // Return the stored median price directly
        if (!helmet.current_price) {
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

        res.json({
            helmet,
            medianPrice: helmet.current_price,
            minPrice: null,
            maxPrice: null,
            totalResults: 1,
            source: 'database',
            priceCount: 1
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

        // Get current_price directly from helmets table
        const { data: helmets, error: helmetError } = await supabase
            .from('helmets')
            .select('id, current_price')
            .in('id', ids);

        if (helmetError) {
            console.error('Helmet fetch error:', helmetError);
            return res.status(500).json({ error: 'Failed to fetch helmets' });
        }

        // Collect all prices and calculate median
        const allPrices = (helmets || [])
            .map(h => h.current_price)
            .filter(p => p !== null && p > 0);

        if (allPrices.length === 0) {
            return res.json({
                medianPrice: null,
                minPrice: null,
                maxPrice: null,
                totalResults: 0,
                source: 'database',
                message: 'No price data available'
            });
        }

        // Calculate median of all helmet prices
        allPrices.sort((a, b) => a - b);
        const mid = Math.floor(allPrices.length / 2);
        const medianPrice = allPrices.length % 2 === 0
            ? (allPrices[mid - 1] + allPrices[mid]) / 2
            : allPrices[mid];

        res.json({
            medianPrice,
            minPrice: null,
            maxPrice: null,
            totalResults: allPrices.length,
            source: 'database',
            priceCount: allPrices.length
        });
    } catch (error) {
        console.error('Grouped prices error:', error);
        res.status(500).json({ error: 'Failed to get grouped prices' });
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        supabaseConfigured: !!supabase,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   📈 CardPulse Server (Supabase Edition)                      ║
╠═══════════════════════════════════════════════════════════════╣
║   Local:      http://localhost:${PORT}                          ║
║   Health:     http://localhost:${PORT}/health                   ║
║   Supabase:   ${supabase ? '✓ Connected (Auth + Data)' : '✗ Not configured'}                       ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});
