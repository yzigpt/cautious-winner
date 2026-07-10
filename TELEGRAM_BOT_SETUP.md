# Telegram Bot for New Requests

The bot token must never be added to `supabase-config.js`, frontend JavaScript, or GitHub.
It belongs only in Supabase Edge Function secrets.

## What the integration does

- A visitor sends a request from the website.
- The request is stored in `project_requests`.
- A beautiful Telegram notification is sent to every connected admin chat.
- The `Vzyal v rabotu` button marks the request as answered in the database.
- When you send `/start` to the bot, it remembers your Telegram chat automatically.

## One-time deployment

1. In Supabase SQL Editor, run the latest `supabase/schema.sql` to add `telegram_admin_chats`.
2. Install the Supabase CLI and log in: `npx supabase login`.
3. Link the project: `npx supabase link --project-ref kgdqwmbpxgdwxpyflajb`.
4. Add secrets. Use a newly generated bot token because the previous token was shared in a chat:

```powershell
npx supabase secrets set TELEGRAM_BOT_TOKEN="NEW_BOT_TOKEN"
npx supabase secrets set TELEGRAM_WEBHOOK_SECRET="a-long-random-private-string"
```

5. Deploy the functions:

```powershell
npx supabase functions deploy telegram-request --no-verify-jwt
npx supabase functions deploy telegram-webhook --no-verify-jwt
```

6. Set the Telegram webhook. Replace the placeholders locally; do not commit this command or its token:

```powershell
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/botNEW_BOT_TOKEN/setWebhook" -ContentType "application/json" -Body '{"url":"https://kgdqwmbpxgdwxpyflajb.supabase.co/functions/v1/telegram-webhook","secret_token":"a-long-random-private-string"}'
```

7. Open your bot in Telegram and send `/start`. It will confirm the connection and save your chat ID automatically.

## Enable sending from the website

After both functions are deployed and you receive the `/start` confirmation from the bot, set `TELEGRAM_REQUEST_FUNCTION_ENABLED` to `true` in `supabase-config.js` and publish the site. Until then, the form keeps saving requests directly to Supabase.
