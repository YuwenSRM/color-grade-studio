# P3-5 standalone candidate release notes

Candidate version: `1.0.0`  
Scope: local standalone web shell with the frozen `legacy-v1` color-grade page.

## Delivered candidate artifacts

- `dist/standalone-candidate/app/` contains the audited static editor output.
- `ColorGradeStudio.vbs` starts the no-Node PowerShell L1 launcher without a console window.
  `ColorGradeStudio.cmd` is the visible diagnostic entry. Both validate the package manifest, only
  serve listed `app/` resources, listen on `127.0.0.1:4174`, and open the default browser.
- `MANIFEST.json` has deterministic file paths, byte counts, and SHA-256 values.
- `SBOM.json` and `LICENSES/` disclose shipped runtime assets and built-in filter license.
- Support, privacy, data, and backup guidance travels with the candidate.

## Supported review path

For Windows L1 testing, double-click `ColorGradeStudio.vbs`; Node.js is not needed for this launch
path. `ColorGradeStudio.cmd` is available for visible diagnostics. The launcher uses Windows
PowerShell and binds only `127.0.0.1:4174`. Run
`ColorGradeStudio.cmd --stop` to stop it.

## Release status and remaining gates

This is not an externally released installer. The PowerShell launcher is not a signed native
executable, and no clean Windows machine without project sources has been exercised. Native
runtime distribution, signing, Defender behavior, and a clean-machine test remain release gates.

No authorized 12MP or 24MP SDR sRGB fixture was supplied. The performance gate is skipped,
not passed. Historical P1 evidence is a `legacy-v1` baseline only.

`studio-v2`, CUBE/Hald baking, and P3-4 formats are tested DOM-independent core capability.
They are not wired into this standalone page; do not claim standalone UI support for them.
P3 remains SDR sRGB only. RAW, HDR, Log, ICC, Display P3, and Electron are not included.
