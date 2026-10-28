# Creator Hub steps

Each file is a steps module for the headless runner `D:\agent-work\fp-mods\publish\run.cjs` (via `go.ps1`), which drives the signed-in Playwright launcher profile in the private noninteractive station. They call the Creator Hub's own APIs with that session; no cookies or keys are logged.

| Step | What it does |
| --- | --- |
| `create-universe.cjs` | Created the experience from the Baseplate template (done once) |
| `create-key.cjs` | Created the scoped Open Cloud key (done once; refuses if the key file exists) |
| `monetize.cjs` | Creates missing passes, products and badges from `store/listing.json`; writes `store/ids.json` |
| `store-page.cjs` | Name, description, devices, private servers, icon and thumbnails |
| `questionnaire-fill.cjs` | Content-rating questionnaire (`SUBMIT=1` to submit) |
| `go-public.cjs` | Shows privacy; `RINGER_GO_PUBLIC=1` makes the experience public |

```powershell
& D:\agent-work\fp-mods\publish\go.ps1 -Steps <step.cjs> -Out <log dir>
```
