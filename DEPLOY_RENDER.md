# Render deploy

This project is prepared for a permanent Render deploy with SQLite stored on a persistent disk.

## Why Render

- Good fit for a Node web service
- HTTPS and a permanent `onrender.com` URL
- Auto-deploy on every push
- Persistent disk support for SQLite

## Important

SQLite persistence on Render requires a paid web service with a disk.

The app is configured to store data in:

- local dev: `./data/app.db`
- Render: `/data/app.db`

## Files already prepared

- `package.json`
- `render.yaml`
- `server.js` supports `DATA_DIR`

## Deploy steps

1. Put this project in a GitHub repository.
2. Create a Render account.
3. In Render Dashboard choose `New` -> `Blueprint`.
4. Connect the GitHub repository.
5. Render will detect `render.yaml`.
6. Confirm deploy.
7. After deploy finishes, open the generated `https://...onrender.com` URL.

## Notes

- The persistent disk is mounted at `/data`.
- The public site runs in the Node service.
- If you later buy a custom domain, you can attach it in Render.
