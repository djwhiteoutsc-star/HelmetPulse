# Email Setup Guide for HelmetPulse

Password reset emails are now configured and ready to use. Follow these steps to enable email sending:

## 1. Choose an Email Provider

### Option A: Gmail (Easiest for Testing)
1. Go to your Google Account settings
2. Enable 2-Factor Authentication
3. Generate an App Password:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Name it "HelmetPulse"
   - Copy the 16-character password

### Option B: SendGrid (Best for Production)
1. Sign up at https://sendgrid.com (free tier: 100 emails/day)
2. Create an API key with "Mail Send" permissions
3. Verify your sender email address

### Option C: Amazon SES (Most Scalable)
1. Sign up for AWS SES
2. Verify your domain or email
3. Get SMTP credentials from SES console

## 2. Add Environment Variables

Add these to your `.env` file:

### For Gmail:
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-16-char-app-password
EMAIL_FROM=HelmetPulse <your-email@gmail.com>
```

### For SendGrid:
```env
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=your-sendgrid-api-key
EMAIL_FROM=HelmetPulse <noreply@yourdomain.com>
```

### For Amazon SES:
```env
EMAIL_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_PORT=587
EMAIL_USER=your-smtp-username
EMAIL_PASS=your-smtp-password
EMAIL_FROM=HelmetPulse <verified@yourdomain.com>
```

## 3. Add to Render Dashboard

If deploying on Render:
1. Go to your Render dashboard
2. Select your service
3. Go to "Environment" tab
4. Add each variable:
   - `EMAIL_HOST`
   - `EMAIL_PORT`
   - `EMAIL_USER`
   - `EMAIL_PASS`
   - `EMAIL_FROM`

## 4. Restart the Server

After adding environment variables:
- **Local**: Restart `npm start` or `npm run dev`
- **Render**: Will auto-deploy when you push to GitHub

## 5. Test Password Reset

1. Go to your app and click "Forgot password?"
2. Enter your email
3. Check your inbox for the 6-digit code
4. Enter the code and set a new password

## Troubleshooting

### Emails not sending?
- Check server logs for email configuration status
- Verify all environment variables are set correctly
- Check spam folder
- For Gmail: Ensure 2FA is enabled and you're using App Password (not regular password)

### Still showing debug token?
- This means email is not configured
- Server will log: `⚠ Email not configured - password reset codes will be logged only`
- Add the environment variables above

### "Authentication failed" errors?
- Double-check EMAIL_USER and EMAIL_PASS
- For Gmail: Use App Password, not account password
- For SendGrid: Use "apikey" as username (literally)

## Current Behavior

- **Email configured**: Reset codes sent via email
- **Email NOT configured**: Reset codes logged to console (shown in API response for testing)

## Security Notes

- Reset codes expire after 1 hour
- Codes are 6 random digits
- Failed attempts are logged
- Doesn't reveal if email exists (security best practice)
