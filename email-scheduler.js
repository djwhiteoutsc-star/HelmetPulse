/**
 * CardPulse Email Scheduler
 * 
 * Sends weekly price alert emails to subscribers.
 * Run this as a separate process or use a cron job.
 * 
 * SETUP:
 * 1. Set up environment variables for email (see below)
 * 2. Run: node email-scheduler.js
 * 
 * For production, use a service like:
 * - SendGrid
 * - Mailgun  
 * - AWS SES
 * - Postmark
 */

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const fs = require('fs');
const axios = require('axios');

// Configuration - Set these via environment variables in production
const CONFIG = {
    // Email settings (example using Gmail - use proper service in production)
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: process.env.SMTP_PORT || 587,
    SMTP_USER: process.env.SMTP_USER || 'your-email@gmail.com',
    SMTP_PASS: process.env.SMTP_PASS || 'your-app-password',
    FROM_EMAIL: process.env.FROM_EMAIL || 'alerts@cardpulse.app',
    FROM_NAME: process.env.FROM_NAME || 'CardPulse',
    
    // Server URL for price lookups
    API_URL: process.env.API_URL || 'http://localhost:3000',
    
    // Subscribers file (use a database in production)
    SUBSCRIBERS_FILE: './subscribers.json'
};

// Create email transporter
const transporter = nodemailer.createTransport({
    host: CONFIG.SMTP_HOST,
    port: CONFIG.SMTP_PORT,
    secure: false,
    auth: {
        user: CONFIG.SMTP_USER,
        pass: CONFIG.SMTP_PASS
    }
});

/**
 * Load subscribers from file
 * In production, this would query a database
 */
function loadSubscribers() {
    try {
        if (fs.existsSync(CONFIG.SUBSCRIBERS_FILE)) {
            const data = fs.readFileSync(CONFIG.SUBSCRIBERS_FILE, 'utf8');
            return data.split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line));
        }
    } catch (error) {
        console.error('Error loading subscribers:', error.message);
    }
    return [];
}

/**
 * Fetch current prices for a card
 */
async function fetchCardPrice(card) {
    try {
        const response = await axios.post(`${CONFIG.API_URL}/api/prices`, {
            query: card.query || card.name,
            category: card.category,
            condition: card.condition
        }, { timeout: 15000 });
        
        return response.data;
    } catch (error) {
        console.error(`Error fetching price for ${card.name}:`, error.message);
        return null;
    }
}

/**
 * Generate HTML email for a subscriber
 */
function generateEmailHTML(subscriber, priceUpdates) {
    const cardRows = priceUpdates.map(update => {
        if (!update.data) {
            return `
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #eee;">${update.card.name}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee; color: #999;">Unable to fetch</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee;">—</td>
                    <td style="padding: 12px; border-bottom: 1px solid #eee;">—</td>
                </tr>
            `;
        }

        const currentPrice = update.data.averagePrice;
        const lastPrice = update.card.lastPrice;
        let changeHTML = '<span style="color: #666;">—</span>';
        
        if (currentPrice && lastPrice) {
            const change = ((currentPrice - lastPrice) / lastPrice) * 100;
            const color = change > 0 ? '#22c55e' : change < 0 ? '#ef4444' : '#666';
            const sign = change > 0 ? '+' : '';
            changeHTML = `<span style="color: ${color}; font-weight: bold;">${sign}${change.toFixed(1)}%</span>`;
        }

        return `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #eee;">
                    <strong>${update.card.name}</strong><br>
                    <small style="color: #666;">${update.card.category}</small>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 16px;">
                    ${currentPrice ? '$' + currentPrice.toFixed(2) : '—'}
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #eee;">
                    ${changeHTML}
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #eee;">
                    <a href="${update.data?.ebayUrl || '#'}" style="color: #f59e0b; text-decoration: none;">View Comps →</a>
                </td>
            </tr>
        `;
    }).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0a0a0b 0%, #1a1a1f 100%); border-radius: 12px 12px 0 0; padding: 30px; text-align: center;">
            <h1 style="margin: 0; color: #fbbf24; font-size: 28px;">📈 CardPulse</h1>
            <p style="margin: 10px 0 0; color: #a1a1aa;">Weekly Price Alert</p>
        </div>
        
        <!-- Content -->
        <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px;">
            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">
                Here's your weekly update for <strong>${priceUpdates.length} cards</strong> in your watchlist:
            </p>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background: #f9fafb;">
                        <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Card</th>
                        <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Avg Price</th>
                        <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Change</th>
                        <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">eBay</th>
                    </tr>
                </thead>
                <tbody>
                    ${cardRows}
                </tbody>
            </table>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
                Prices are based on recent eBay sold listings. 
                <a href="#" style="color: #f59e0b;">Manage your watchlist →</a>
            </p>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
            <p>CardPulse — Track your card values</p>
            <p><a href="#" style="color: #999;">Unsubscribe</a></p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Send weekly alerts to all subscribers
 */
async function sendWeeklyAlerts() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📧 Starting weekly email alerts - ${new Date().toISOString()}`);
    console.log(`${'='.repeat(50)}\n`);

    const subscribers = loadSubscribers();
    console.log(`Found ${subscribers.length} subscribers`);

    for (const subscriber of subscribers) {
        try {
            console.log(`\nProcessing: ${subscriber.email}`);
            
            if (!subscriber.watchlist || subscriber.watchlist.length === 0) {
                console.log('  → No cards in watchlist, skipping');
                continue;
            }

            // Fetch prices for all cards
            const priceUpdates = [];
            for (const card of subscriber.watchlist) {
                console.log(`  → Fetching: ${card.name}`);
                const data = await fetchCardPrice(card);
                priceUpdates.push({ card, data });
                
                // Rate limit between requests
                await new Promise(r => setTimeout(r, 2000));
            }

            // Generate and send email
            const html = generateEmailHTML(subscriber, priceUpdates);
            
            await transporter.sendMail({
                from: `"${CONFIG.FROM_NAME}" <${CONFIG.FROM_EMAIL}>`,
                to: subscriber.email,
                subject: `📈 Your Weekly Card Price Update`,
                html: html
            });

            console.log(`  ✅ Email sent to ${subscriber.email}`);

        } catch (error) {
            console.error(`  ❌ Error processing ${subscriber.email}:`, error.message);
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Weekly alerts complete`);
    console.log(`${'='.repeat(50)}\n`);
}

// Schedule weekly emails - Every Sunday at 9 AM
cron.schedule('0 9 * * 0', () => {
    console.log('⏰ Cron triggered: Sunday 9 AM');
    sendWeeklyAlerts();
}, {
    timezone: "America/New_York"
});

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   📬 CardPulse Email Scheduler                            ║
║                                                           ║
║   Schedule: Every Sunday at 9:00 AM (Eastern)             ║
║                                                           ║
║   To test manually, run:                                  ║
║   node -e "require('./email-scheduler').sendWeeklyAlerts()"
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

// Export for manual testing
module.exports = { sendWeeklyAlerts };
