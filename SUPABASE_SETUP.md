# Free Setup

This project can run for free as a static site on GitHub Pages or Cloudflare Pages with Supabase as the database.

## What changed

- The public site can work without `server.js`
- Reviews are stored in Supabase
- Buyer requests are stored in Supabase
- The admin cabinet uses Supabase Auth

## 1. Create the permanent database

1. Create a project in Supabase.
2. Open the SQL Editor.
3. Click `New query`.
4. Open `supabase/schema.sql` in this project, copy all its contents into the query window and click `Run`.

After a successful run, open `Table Editor`. You must see exactly these tables:

- `reviews` - public client reviews
- `project_requests` - requests sent from the website
- `admin_profiles` - access list for the administrator cabinet

The website already sends reviews and requests to these tables. No phone number is saved with a request.

## 2. Create administrator account

1. In `Authentication` -> `Users`, create a user with email and password.
2. Copy that email into `supabase-config.js` as `SUPABASE_ADMIN_EMAIL`.
3. Run this SQL after the user is created:

```sql
insert into public.admin_profiles (user_id, display_name)
select id, 'Frog Oxide Admin'
from auth.users
where email = 'YOUR_ADMIN_EMAIL'
on conflict (user_id) do update
set display_name = excluded.display_name;
```

## 3. Add public keys to the site

Edit `supabase-config.js`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_ADMIN_EMAIL`

Use only the public `anon` key here.
For `SUPABASE_URL`, use the project URL in the form `https://your-project.supabase.co`.
Do not add `/rest/v1` to the end of the address.

## 4. Free hosting

You can publish the site for free in two easy ways:

- GitHub Pages
- Cloudflare Pages

The frontend is fully static, so both options work.

## Admin cabinet

- URL: `/cabinet.html`
- Login: email from `SUPABASE_ADMIN_EMAIL` + your Supabase password

## Notes

- `server.js` is no longer required for free hosting.
- SQLite is kept in the repository only as the old local variant.
- The free static deployment uses Supabase instead of SQLite.
