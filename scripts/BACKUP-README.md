# Database backups

A weekly, read-only export of every table in the app's Supabase database
(plus a list of every file name in Supabase Storage), saved to iCloud
Drive on your Mac. Supabase's free plan has no automatic backups — this
is the safety net for that.

## Where files go

```
~/Library/Mobile Documents/com~apple~CloudDocs/Ritas-backups/
```

That's the `Ritas-backups` folder inside iCloud Drive — you can also get
there in Finder via **iCloud Drive → Ritas-backups**. Each run creates one
dated folder, e.g. `2026-11-09_2200/`, containing:

- one `.json` file per table (e.g. `items.json`, `notes.json`) — the raw
  rows, exactly as they are in the database
- `storage-file-lists.json` — file names, sizes, and dates for every file
  in the `note-photos` and `task-photos` buckets (not the photos
  themselves — this is a list, not a copy)
- `manifest.json` — table names, row counts, start/finish time, and
  whether each table's count matched

Only the 8 most recent dated folders are kept; older ones are deleted
automatically. `last-run.json` (one level up, not inside a dated folder)
always reflects the most recent attempt, success or failure.

## Running it

By hand, any time:

```
npm run backup
```

Prints a summary when done (table names, row counts, total size, folder
path, OK or FAILED) — never row contents, never secrets.

To check whether the last scheduled run actually happened and succeeded:

```
npm run backup:check
```

This is also what runs automatically every day — see "The scheduled jobs"
below.

## The scheduled jobs

Two launchd LaunchAgents, installed with:

```
./scripts/install-backup-jobs.sh
```

- **`com.ritasinventory.backup.weekly`** — runs the backup every Sunday at
  10:00 PM. If your Mac is asleep at that time, launchd runs it once
  automatically the next time it wakes.
- **`com.ritasinventory.backup.check`** — runs `backup:check` every day at
  9:00 AM, so a silently dead weekly job still gets noticed via a
  notification instead of nobody finding out for months.

Useful commands (the install script also prints these):

```
# confirm both are loaded
launchctl print gui/$(id -u)/com.ritasinventory.backup.weekly
launchctl print gui/$(id -u)/com.ritasinventory.backup.check

# run one right now, without waiting for its schedule
launchctl kickstart -k gui/$(id -u)/com.ritasinventory.backup.weekly
launchctl kickstart -k gui/$(id -u)/com.ritasinventory.backup.check

# remove both
launchctl bootout gui/$(id -u)/com.ritasinventory.backup.weekly
launchctl bootout gui/$(id -u)/com.ritasinventory.backup.check
rm ~/Library/LaunchAgents/com.ritasinventory.backup.weekly.plist
rm ~/Library/LaunchAgents/com.ritasinventory.backup.check.plist
```

Log output (counts and OK/FAILED only, same as the terminal summary) goes
to `backup.log` and `backup-check.log` inside the backups folder.

## Restoring one table from a backup

**There is no automated restore, on purpose** — blindly overwriting live
data from a backup file is how you turn one problem into two. If you ever
need to bring a table back:

1. Open the dated folder's `.json` file for that table and look at the
   shape of a row or two.
2. Restore it into a **scratch table in Supabase, or a brand-new, empty
   Supabase project** first — never straight into the live `items`/`notes`/
   etc. table. The Supabase SQL Editor's "Import data from CSV/JSON" or a
   short one-off script using the service-role key can load the file into
   that scratch location.
3. Compare what you restored against what's currently live. Only once
   you're sure it's right should you (or Claude, explicitly asked, in a
   normal patch with ZZTEST-style caution) write the specific rows that
   actually need fixing back into the real table.

This is deliberately manual and slower than an automated restore — that's
the point. A bad automated restore can destroy more than it fixes.

## Checking iCloud actually synced it

A backup folder can exist locally on your Mac's disk before iCloud has
finished uploading it. In Finder, open **iCloud Drive → Ritas-backups**
and look at the dated folder's icon:

- A small **cloud icon** (or a cloud with a down-arrow) means it's
  **not fully synced yet** — either still uploading, or stored only in
  iCloud and not downloaded locally.
- A plain folder icon with no cloud badge means it's synced and also
  present on this Mac's local disk.

Right-click a folder and look for **"Download Now"** — if that option is
there, it means the folder isn't fully local yet; choosing it forces the
download so you can confirm the contents.

**Note on "Optimize Mac Storage":** if that's enabled in iCloud settings,
macOS may turn *older* backups into cloud-only stubs to save local disk
space — they're still safe and still back up/restore correctly, they're
just not sitting on your local disk anymore until you open or download
them. This is expected, not a sign of data loss.

## Moving the backups folder (e.g. to an external drive)

1. Copy the whole `Ritas-backups` folder to the new location.
2. Edit `BACKUPS_DIR` near the top of `scripts/backup.mjs` and
   `scripts/backup-check.mjs` to the new path.
3. Re-run `./scripts/install-backup-jobs.sh` (it's safe to re-run — it
   reloads both jobs with the current script paths) so the scheduled jobs
   pick up the change.
4. Once you've confirmed a backup lands in the new location, delete the
   old `Ritas-backups` folder.

## Privacy warning

**This backup contains private data**: owner and shift-lead login PINs
(stored in plain text in the database — see `CLAUDE.md` §5), push
notification subscription keys, and the full content of every note
(including anything marked private/`owner_only`). Keep this folder on
your own devices only. Never put it in a shared drive, a public cloud
link, email it, or commit it anywhere — including this repo, which is
public.
