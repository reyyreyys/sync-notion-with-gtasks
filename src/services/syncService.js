const notionService = require('./notionService');
const googleTasksService = require('./googleTasksService');
const logger = require('../utils/logger');

class SyncService {
    constructor() {
        this.lastSync = null;
        this.isRunning = false;
        this.stats = {
            totalSyncs: 0,
            lastSyncTime: null,
            errors: 0,
            tasksCreated: 0,
            tasksUpdated: 0,
            tasksDeleted: 0
        };

        // Focused logging for completion sync
        this.debugCompletion = true;

        // Title normalization toggle (use normalized compare by default)
        this.normalizeTitles = true;

        // Recency threshold (ms) to avoid flapping on near-simultaneous edits
        this.recencySkewMs = Number(process.env.RECENCY_SKEW_MS || 2000);
    }

    // Compare titles with optional normalization
    compareTitles(a, b) {
        if (a == null || b == null) return false;
        if (this.normalizeTitles) {
            const na = a.trim().toLowerCase().replace(/\s+/g, ' ');
            const nb = b.trim().toLowerCase().replace(/\s+/g, ' ');
            return na === nb;
        }
        return a === b;
    }

    // Normalize helper used for indexing
    normalizeTitle(s) {
        if (!s) return '';
        if (!this.normalizeTitles) return s;
        return s.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    // Return true if google is considered "newer" than notion by threshold
    googleBeatsNotion(googleTask, notionTask) {
        const g = googleTask?.lastModified ? Date.parse(googleTask.lastModified) : 0;
        const n = notionTask?.lastModified ? Date.parse(notionTask.lastModified) : 0;
        return g > n + this.recencySkewMs;
    }

    // Return true if notion is considered "newer" than google by threshold
    notionBeatsGoogle(notionTask, googleTask) {
        const g = googleTask?.lastModified ? Date.parse(googleTask.lastModified) : 0;
        const n = notionTask?.lastModified ? Date.parse(notionTask.lastModified) : 0;
        return n > g + this.recencySkewMs;
    }

    async performFullSync() {
        if (this.isRunning) {
            if (this.debugCompletion) logger.warn('Sync already in progress, skipping');
            return;
        }

        this.isRunning = true;
        const syncStartTime = new Date();

        console.log(`SYNC START ${syncStartTime.toISOString()}`);

        try {
            if (this.debugCompletion) logger.info('Sync start: Google completion → Notion (title-only, latest-wins), Notion↔Google notes, bi-directional completion and creates with guards', {
                normalizeTitles: this.normalizeTitles,
                recencySkewMs: this.recencySkewMs
            });

            const [notionTasks, googleTasks] = await Promise.all([
                notionService.getTasks(),
                googleTasksService.getTasks()
            ]);

            let created = 0, updated = 0;

            // Build a title index for Google tasks: prefer open over completed for same title
            const titleIndex = new Map(); // key: normalized title, value: { open: [], done: [] }
            for (const gt of googleTasks) {
                if (!gt.title?.trim()) continue;
                const key = this.normalizeTitle(gt.title);
                if (!titleIndex.has(key)) titleIndex.set(key, { open: [], done: [] });
                if (gt.completed) titleIndex.get(key).done.push(gt);
                else titleIndex.get(key).open.push(gt);
            }

            // Build a quick lookup for Notion titles
            const notionTitleSet = new Set(
                notionTasks
                    .filter(nt => nt.title?.trim())
                    .map(nt => this.normalizeTitle(nt.title))
            );

            // Google → Notion completion sync (title-only match, open-first, latest-wins)
            for (const nt of notionTasks) {
                if (!nt.title?.trim()) continue;
                const key = this.normalizeTitle(nt.title);
                const group = titleIndex.get(key);
                if (!group) continue;

                // Prefer any open Google task, else fall back to a completed one
                const representative = group.open[0] || group.done[0];
                if (!representative) continue;

                // Only update Notion if Google is newer by threshold
                if (nt.completed !== representative.completed && this.googleBeatsNotion(representative, nt)) {
                    if (this.debugCompletion) {
                        logger.info('Completion change (Google → Notion, latest-wins)', {
                            title: nt.title,
                            googleCompleted: representative.completed,
                            googleUpdated: representative.lastModified,
                            notionEdited: nt.lastModified,
                            googleOpenCount: group.open.length,
                            googleDoneCount: group.done.length
                        });
                    }
                    await this.updateNotionCompletion(nt, representative.completed);
                    updated++;
                }
            }

            // Notion → Google completion sync (title-only match, open-first, latest-wins)
            for (const nt of notionTasks) {
                if (!nt.title?.trim()) continue;
                const key = this.normalizeTitle(nt.title);
                const group = titleIndex.get(key);
                if (!group) continue;

                // Prefer any open Google task, else fall back to a completed one
                const representative = group.open[0] || group.done[0];
                if (!representative) continue;

                // Only update Google if Notion is newer by threshold
                if (nt.completed !== representative.completed && this.notionBeatsGoogle(nt, representative)) {
                    if (this.debugCompletion) {
                        // logger.info('Completion change (Notion → Google, latest-wins)', {
                        //     title: nt.title,
                        //     notionCompleted: nt.completed,
                        //     notionEdited: nt.lastModified,
                        //     googleUpdated: representative.lastModified,
                        //     googleOpenCount: group.open.length,
                        //     googleDoneCount: group.done.length
                        // });
                    }
                    await this.updateGoogleCompletion(representative, nt.completed);
                    updated++;
                }
            }

            // Notion → Google notes sync (title-only, latest-wins)
            for (const nt of notionTasks) {
                if (!nt.title?.trim()) continue;
                const key = this.normalizeTitle(nt.title);
                const group = titleIndex.get(key);
                if (!group) continue;

                // Prefer the open Google task; if none open, pick the most recently updated among done
                const candidate = group.open[0] || group.done.sort((a, b) => Date.parse(b.lastModified || 0) - Date.parse(a.lastModified || 0))[0];
                if (!candidate) continue;

                const notionNotes = (nt.notes || '').trim();
                const googleNotes = (candidate.notes || '').trim();

                // Only push notes when Notion is more recent and content differs
                if (this.notionBeatsGoogle(nt, candidate) && notionNotes !== googleNotes) {
                    if (this.debugCompletion) {
                        // logger.info('Notes change (Notion → Google, latest-wins)', {
                        //     title: nt.title,
                        //     notionEdited: nt.lastModified,
                        //     googleUpdated: candidate.lastModified,
                        //     notionLen: notionNotes.length,
                        //     googleLen: googleNotes.length
                        // });
                    }
                    await this.updateGoogleNotes(candidate, notionNotes);
                    updated++;
                }
            }

            // Notion-only → Google (title-only guards)
            const notionOnlyTasks = notionTasks.filter(nt => {
                if (!nt.title?.trim()) return false;

                // If completed in Notion, do not create on Google (creation path)
                if (nt.completed) {
                    if (this.debugCompletion) logger.debug('Guard: completed in Notion → skip create', { title: nt.title });
                    return false;
                }

                // If any Google task has same title, skip creation
                const hasTitleMatch = googleTasks.some(gt => {
                    if (!gt.title?.trim()) return false;
                    return this.compareTitles(nt.title, gt.title);
                });
                if (hasTitleMatch) {
                    if (this.debugCompletion) logger.debug('Guard: title exists in Google → skip create', { title: nt.title });
                    return false;
                }

                return true;
            });

            for (const notionTask of notionOnlyTasks) {
                // Backstop: JIT fresh fetch and title check to avoid races
                const freshGoogle = await googleTasksService.getTasks();
                const anyTitleMatchFresh = freshGoogle.some(gt => {
                    if (!gt.title?.trim()) return false;
                    return this.compareTitles(notionTask.title, gt.title);
                });
                if (anyTitleMatchFresh) {
                    if (this.debugCompletion) logger.debug('Backstop: title match in fresh snapshot → skip create', { title: notionTask.title });
                    continue;
                }

                // Small debounce, then re-check once more
                await new Promise(r => setTimeout(r, 350));
                const verifyGoogle = await googleTasksService.getTasks();
                const anyTitleMatchVerify = verifyGoogle.some(gt => {
                    if (!gt.title?.trim()) return false;
                    return this.compareTitles(notionTask.title, gt.title);
                });
                if (anyTitleMatchVerify) {
                    if (this.debugCompletion) logger.debug('Verify backstop: title match after debounce → skip create', { title: notionTask.title });
                    continue;
                }

                // if (this.debugCompletion) logger.info('Create Google from Notion', {
                //     title: notionTask.title,
                //     completed: notionTask.completed
                // });

                let notesToSync = notionTask.notes || '';
                const MAX_CREATE_LENGTH = 8000;
                if (notesToSync.length > MAX_CREATE_LENGTH) {
                    notesToSync = this.createSmartTruncation(notesToSync, MAX_CREATE_LENGTH);
                }

                await googleTasksService.createTask({
                    title: notionTask.title,
                    completed: notionTask.completed,
                    due: notionTask.due,
                    notes: notesToSync
                });

                created++;
            }

            // Google-only → Notion (title-only guards, open tasks only)
            const googleOnlyOpen = googleTasks.filter(gt => {
                if (!gt.title?.trim()) return false;
                if (gt.completed) return false; // create in Notion only for active tasks
                const key = this.normalizeTitle(gt.title);
                const existsInNotion = notionTitleSet.has(key);
                if (existsInNotion) return false;
                return true;
            });

            for (const googleTask of googleOnlyOpen) {
                // Backstop: fetch latest Notion and check again by title
                const freshNotion = await notionService.getTasks();
                const titleExists = freshNotion.some(nt => {
                    if (!nt.title?.trim()) return false;
                    return this.compareTitles(nt.title, googleTask.title);
                });
                if (titleExists) {
                    if (this.debugCompletion) logger.debug('Backstop (Notion): title exists → skip create', { title: googleTask.title });
                    continue;
                }

                // if (this.debugCompletion) logger.info('Create Notion from Google', {
                //     title: googleTask.title,
                //     completed: googleTask.completed
                // });

                await notionService.createTask({
                    title: googleTask.title,
                    completed: false, // active on Google => "To Do" in Notion
                    due: googleTask.due || null,
                    notes: googleTask.notes || ''
                });

                created++;
            }

            await this.updateSyncStats(created, updated, syncStartTime);

            if (this.debugCompletion) {
                logger.info('Sync done', { created, updatedCompletion: updated, normalizeTitles: this.normalizeTitles, recencySkewMs: this.recencySkewMs });
                console.log('Sync done', { created, updatedCompletion: updated, normalizeTitles: this.normalizeTitles, recencySkewMs: this.recencySkewMs });
            }

        } catch (error) {
            logger.error('SYNC FAILED', { message: error.message, stack: error.stack });
            this.stats.errors++;
            throw error;
        } finally {
            this.isRunning = false;
            const endedAt = new Date();
            console.log(`SYNC END ${endedAt.toISOString()}`);
        }
    }

    createSmartTruncation(content, maxLength) {
        if (content.length <= maxLength) return content;
        const truncateAt = maxLength - 100;
        const lines = content.substring(0, truncateAt).split('\n');
        if (lines.length > 1) lines.pop();
        const truncated = lines.join('\n');
        const suffix = `\n\n[... ${content.length - truncated.length} more characters in full Notion content ...]`;
        return truncated + suffix;
    }

    async updateNotionCompletion(notionTask, completed) {
        await notionService.updateTask(notionTask.id, { completed });
        // if (this.debugCompletion) logger.info('Notion completion updated', { title: notionTask.title, completed });
    }

    async updateGoogleCompletion(googleTask, completed) {
        await googleTasksService.updateTask(googleTask.id, { completed });
        // if (this.debugCompletion) logger.info('Google completion updated', { title: googleTask.title, completed });
    }

    async updateGoogleNotes(googleTask, notes) {
        // quiet in focused mode
        const MAX = 8000;
        let processed = notes || '';
        if (processed.length > MAX) processed = this.createSmartTruncation(processed, MAX);
        if (processed.length === 0) return;
        await googleTasksService.updateTask(googleTask.id, { notes: processed });
    }

    async updateSyncStats(created, updated, syncStartTime) {
        this.stats.totalSyncs++;
        this.stats.lastSyncTime = syncStartTime;
        this.stats.tasksCreated += created;
        this.stats.tasksUpdated += updated;
        if (this.debugCompletion) {
            const dur = Date.now() - syncStartTime.getTime();
            logger.debug('Sync duration', { ms: dur });
        }
        this.lastSync = new Date();
    }

    getSyncStatus() {
        return {
            isRunning: this.isRunning,
            lastSync: this.lastSync,
            stats: this.stats,
            syncType: 'Google completion-focused sync (title-only, latest-wins, notes sync, bi-directional completion and creates)',
            rules: {
                completion: 'Both directions by title with recency check (open-first)',
                notes: 'Notion → Google by title with recency check',
                guards: 'Skip create if completed in Notion or title exists in Google/Notion',
                normalization: this.normalizeTitles ? 'normalized' : 'exact',
                recencySkewMs: this.recencySkewMs
            }
        };
    }
}

module.exports = new SyncService();
