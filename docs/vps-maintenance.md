# TOEFL Writing VPS Maintenance

This repo can use a VPS as a fixed-task runner.

The VPS does not need to become the main development machine.
Use this split:

- Local computer: edit code, test, push to GitHub
- GitHub: single source of truth for code
- VPS: pull code, run fixed scripts, save logs, send Telegram alerts

## 1. VPS repo layout

Recommended path:

```bash
/opt/toefl_writing
```

Runtime files created by ops scripts are stored in:

```bash
/opt/toefl_writing/.ops/
```

That folder is ignored by Git.

## 2. Minimum env for bank generation

Create:

```bash
/opt/toefl_writing/.env.local
```

Minimum:

```env
DEEPSEEK_API_KEY=your_key
TG_BOT_TOKEN=your_telegram_bot_token
TG_CHAT_ID=your_telegram_user_id
```

If DeepSeek needs a proxy on the VPS, also set one of:

```env
DEEPSEEK_PROXY_URL=http://host:port
HTTPS_PROXY=http://host:port
HTTP_PROXY=http://host:port
```

## 3. Extra env for feedback monitoring

Add these when you want to monitor feedback rows directly from Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 4. First-time setup on VPS

```bash
cd /opt
git clone <YOUR_GITHUB_REPO_URL> toefl_writing
cd /opt/toefl_writing
npm ci
```

Then create `.env.local`.

## 5. Bank update commands

Run only the report pipeline:

```bash
npm run ops:bank:update -- --sets 1
```

Pull latest code, reinstall deps, run the pipeline, and notify Telegram:

```bash
npm run ops:bank:update -- --pull --install --sets 1 --notify
```

Logs are stored in:

```bash
.ops/logs/
```

## 6. Feedback monitoring commands

First run should set a baseline and avoid alerting old rows:

```bash
npm run ops:feedback:check -- --bootstrap-now
```

Normal monitoring run:

```bash
npm run ops:feedback:check -- --notify
```

## 7. Site monitoring commands

Check site and Supabase health endpoint:

```bash
npm run ops:site:check -- --base-url https://your-site-domain --notify
```

Use `--notify-ok` if you also want success messages.

## 8. Suggested cron jobs

Every day at 09:00:

```cron
0 9 * * * cd /opt/toefl_writing && /usr/bin/npm run ops:bank:update -- --pull --install --sets 1 --notify >> /opt/toefl_writing/.ops/logs/cron-bank.log 2>&1
```

Every 10 minutes:

```cron
*/10 * * * * cd /opt/toefl_writing && /usr/bin/npm run ops:feedback:check -- --notify >> /opt/toefl_writing/.ops/logs/cron-feedback.log 2>&1
```

Every 5 minutes:

```cron
*/5 * * * * cd /opt/toefl_writing && /usr/bin/npm run ops:site:check -- --base-url https://your-site-domain --notify >> /opt/toefl_writing/.ops/logs/cron-site.log 2>&1
```

## 9. Safe scope

Good first-stage VPS tasks:

- pull latest code
- run bank generation
- validate output
- check new feedback rows
- check site health
- send Telegram alerts

Do not make the VPS auto-edit code or auto-deploy production changes in the first stage.
