# Safe Key Pipeline Quick Notes

## Shift batch configuration
- Open the userscript header and locate `SAFE_KEYS_CONFIG` near the top of `src/Verter.user.js`.
- Set `USE_SHIFT_FOR_RESET` and `USE_SHIFT_FOR_GROSS_SET` to `false` to disable Shift batches (the pipeline will continue to work, only slower).
- Optional: adjust `RESET_SHIFT_BATCH` and `GROSS_SHIFT_BATCH` to tune how many Shift+A/Shift+D presses are sent in each coarse batch.

## Monitoring ARMED status
- The trading panel now includes a compact indicator "ARMED" with a live status line.
- **Green** background: amount prepared and verified (shows `$value • Xs ago`).
- **Yellow** background: amount became DIRTY (reason shown); pipeline automatically schedules a fresh preparation.
- **Red** background: safety abort. Wait for automatic reset or trigger a manual re-prep.
- **Blue/Grey** backgrounds: preparation in progress or idle.

## Manual re-preparation
- If you change instrument or balance manually, the indicator will turn yellow and the bot will re-arm the required amount.
- You can also call `window.__SAFE_KEYS__.prepareArmed(target)` from the dev console for manual testing when DEV export is enabled.
