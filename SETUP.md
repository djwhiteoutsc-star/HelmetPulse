# HelmetPulse Setup Guide 🏈

Complete setup instructions for your automated helmet price tracking system.

## 🎯 Overview

Your system will:
- ✅ Auto-discover 500-2000 helmets from eBay (one-time)
- ✅ Auto-update all prices monthly via GitHub Actions
- ✅ Store all data in Supabase (PostgreSQL)
- ✅ Track price history over time
- ✅ Zero manual data entry required

---

## 📋 Step 1: Setup Database

### 1.1 Run SQL Migration

1. Go to your Supabase project: https://supabase.com/dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the contents of `supabase/migrations/001_initial_schema.sql`
5. Paste into the SQL Editor
6. Click **Run** (or press Ctrl+Enter)

You should see: `Success. No rows returned`

---

## 📦 Step 2: Install Dependencies

Open terminal in the project folder:

```bash
npm install
```

This installs:
- Puppeteer (eBay scraping)
- Supabase client
- Express server
- All other dependencies

---

## 🔐 Step 3: Setup GitHub Secrets

### 3.1 Add Secrets to GitHub

1. Go to your repo: https://github.com/djwhiteoutsc-star/HelmetPulse
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add these 3 secrets:

**Secret 1:**
- Name: `SUPABASE_URL`
- Value: `https://khsnglldjzwustabsqls.supabase.co`

**Secret 2:**
- Name: `SUPABASE_KEY`
- Value: (Get from Supabase → Settings → API → anon public key)

**Secret 3:**
- Name: `DATABASE_URL`
- Value: `postgresql://postgres:9OkFcwV558A34hpp@db.khsnglldjzwustabsqls.supabase.co:5432/postgres`

---

## 🚀 Step 4: Initial Helmet Discovery

Run the discovery script **once** to populate your database:

```bash
npm run discover
```

This will:
- Scrape eBay for 500-2000 autographed helmet listings
- Parse player names, teams, helmet types, designs
- Save all helmets to Supabase
- Fetch initial prices for each helmet
- **Takes 30-60 minutes** (includes rate limiting)

**What you'll see:**
```
🚀 Starting helmet discovery...

🔍 Searching: NFL autographed helmet signed
   Found 47 helmets

🔍 Searching: Patrick Mahomes signed helmet
   Found 23 helmets

✅ Discovered 487 unique helmets

💾 Saving to database and fetching initial prices...
   📊 Fetching price for: Patrick Mahomes (Chiefs)
   ✅ Updated: $1249.99 (9 sales)

✅ Saved 487 new helmets to database!
🎉 Discovery complete!
```

---

## 🔄 Step 5: Enable Monthly Auto-Updates

### 5.1 Verify GitHub Actions

1. Go to: https://github.com/djwhiteoutsc-star/HelmetPulse/actions
2. You should see: **Monthly Helmet Price Update**
3. Click it, then click **Run workflow** to test manually
4. Wait 5-10 minutes, it should succeed

### 5.2 How It Works

- **Runs automatically** on the 1st of every month at 2:00 AM UTC
- Updates all helmet prices in database
- Creates new price snapshots (keeps history)
- 100% automated, no maintenance needed

### 5.3 Manual Update (Optional)

To manually update prices anytime:

```bash
npm run update-prices
```

---

## 🌐 Step 6: Frontend Setup (Coming Next)

Your frontend (index.html) will be updated to:
- Connect to Supabase instead of localhost
- Query helmet data from database
- Show real-time prices
- Display price history/trends

---

## 📊 Step 7: Verify Everything Works

### 7.1 Check Database

Go to Supabase → Table Editor:

**Check `helmets` table:**
- Should have 400-500+ rows
- Each helmet has: name, player, team, helmet_type, design_type

**Check `helmet_prices` table:**
- Should have same number of rows as helmets
- Each has: median_price, min_price, max_price, total_results

### 7.2 Query Example

In Supabase SQL Editor, run:

```sql
SELECT
  h.name,
  h.player,
  h.team,
  hp.median_price,
  hp.total_results,
  hp.scraped_at
FROM helmets h
JOIN helmet_prices hp ON h.id = hp.helmet_id
ORDER BY hp.median_price DESC
LIMIT 10;
```

This shows your 10 most expensive helmets!

---

## 🛠️ Troubleshooting

### Discovery Script Issues

**Problem:** "Error: net::ERR_ABORTED"
- **Solution:** eBay is blocking your IP. Wait 10 minutes and try again.

**Problem:** "No helmets discovered"
- **Solution:** Check your internet connection. eBay might be temporarily down.

### GitHub Actions Issues

**Problem:** "Error: Missing required secret"
- **Solution:** Double-check all 3 secrets are added correctly in GitHub Settings

**Problem:** "npm ci failed"
- **Solution:** Delete `package-lock.json` and run `npm install` locally first

### Database Issues

**Problem:** "relation does not exist"
- **Solution:** Re-run the SQL migration in Step 1.1

---

## 📅 Maintenance Schedule

✅ **Monthly (Automatic):**
- GitHub Actions updates all prices on 1st of month
- No action needed from you

✅ **Quarterly (Optional):**
- Run discovery script again to find new helmets
- New players / rookie seasons / new designs

✅ **Never:**
- No manual data entry required!

---

## 🎉 You're Done!

Your automated helmet tracking system is now live! The database will grow and update automatically forever.

Next step: Update the frontend to display this data beautifully!
