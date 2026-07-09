# GitHub Pages deploy

This is the easiest free permanent URL for the current project.

## Result

After Pages is enabled, the site URL will look like:

`https://yzigpt.github.io/cautious-winner/`

## Steps

1. Make sure `supabase-config.js` is filled in.
2. Push changes to `main`.
3. In GitHub repo settings open `Pages`.
4. Set source to `GitHub Actions`.
5. Wait for the workflow to deploy the site.

The workflow file is already included in `.github/workflows/pages.yml`.
