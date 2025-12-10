# HelmetPulse Scripts

## 🚀 Quick Reference Commands

```bash
# ═══════════════════════════════════════════════════════════
# IMPORT NEW HELMETS (from retail sources)
# ═══════════════════════════════════════════════════════════

npm run import radtke              # Import from Radtke Sports (~3000 helmets)
npm run import rsa                 # Import from Shop RSA (~1400 helmets)
npm run import fanatics            # Import from Fanatics Excel file
npm run import all                 # Run ALL importers sequentially
npm run import status              # View database statistics

# Use cached data (skip scraping - much faster!)
npm run import:radtke -- --use-cache
npm run import:rsa -- --use-cache

# ═══════════════════════════════════════════════════════════
# EBAY SOLD PRICES (market values)
# ═══════════════════════════════════════════════════════════

npm run ebay:update                # Update helmets without recent prices
npm run ebay:all                   # Update ALL helmets (slow - ~2hrs)
npm run ebay:update -- --limit=50  # Update only 50 helmets
npm run ebay:update -- --team=Cowboys  # Update only Cowboys helmets
npm run ebay:update -- --days=30   # Update prices older than 30 days

# ═══════════════════════════════════════════════════════════
# DATABASE MAINTENANCE
# ═══════════════════════════════════════════════════════════

npm run db:check                   # Check database consistency
npm run db:fix                     # Fix common database issues
```

---

## 📦 Import Sources

### 1. Radtke Sports
```bash
npm run import radtke
npm run import:radtke -- --use-cache   # Use cached data
```
- **URL**: https://www.radtkesports.com/?s=helmet&product_cat=0&post_type=product
- **Method**: Puppeteer web scraping (65 pages, ~2 minutes)
- **Products**: ~3,000 helmets
- **Cache file**: `scripts/radtke-cache.json`

### 2. Shop RSA
```bash
npm run import rsa
npm run import:rsa -- --use-cache      # Use cached data
```
- **URL**: https://www.shoprsa.com/collections/signed-nfl-football-helmets
- **Method**: Shopify JSON API (fast! ~30 seconds)
- **Products**: ~1,400 helmets
- **Cache file**: `scripts/rsa-cache.json`

### 3. Fanatics
```bash
npm run import fanatics
```
- **File**: `Fanatics/Inventory *.xls` (most recent)
- **Method**: Excel file parsing
- **Products**: Varies by inventory file

### 4. Run All Sources
```bash
npm run import all                 # Fresh scrape from all sources
npm run import all -- --use-cache  # Use cached data for all
```

---

## 💰 eBay Sold Listings (Market Values)

Unlike the import sources above (which add NEW helmets with retail prices), eBay scraping updates **existing helmets** with actual sold prices.

```bash
npm run ebay:update                # Update stale prices (default: >7 days old)
npm run ebay:update -- --limit=100 # Update only 100 helmets
npm run ebay:update -- --team=Cowboys  # Update specific team
npm run ebay:update -- --days=30   # Update prices older than 30 days
npm run ebay:all                   # Update ALL helmets (2851 = ~2.5 hours!)
```

**How it works:**
1. Finds helmets needing price updates (no recent eBay price)
2. Searches eBay sold listings using helmet's `ebay_search_query`
3. Extracts sold prices, calculates median/min/max
4. Updates `helmet_prices` table with source='ebay'

**Rate limiting:** 2.5 seconds between requests to avoid blocking.

---

## 📊 Check Database Status

```bash
npm run import status
```

Shows:
- Total helmet count
- Prices by source (eBay, Fanatics, RSA, Radtke)
- Helmet type distribution
- Top teams

---

## 🔄 How Imports Work

Each import script:

1. **Scrapes/Fetches** data from the source
2. **Caches** raw data to `scripts/<source>-cache.json`
3. **Validates** each record:
   - Extracts player name
   - Identifies NFL team
   - Parses helmet type (mini, midi, fullsize-authentic, etc.)
   - Parses design type (regular, flash, rave, eclipse, etc.)
   - Validates price range ($0-$50,000)
4. **Deduplicates** by player+team+type+design
5. **Imports** new helmets to database
6. **Updates** prices for existing helmets

---

## 🔧 Core Utilities

### `lib/price-utils.js`
Unified price management module. **All import scripts MUST use these functions.**

**Key functions:**
- `upsertPrice(helmetId, source, price, options)` - Add/update a price
- `findHelmet(player, team, helmetType, designType)` - Find helmet with flexible matching
- `getPriceStats()` - Get price statistics by source
- `validateSchema()` - Validate database schema

**Valid price sources:** `ebay`, `fanatics`, `rsa`, `radtke`, `pristine`

---

## 📁 File Structure

```
scripts/
├── import.js                      # Master import controller
├── import-radtke-all.js           # Radtke Sports importer
├── import-rsa-all.js              # Shop RSA importer
├── import-fanatics-inventory.js   # Fanatics Excel importer
├── radtke-cache.json              # Cached Radtke data
├── rsa-cache.json                 # Cached RSA data
├── check-database-consistency.js  # DB health check
├── fix-database-issues.js         # DB cleanup
├── lib/
│   └── price-utils.js             # Shared price utilities
└── README.md                      # This file
```

---

## 🗄️ Database Schema

### helmets table
| Column | Type | Description |
|--------|------|-------------|
| id | int | Primary key |
| name | text | Full product name |
| player | text | Player name |
| team | text | NFL team |
| helmet_type | text | mini, midi, fullsize-authentic, fullsize-replica, fullsize-speedflex |
| design_type | text | regular, flash, rave, eclipse, lunar-eclipse, chrome, etc. |
| auth_company | text | JSA, Beckett, Fanatics, PSA/DNA |
| ebay_search_query | text | **Unique** search query for eBay |
| is_active | bool | Active in database |

### helmet_prices table
| Column | Type | Description |
|--------|------|-------------|
| helmet_id | int | Foreign key to helmets |
| source | text | ebay, fanatics, rsa, radtke, pristine |
| median_price | decimal | The price |
| min_price | decimal | Minimum price |
| max_price | decimal | Maximum price |
| total_results | int | Number of results found |
| scraped_at | timestamp | When price was fetched |

---

## 🐛 Troubleshooting

### "duplicate key value violates unique constraint"
The `ebay_search_query` must be unique. Each import generates queries like:
```
"player team helmettype designtype autographed helmet"
```
This is normal - it means the helmet already exists. The script will update prices for existing helmets.

### Supabase 1000 row limit
Scripts fetch ALL records using pagination to avoid the default 1000 row limit. This was fixed in December 2024.

### Scraping blocked / slow
Radtke uses Puppeteer with delays between pages. If blocked:
- Use `--use-cache` to skip scraping
- Increase sleep time in `import-radtke-all.js`

### Missing prices after import
Run `npm run import status` to verify. Check that:
1. The source is in the valid sources list
2. The price was valid (> $0 and < $50,000)
3. The player name was successfully extracted

---

## ➕ Adding New Sources

1. Create `scripts/import-<source>-all.js` following existing patterns
2. Add to `SOURCES` object in `scripts/import.js`:
   ```javascript
   newsource: {
       script: 'import-newsource-all.js',
       description: 'Description here',
       url: 'https://...'
   }
   ```
3. Add npm script to `package.json`:
   ```json
   "import:newsource": "node scripts/import-newsource-all.js"
   ```
4. Use `lib/price-utils.js` for database operations
5. Update this README

---

## 📝 Workflow Checklist

### Regular Import (Weekly/Monthly)
```bash
# 1. Check current status
npm run import status

# 2. Run imports (use cache if recent)
npm run import all

# 3. Verify results
npm run import status
npm run db:check
```

### After Adding New Source
```bash
# 1. Test the import
npm run import newsource

# 2. Check for issues
npm run db:check

# 3. Fix any issues
npm run db:fix
```

---

## 🔐 Environment Variables

Required in `.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```
