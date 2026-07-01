# UK licensed-sponsor register

Local copy of the gov.uk **Register of licensed sponsors: Worker and Temporary
Worker** list, used by `sponsor-check.mjs` to tell whether a UK employer can
legally sponsor a Skilled Worker visa (see `modes/oferta.md` Step 6 → "Visa and
work eligibility").

**You only need this if you require UK visa sponsorship** — i.e. you set
`work_eligibility.needs_uk_sponsorship: true` in `config/profile.yml`. If you
already have the right to work in the UK (citizen, settled/pre-settled status,
ILR), skip it.

## Contents (both git-ignored — regenerable, not committed)

- `Worker_and_Temporary_Worker_Register_YYYY-MM-DD.csv` — the raw register
  download (~11 MB, ~140k rows). Header:
  `Organisation Name,Town/City,County,Type & Rating,Route`. (gov.uk's own
  filename varies; any `.csv` in this folder is picked up — the newest by name.)
- `index.json` — the built fuzzy-lookup index (~30 MB). Never committed.

## Setup / refresh

1. Download the latest CSV from gov.uk:
   <https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers>
   (the "Worker and Temporary Worker" CSV link on that page). Save it into this
   folder.
2. Build (or rebuild) the lookup index:
   ```bash
   node sponsor-check.mjs --rebuild
   ```
3. Spot-check a known sponsor:
   ```bash
   node sponsor-check.mjs --company "Monzo Bank" --json
   ```

gov.uk republishes the register most working days. The register is a
point-in-time snapshot; `sponsor-check.mjs` reports the source filename so a
stale copy is visible in the output. Re-download and `--rebuild` periodically.
