# Changelog

## [5.3.0] - 2025-09-20
### Added
- Ported deterministic stake placement module (`AmountGuard`) with payout guard, retry logic, and HUD logging.
- Introduced trade placement locks, minute-boundary synchronisation, and payout filtering before submitting orders.
- Added deal observer callback bridge to drive Martingale step updates on actual trade outcomes and soft resets on asset switches.

### Changed
- Updated Martingale progression to follow real deal closures and integrated compact HUD logs for bets and deal results.
- Refreshed build metadata to `5.12.0-CAN CHS StakeFix` reflecting stake mechanics improvements.
