# Standalone candidate privacy, local data, and backup

The standalone candidate has no account, remote image upload, analytics, telemetry, cloud
sync, project database, or gallery API. Its local HTTP server serves only packaged editor
assets on `127.0.0.1` and does not expose an arbitrary-file API.

Images selected for editing remain in browser memory for the active page session. User LUT
records and original blobs are stored in IndexedDB; theme and language use local storage.
This data is scoped to the exact browser origin, including its port, and can be removed by
clearing that site's browser data or using a separate profile.

Before clearing site data, changing browser, changing the standalone port, or resetting a
profile, use **Back up my filters**. Keep the downloaded ZIP yourself. Later use **Restore
backup** and select merge or replace. A failed restore validates the ZIP before modifying
the existing library. Image edits and in-memory source images are not covered by that backup.
