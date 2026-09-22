# PowerShell launcher prototype

`ColorGradeStudio.vbs` is the normal double-click entry point. It starts the standalone app without
Node.js and without a console window. `ColorGradeStudio.cmd` starts the same launcher in a visible
console for diagnostics. Both invoke Windows PowerShell, validate the package manifest, serve only
manifest-approved assets from `app/` on
`127.0.0.1:4174`, and opens the default browser.

This is the L1 external-launch flow. It is not a signed native executable and must not be
presented as the final public-release launcher. Stop the local service with:

```powershell
.\ColorGradeStudio.cmd --stop
```
