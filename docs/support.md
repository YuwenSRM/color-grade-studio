# Standalone candidate support matrix

| Area                       | Candidate status                                               | Boundary                                              |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| Start                      | Windows PowerShell L1 launcher                                 | Loopback `127.0.0.1` only; no signed native launcher  |
| Browsers                   | Chrome and Edge automated shell checks                         | Independent temporary profiles                        |
| Offline shell              | Checked after initial local load                               | No account, API, upload, telemetry, or remote request |
| Image workflow             | Existing `legacy-v1` import, preview, crop, adjustment, export | Browser-supported image codecs                        |
| Built-in/user CUBE filters | Existing legacy UI                                             | User library persists per browser origin              |
| User filter backup         | Existing ZIP backup and restore UI                             | Export before clearing site data or switching origin  |
| Theme/language             | Existing light/dark and Chinese/English UI                     | Stored per browser origin                             |
| Worker recovery            | Existing legacy failure path                                   | No network fallback is permitted                      |
| `studio-v2` controls       | Core-only, not page-exposed                                    | No standalone UI integration yet                      |
| P3-2/P3-4 conversions      | Core-only, not page-exposed                                    | No standalone conversion UI/report download yet       |
| Color management           | SDR sRGB only                                                  | No ICC, RAW, Log, HDR, Display P3, ACES, or OCIO      |
| Desktop distribution       | Not provided                                                   | No installer, signing, updater, or bundled runtime    |
