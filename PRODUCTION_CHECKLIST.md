# HelmetPulse - Production Deployment Checklist

## ✅ Already Done
- [x] Code pushed to GitHub
- [x] Render auto-deployment configured
- [x] Supabase database with 2,627 helmets
- [x] 7,764 prices from trusted sources (Radtke, RSA, Denver, Fanatics)
- [x] eBay removed (no fake listings)
- [x] Authentication system (Airtable)
- [x] Password reset functionality
- [x] Mobile-responsive design
- [x] Disclaimer footer

## 🔧 Production Setup Required

### 1. Airtable Setup (Required)

Your Airtable base needs these tables and fields:

**Table: Users**
- Email Address (email)
- Password Hash (single line text)
- Full Name (single line text)
- Watchlist (long text)
- Created At (date)
- Last Login (date)
- Reset Token (single line text) ← **NEW - Add this**
- Reset Token Expires (date) ← **NEW - Add this**

**Table: JWT Tokens**
- User (link to Users)
- Token Hash (single line text)
- Expires At (date)
- Revoked (checkbox)
- Created At (date)

**Table: Access Logs**
- User (link to Users)
- Action (single select: Login Success, Login Failure, Logout, Password Reset Requested, etc.)
- IP Address (single line text)
- User Agent (long text)
- JWT Token (link to JWT Tokens)
- Notes (long text)
- Timestamp (date)

### 2. Environment Variables on Render

Go to your Render dashboard → Environment tab and add:

**Database (Already Set?):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
```

**Authentication (Required):**
```
AIRTABLE_API_KEY=your-airtable-api-key
AIRTABLE_BASE_ID=your-base-id
JWT_SECRET=your-random-secret-here
```

**Email (Required for Password Reset):**
Choose one option from EMAIL_SETUP.md:
```
EMAIL_HOST=smtp.gmail.com (or smtp.sendgrid.net)
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=HelmetPulse <noreply@helmetpulse.com>
```

**Optional (for future features):**
```
ANTHROPIC_API_KEY=your-anthropic-key (for AI features)
```

### 3. Email Configuration

**Recommended: SendGrid (Production)**
1. Sign up: https://sendgrid.com
2. Verify your domain (or use Single Sender Verification)
3. Create API key with "Mail Send" permission
4. Add to Render environment variables

**Alternative: Gmail (Quick Start)**
1. Enable 2FA on Google Account
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use Gmail SMTP settings (see EMAIL_SETUP.md)

### 4. DNS & Domain (Optional)

If using custom domain:
1. Point your domain to Render
2. Add custom domain in Render dashboard
3. Update EMAIL_FROM to use your domain

### 5. Security Checklist

- [ ] All environment variables set on Render (no secrets in code)
- [ ] JWT_SECRET is random and secure (use: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] Email configured (test password reset)
- [ ] HTTPS enabled (Render does this automatically)
- [ ] Rate limiting active (already in code)
- [ ] CORS configured for your domain

### 6. Testing Before Going Live

**Test Authentication:**
- [ ] Register new account
- [ ] Log in with account
- [ ] Log out
- [ ] Test forgot password flow
- [ ] Verify email received with reset code
- [ ] Reset password successfully

**Test Core Features:**
- [ ] Search for helmets (autocomplete works)
- [ ] Add helmet to watchlist
- [ ] Prices display correctly
- [ ] Refresh works (5-minute cooldown)
- [ ] Delete helmet from watchlist
- [ ] Export to CSV works

**Test on Devices:**
- [ ] Desktop (Chrome, Firefox, Safari)
- [ ] Mobile (iPhone, Android)
- [ ] Tablet
- [ ] Different screen sizes

**Test Edge Cases:**
- [ ] Add 10 helmets (max limit)
- [ ] Try to add 11th helmet (should show error)
- [ ] Search for non-existent helmet
- [ ] Test with slow internet
- [ ] Logout and verify data persists on login

## 🚀 Go Live Steps

1. **Verify Render is running:**
   - Check Render dashboard
   - Visit your `.onrender.com` URL
   - Check logs for errors

2. **Test the production site:**
   - Go through testing checklist above
   - Create test account
   - Add test helmets
   - Test all features

3. **Set up monitoring (Optional but recommended):**
   - Set up UptimeRobot (free) for uptime monitoring
   - Enable Render email notifications for crashes
   - Monitor Airtable API usage

4. **Launch checklist:**
   - [ ] All environment variables configured
   - [ ] Email sending works
   - [ ] Airtable tables created with correct fields
   - [ ] Database has helmet data (2,627 helmets ✓)
   - [ ] All tests passed
   - [ ] No console errors in browser
   - [ ] Mobile responsive
   - [ ] Password reset works

## 📊 Post-Launch

**Monitor:**
- Render logs for errors
- Airtable API usage (5 requests/sec limit)
- Email sending (SendGrid free tier: 100/day)
- User signups
- Watchlist activity

**Backup:**
- Airtable automatically backs up (7 day snapshots on free tier)
- Supabase has automatic backups
- Export user data weekly (optional)

## 🆘 Troubleshooting

**"Email not configured" in logs:**
- Add EMAIL_* environment variables to Render
- Restart service

**"Authentication failed":**
- Check AIRTABLE_API_KEY and AIRTABLE_BASE_ID
- Verify Airtable tables exist with correct field names

**"Database error":**
- Check SUPABASE_URL and SUPABASE_KEY
- Verify tables exist in Supabase

**Render sleeping (free tier):**
- Free tier sleeps after 15 min inactivity
- First request takes 30-60 seconds to wake up
- Upgrade to paid tier ($7/mo) for always-on

## 💰 Costs

**Current Setup (All Free):**
- Render: Free tier (sleeps after inactivity)
- Supabase: Free tier (500MB database, 2GB bandwidth)
- Airtable: Free tier (1,200 records per base)
- SendGrid: Free tier (100 emails/day)
- **Total: $0/month**

**Recommended Paid Upgrades:**
- Render Starter: $7/mo (always-on, custom domain)
- SendGrid Essentials: $20/mo (40K emails)
- Airtable Plus: $20/mo (50K records, 6 month history)

## ✅ You're Ready When:

1. All environment variables are set on Render
2. Email sends successfully (test forgot password)
3. You can create account, add helmets, and see prices
4. Mobile site works smoothly
5. No errors in Render logs
6. Airtable tables have all required fields

---

**Next Step:** Add the 2 new Airtable fields (Reset Token, Reset Token Expires) and configure email on Render!
