# Sawbuck Manual Testing Checklist

Covers all user-facing flows for both admin and regular user accounts.

## Setup

- [ ] Deploy latest to production
- [ ] Have two accounts ready: one admin, one regular user
- [ ] Have a Craigslist furniture listing URL and an OfferUp listing URL ready for import testing
- [ ] Confirm FAL_KEY is set (for concept renders)
- [ ] Confirm eBay API credentials are set (for comparables, optional)

---

## Authentication

- [ ] Email/password sign-up creates a new account
- [ ] Email/password sign-in works for existing account
- [ ] Google OAuth sign-in works
- [ ] Invalid credentials show error message
- [ ] Password minimum 8 characters enforced
- [ ] Unauthenticated access redirects to /login
- [ ] Sign out works (from user menu in sidebar)

---

## As Admin

### Dashboard

- [ ] Listings display as cards in a grid
- [ ] "New" badge appears inline with platform badge on listings from last 6 hours
- [ ] Sort dropdown works: Newest, Price low to high, Price high to low
- [ ] Platform filter dropdown filters by CL/OfferUp/etc
- [ ] Max price filter limits results
- [ ] Clear filters button resets all filters
- [ ] Grid/map view toggle works
- [ ] Map view shows markers colored by deal score (green/yellow/gray)
- [ ] Map marker popups show listing preview with "View details" link
- [ ] Hovering a card shows X dismiss button in top-right of image
- [ ] Clicking X dismisses the card (removed from grid immediately)
- [ ] Dismissed listing is gone on page refresh (per-user)
- [ ] Infinite scroll loads more cards when scrolling to bottom
- [ ] Clicking a card navigates to listing detail

### Listings Page

**All Listings tab:**
- [ ] First batch loads on page load
- [ ] Scrolling to bottom triggers next batch (spinner, then more rows)
- [ ] "X of Y listings" appears when all loaded
- [ ] No pagination buttons visible (infinite scroll only)
- [ ] Platform filter works
- [ ] Status filter works
- [ ] Clear filters resets and reloads from top
- [ ] Sorting by column header works (title, platform, price, type, status)
- [ ] Sort direction toggles on repeated click
- [ ] Changing sort resets scroll position
- [ ] "New" badge on recently scraped listings
- [ ] Clicking a row navigates to listing detail
- [ ] Master checkbox selects/deselects all visible
- [ ] Individual checkboxes work

**Bulk Actions (when items selected):**
- [ ] Bulk Action Bar appears at bottom
- [ ] "Dismiss" button marks selected as dismissed
- [ ] "Set Watching" button marks selected as watching
- [ ] "Delete" button visible (admin only) and works
- [ ] "Deselect All" clears selection

**My Listings tab:**
- [ ] Shows only user-created listings
- [ ] "Post Listing" form opens
  - [ ] Title (required), description, price (required), location fields
  - [ ] Photo upload (required)
  - [ ] Submit creates listing
- [ ] Edit button opens inline edit form
- [ ] Delete button with confirmation dialog works

**Import:**
- [ ] Import button toggles URL input form
- [ ] Paste a Craigslist URL and submit
  - [ ] Listing creates immediately
  - [ ] Auto-analysis starts in background (check after ~30s)
  - [ ] Analysis results appear on refresh
- [ ] Paste an OfferUp URL and submit
  - [ ] Same auto-analyze behavior
- [ ] Duplicate import shows "already exists" message
- [ ] Invalid URL shows error

### Listing Detail

**Display:**
- [ ] Title, platform badge, location display correctly
- [ ] Asking price and deal score badge visible
- [ ] Images display in horizontal scroll row
- [ ] Description card shows listing description
- [ ] Analysis section shows furniture type, style, condition score, condition notes, wood species, confidence
- [ ] Species discrepancy note visible when seller claim differs from AI ID
- [ ] Matched search terms shown (if any)

**Analysis:**
- [ ] "Analyze" button appears for unanalyzed listings
- [ ] Clicking analyze shows polling spinner
- [ ] Cannot click analyze twice (guarded)
- [ ] Analysis results populate when complete
- [ ] Analysis error shows if failed
- [ ] RAG sources toggle shows/hides source references

**Refinishing Concepts:**
- [ ] Concept option cards display for qualified listings (3 cards: simple/moderate/full)
- [ ] Each card shows: difficulty badge, label, summary, time/materials/resale/profit estimates
- [ ] "AI Concept" badge overlays on rendered concept images
- [ ] Default selection matches user's experience level preference
- [ ] Clicking a concept highlights it (blue ring)
- [ ] Clicking loads the matching refinishing plan below
- [ ] Switching concepts clears old plan, shows loading spinner, loads new plan
- [ ] Switching back to previously viewed concept loads instantly (cached)
- [ ] Concept render placeholder shows "Generate concept" button if no image
  - [ ] Clicking generates the render (guarded against double-click)

**Plan Preview:**
- [ ] Plan displays below selected concept with steps, products, tips, estimates
- [ ] "Generate Refinishing Plan" button shows if no concepts exist
  - [ ] Generates concepts first, auto-selects moderate, shows plan
  - [ ] Shows spinner, disabled during generation
  - [ ] Cannot trigger twice
- [ ] "Select a refinishing option above" hint when concepts exist but none selected

**Actions:**
- [ ] "View Original" opens source URL in new tab
  - [ ] Click is tracked (verify in admin user metrics later)
- [ ] "Start Project" opens inline project creation form
  - [ ] Name and purchase price fields
  - [ ] "Create & Go to Project" navigates to project detail
- [ ] "Use this plan" on concept card creates project + generates plan + navigates
- [ ] "Dismiss" navigates back (per-user dismissal)

**Admin Section:**
- [ ] Separated from user actions by dashed border with "Admin" label
- [ ] "Delete Listing" button distinct styling (small, red)
- [ ] Confirmation dialog before delete

**Edit (own Sawbuck listings only):**
- [ ] Edit button toggles form
- [ ] Can edit title, description, price, location
- [ ] Save persists changes
- [ ] Delete with confirmation

### Projects Page

- [ ] Kanban board with 4 columns: Acquired, Refinishing, Listed, Sold
- [ ] Count badges on each column header
- [ ] Summary stats: active projects, total invested, total profit
- [ ] Project cards show image, name, purchase price, furniture type, profit, days in stage
- [ ] Clicking a card navigates to project detail

### Project Detail

**Status Flow:**
- [ ] "Start Refinishing" button (from Acquired)
- [ ] "Mark Listed" button (from Refinishing)
- [ ] "Mark Sold" button (from Listed)
- [ ] Status changes update the timeline and column on projects page
- [ ] Delete button with confirmation

**Overview Tab:**
- [ ] Details card: furniture type, style, purchase price, purchase date
- [ ] Purchase date shows readable format ("Apr 14, 2026")
- [ ] ROI Calculator shows cost breakdown and projected/actual profit
- [ ] Timeline shows stages with readable dates
- [ ] "Generate Refinishing Plan" button if no plans (also generates concepts)

**Plan Tab:**
- [ ] Concept cards at top (if concepts exist)
  - [ ] "AI Concept" badges on rendered images
  - [ ] Clicking a card with matching plan switches to that plan
  - [ ] Clicking a card without matching plan generates one (loading spinner)
  - [ ] Cannot click during generation
- [ ] Plan picker dropdown when multiple plans exist
- [ ] Plan display: style recommendation, description, steps with products/tips, estimates
- [ ] RAG sources toggle on plan

**Materials Tab:**
- [ ] Shopping list with product names, brands, quantities, prices
- [ ] Amazon/Home Depot/Lowes search links work
- [ ] Purchase status toggle works
- [ ] Actual price entry works

**Photos Tab:**
- [ ] Upload photo with type (Before/During/After) and optional caption
- [ ] Photos grouped by type
- [ ] Delete photo works (hover to reveal button)

**Financials Tab:**
- [ ] Can update: hours invested, hourly rate, listed price, sold price, selling fees, shipping cost
- [ ] ROI calculator updates with new values

**Export Listing Text:**
- [ ] "Export" button appears when project is in refinishing/listed/sold status
- [ ] Opens modal with generated listing copy
- [ ] Text sounds human (no em dashes, no "stunning"/"gorgeous" language)
- [ ] Can edit text in textarea
- [ ] "Regenerate" generates new text
- [ ] "Copy to Clipboard" works

### Analytics (Admin Only)

- [ ] Page loads with charts
- [ ] Deal flow over time chart
- [ ] Profit over time chart
- [ ] Deals by platform breakdown
- [ ] Price distribution chart
- [ ] Deal score distribution
- [ ] Status breakdown
- [ ] Top furniture types
- [ ] Flip times chart

### Settings

**Preferences tab (all users):**
- [ ] Location: latitude, longitude inputs, detect location button
- [ ] Search radius (miles)
- [ ] Max budget
- [ ] Shop space dropdown
- [ ] Experience level dropdown (beginner/intermediate/advanced)
  - [ ] Changing this affects default concept selection on listing detail
- [ ] Style preferences (multi-select pills)
- [ ] Save button persists all preferences

**Users tab (admin):**
- [ ] User list with name, email, role
- [ ] Metrics: "X projects, Y sold, Z clicks"
- [ ] Role dropdown to promote/demote (cannot demote self)
- [ ] Delete user button (cannot delete self)

**Platforms & Regions tab (admin):**
- [ ] Tab headers scroll horizontally on mobile (no vertical scroll)
- [ ] Platform toggles (CL, OfferUp on/off)
- [ ] Region list with name, coordinates, radius, CL subdomain
- [ ] Toggle regions on/off
- [ ] Add region form (name, lat, lng, radius, CL subdomain)
  - [ ] Radius field labeled "OfferUp search radius (mi)"
- [ ] Delete region with confirmation
- [ ] Changes during active run show "queued for next run" notice

**Agent Config tab (admin):**
- [ ] Section headers visually distinct from input labels
- [ ] Fields stack vertically on mobile
- [ ] Can edit: triage model, eval model, fal model, max triages, max evals, triage threshold, deal score threshold, run interval, target city, delays, daily cap, concept size, image retention
- [ ] No "Max concept renders" or "Concepts per listing" fields (removed)
- [ ] Save persists changes
- [ ] Reset individual fields to default

**Agent Runs tab (admin):**
- [ ] Pipeline visualization at top
  - [ ] Fan-out shows horizontal nodes per platform x region
  - [ ] Dispatch node shows "Xp x Yr"
  - [ ] No reconcile node in the graph
  - [ ] "Run Now" button in graph header
- [ ] Run Now triggers a pipeline run
  - [ ] New run appears with "running" status
  - [ ] Only the current stage node pulses (not all nodes)
  - [ ] Nodes light up green one by one as stages complete
  - [ ] Counts populate incrementally
  - [ ] Run completes with summary
- [ ] Stale runs from crashed processes show as "failed"
- [ ] Run timestamps readable ("Apr 14, 3:22 PM")
- [ ] Error details expandable for failed runs
- [ ] Polling every 5s during active runs (updates graph + run list)

---

## As Regular User

### Navigation
- [ ] Sidebar shows: Dashboard, Listings, Projects, Settings
- [ ] Analytics link NOT visible
- [ ] Navigating to /analytics redirects to /

### Dashboard
- [ ] Same agent-discovered listings visible as admin
- [ ] Dismiss works (per-user only)
- [ ] All filters, sort, map view, infinite scroll work

### Listings
- [ ] All features work same as admin except:
  - [ ] Bulk "Delete" button NOT visible in bulk action bar
  - [ ] Can still bulk dismiss and set watching

### Listing Detail
- [ ] All features work same as admin except:
  - [ ] NO admin section (no "Admin" label, no "Delete Listing")
- [ ] Can import, analyze, view concepts, preview plans, create projects, dismiss

### Settings
- [ ] Only "Preferences" tab visible (no Users, Platforms, Agent Config, Agent Runs)
- [ ] All preference fields work and save

### Projects
- [ ] Can only see own projects (not other users' projects)
- [ ] Full project lifecycle works

---

## Cross-User Verification

- [ ] Admin dismisses listing A from dashboard
- [ ] Regular user still sees listing A in their feed
- [ ] Regular user dismisses listing B
- [ ] Admin still sees listing B
- [ ] Agent pipeline "pass" verdict on listing C hides it globally (neither user sees it)
- [ ] Regular user creates project from listing D
- [ ] Admin cannot see that project in their projects page
- [ ] Both users can view the same agent-discovered listing detail

---

## Scraper Pipeline Verification

- [ ] Trigger a run via "Run Now"
- [ ] Both CL and OfferUp scrape tasks dispatched (check pipeline graph)
- [ ] OfferUp listings are from the configured region (not EC2 IP location)
- [ ] OfferUp uses varied search queries (not just "wood furniture")
- [ ] Triage counts show per-platform (both CL and OfferUp triaged)
- [ ] Evaluate counts show per-platform (both CL and OfferUp evaluated)
- [ ] Qualified listings get all 3 concept options (simple/moderate/full)
- [ ] Qualified listings get all 3 concept renders (if FAL_KEY set)
- [ ] Pipeline completes without hanging
- [ ] Run summary shows accurate counts
- [ ] New listings appear in dashboard/listings with "New" badges

---

## Mobile Responsiveness

- [ ] Sidebar collapses to hamburger menu on mobile
- [ ] Dashboard cards stack in single column
- [ ] Listing detail images scroll horizontally
- [ ] Settings tab headers scroll horizontally (no vertical overflow)
- [ ] Agent config fields stack vertically
- [ ] Pipeline graph scales to fit
- [ ] Concept cards stack in single column
- [ ] Project kanban columns scroll horizontally

---

## Edge Cases

- [ ] Import same URL twice shows "already exists"
- [ ] Delete a listing that has a project (cascade behavior)
- [ ] Analyze a listing with no images (graceful error)
- [ ] Generate plan for listing without analysis (422 error shown)
- [ ] Rapid-click any model-triggering button (should be guarded, no duplicate calls)
- [ ] Sign out during an active scraper run (run continues server-side)
- [ ] Deploy during an active run (graceful shutdown, stale cleanup on restart)
