# Railway deploy

This project is ready for a permanent Railway deploy with SQLite stored on a Railway volume.

## Why Railway

- Permanent public domain on `up.railway.app`
- GitHub auto-deploy
- Persistent volume support for SQLite
- Good fit for a Node web service

## Important

SQLite must be stored on a Railway volume.

The app now supports:

- local dev: `./data/app.db`
- custom host: `DATA_DIR`
- Railway volume: `RAILWAY_VOLUME_MOUNT_PATH`

## Deploy steps

1. Create or sign in to Railway.
2. Choose `New Project`.
3. Select `Deploy from GitHub repo`.
4. Pick `yzigpt/cautious-winner`.
5. After the project is created, add a `Volume` and mount it to `/data`.
6. In service settings, confirm the start command is `npm start`.
7. Generate a public domain in the Networking tab.
