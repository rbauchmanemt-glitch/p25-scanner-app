# Updating PINs

`pins.json` in this folder is your local, private roster of who has
access and what their PIN is. It is **never pushed to GitHub** — it's
excluded via `.gitignore` because it contains real access codes.

`pins.example.json` shows the format and is safe to commit — it's just a
template with fake values.

## To add, remove, or change someone

1. Open `pins.json` in Notepad (or any text editor):
   ```powershell
   notepad pins.json
   ```

2. Edit it directly. It's a simple map of `"pin": "name"`:
   ```json
   {
     "4471": "Ryan",
     "9302": "Dana",
     "1188": "New Person"
   }
   ```
   - To **add** someone: add a new `"pin": "name"` line.
   - To **remove** someone: delete their line.
   - To **change** a PIN: edit the number, keep the name.
   - Keep PINs at least 4 digits. No two people should share a PIN.

3. Save the file.

4. Push the update to the live Worker — **one command, no copy-paste,
   no redeploy needed**:
   ```powershell
   Get-Content pins.json -Raw | wrangler secret put PINS_JSON
   ```
   This reads the file and pipes it straight into the secret. Takes
   effect within a few seconds.

5. Test: have the new/changed person try logging in at
   `https://scanner.bexarcountyscanner.com`.

## Why this is separate from git

`pins.json` holds real access codes for real people. Cloudflare Worker
secrets already keep it out of the *deployed* site's code, but committing
it to GitHub would still leak it into your repo history — private repo or
not, that's data you don't want sitting in version control. Keeping it as
a local, gitignored file means it only ever exists on your machine and
inside Cloudflare's secret storage.

If you ever set up on a second machine, just recreate `pins.json` there
from memory/notes — it doesn't need to match anything in git.
