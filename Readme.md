# Notion ↔ Google Tasks Sync

A Node.js application for **bi-directional synchronization** between a Notion database and Google Tasks.  

It synchronizes:
- **Creation** (both directions with guards)
- **Completion status** using a *latest-wins* policy
- **Notes** from Notion → Google with safe truncation  

It also includes robust **title normalization**, **duplicate-prevention backstops**, and **detailed logging**.

---

## ✨ Features

- **Bi-directional create**:  
  - Notion → Google  
  - Google → Notion (open tasks only)  
  - With multiple race-condition backstops  

- **Completion sync (latest-wins)**:  
  - Chooses the side with the newer timestamp  
  - Open-first selection prevents false positives with duplicate titles  

- **Notes sync (Notion → Google)**:  
  - Builds a plain-text view of Notion blocks  
  - Updates Google Task notes with safe truncation (8,000 chars)  

- **Title normalization**:  
  - Case + whitespace normalization for stable matching  

- **Guards and backstops**:  
  - Avoids recreating tasks when a title exists  
  - Fresh snapshots + short debounce to prevent duplicates  

- **Performance tuning**:  
  - Configurable *recency skew*  
  - Recent-window optimization  

- **Logging**:  
  - Detailed debug logs  
  - Clear sync start/end markers  

---

## 📦 Prerequisites

- Node.js **v14+** and npm or yarn  
- A Google Cloud project with the **Google Tasks API** enabled  
- **OAuth 2.0 credentials** and a refresh token for Google  
- A **Notion integration** (internal) and a shared Notion database with the expected schema  

---

## 📝 Notion Requirements

**Database properties expected:**
- `Name`: Title property for the task name  
- `Status`: Status property with at least **"To Do"** and **"Done"**  
- `Due Date`: Date property *(optional)*  

**Notes handling:**
- Reads Notion page blocks (paragraphs, headings, lists, to-dos)  
- Builds a plain-text "notes" string for Google Task notes  
- Skips unsupported blocks gracefully  

---

## 📋 Google Tasks Requirements

- OAuth client configured with **authorized redirect URIs**  
- Refresh token acquired via your OAuth flow or OAuth Playground  
- Target **Task List ID** where tasks will be read/written  

---

## ⚙️ Installation

Clone and install:

```bash
git clone https://github.com/yourusername/sync-notion-with-gtasks.git
cd sync-notion-with-gtasks
npm install
```

Configure environment (.env in project root):

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_redirect_uri
GOOGLE_REFRESH_TOKEN=your_refresh_token
GOOGLE_TASK_LIST_ID=your_task_list_id

NOTION_TOKEN=your_notion_integration_token
NOTION_DATABASE_ID=your_notion_database_id
NOTION_API_VERSION=2022-06-28

RECENCY_SKEW_MS=2000
RECENT_DAYS=7
```

---

## 📂 Project Structure

```
src/
  services/
    googleTasksService.js   # Google Tasks integration
    notionService.js        # Notion integration
    syncService.js          # Core sync logic
  utils/
    logger.js               # Logging utility
scripts/                    # Test utilities (e.g. testFetchGoogleTasks.js)
```

---

## 🔄 How It Works

### Title matching & normalization
- Compare titles after trim → lowercase → collapse whitespace
- Stable matches reduce duplication from minor differences

### Completion sync (latest-wins)
- Prefers open (needsAction) Google task if available
- Otherwise uses most relevant completed one
- Updates only when newer by ≥ RECENCY_SKEW_MS (default: 2000 ms)

### Notes sync (Notion → Google)
- If Notion is newer & notes differ → update Google notes
- Truncated to ~8,000 chars
- Handles empty text gracefully

### Create paths (guarded)

**Notion → Google:**
- Only for open Notion tasks with no matching Google title
- Multiple guard checks: initial fetch → fresh fetch → debounce recheck

**Google → Notion:**
- Only for open Google tasks with no matching Notion title
- Snapshot + just-in-time recheck

### Performance options
- Full pagination with showHidden for all tasks
- Can filter to recent items (via RECENT_DAYS)
- But backstops always check full set to avoid duplicates

---

## ▶️ Running a Sync

Single run:
```bash
node src/index.js
```

Scheduled (cron example):
```bash
*/5 * * * * cd /path/to/project && /usr/bin/node src/index.js >> /path/to/log 2>&1
```

---

## 🌍 Environment Variables

**Google:**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_TASK_LIST_ID`

**Notion:**
- `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `NOTION_API_VERSION`

**Tuning:**
- `RECENCY_SKEW_MS`: Prevents near-simultaneous conflicts (default: 2000 ms)
- `RECENT_DAYS`: Optional performance filter for recent items

---

## 🪵 Logging

- Start/end timestamps for each sync
- Debug logs for:
  - Completion decisions (side, timestamps, counts)
  - Notes sync (length deltas, timestamps)
  - Create operations (guard/backstop outcomes)
- Warnings/errors for API issues, Notion limitations, retries

---

## 🛠️ Troubleshooting

**Issue: Google task recreated repeatedly**
- Ensure guards/backstops are in place (fetch + debounce + recheck)
- Confirm showHidden and pagination are enabled

**Issue: Completed task not found**
- May move off first page; ensure full pagination with showHidden

**Issue: Notion completion didn't update Google**
- Check timestamps (Notion must be newer by RECENCY_SKEW_MS)
- Verify titles match after normalization

**Issue: Notes not syncing**
- Only Notion → Google supported
- Check text actually differs & within size limit

**Issue: Unsupported Notion blocks**
- Skipped gracefully; does not block sync

---

## 🔒 Safety & Data Integrity

- No automatic deletions
- Idempotent title matching with multiple checks
- Completion updated only when definitively newer

---

## 💡 Development Tips

- Keep normalizeTitles enabled
- Adjust RECENCY_SKEW_MS for race conditions
- Increase logging around guards when debugging duplicates

---

## 📜 License

MIT 

---

## ⚠️ Disclaimer

Use at your own risk. Always test with a staging Notion database and a non-critical Google Task list before production.