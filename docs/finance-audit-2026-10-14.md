# CBoard Finance audit — 14 October 2026

## Scope and safety

Audited backup: `CBoard-Finance-Recipes-meal-planning-Grocery-Food-diary-Goals-progress-Notes-2026-10-14-1055.cboardbackup` (67 Finance transactions). The supplied backup was read only. No backup records were deleted, edited, or migrated. The new audit command is read only; do not treat its derived values as a migration decision.

## Backup results

| Ledger | Count | Amount |
| --- | ---: | ---: |
| Income | 7 | £1,500.00 |
| Expenses | 44 | £876.11 |
| Donations (paid and reserved) | 5 | £163.50 |
| Goal movements | 6 | £126.00 |
| Debt movements (paid and reserved) | 3 | £58.75 |
| Savings movements | 1 | £251.84 |
| Budget reserve | 1 | £4.50 |

September recorded £1,125.00 income, £691.38 expenses, £112.50 donations, £22.03 debt payment, £47.25 goal movements, and £251.84 moved to Savings. These entries leave £0.00 spendable at that month end.

October to 14 October recorded £375.00 income, £184.73 expenses, £36.00 paid donations, and £22.03 paid debt. That leaves £132.24 before October's new set-asides. October adds £78.75 to goal funds, £15.00 donation reserve, £14.69 debt reserve, and £4.50 budget reserve (£112.94 total), leaving £19.30 spendable.

### Current position derived from Finance transactions

- **Spendable:** £19.30
- **Protected funds:** £377.84 (£251.84 Savings + £126.00 Goal movements)
- **Reserved payments:** £34.19 (£15.00 donation + £14.69 debt + £4.50 budget)
- **Protected / reserved:** £412.03
- **Total owned:** £431.33 (£1,500.00 income − £876.11 expenses − £148.50 paid donations − £44.06 paid debt)
- **Debt outstanding:** £177.94 (£43.94 Wasik + £54.00 Khurram + £80.00 Faizan)

The previous UI showed £132.24 as cash, −£120.20 available, and £384.08 overall owned. It treated internal Savings/Goal movements as cash outflows and then relied on inconsistent goal snapshots; that mixed spendable cash, protected funds, and side-ledger snapshots. The £177.94 of unpaid debt plans are obligations, not cash already paid, so they are not subtracted from Total owned.

## Reconciliation findings — preserve pending review

- The two goal cards store £173.25, while their Finance transaction movements total £126.00 and `goalContributions` totals £218.25. The individual stored goal balances are £57.75 and £115.50; transaction-derived entries matched by goal name are £42.00 and £84.00. These side ledgers disagree, so the app now uses Finance transactions for its simple balance summary and reports the mismatch. It does not rewrite goal cards or delete contributions.
- `debtPayments` contains five £22.03 entries (£110.15), including four for 5 October. Only two £22.03 debt transactions are settled (£44.06), which agrees with Wasik's stored £43.94 remaining from £88.00. One extra October 5 side-ledger row is linked to the canonical transaction; three are unlinked. Keep all rows until the user reviews provenance.
- The checker also flags two repeated goal contribution projection pairs and four debt-payment projections on 5 October. These flags identify possible duplicates for manual review; they do not alter the canonical transaction totals.
- Legacy records without `allocationStatus` remain intact. Existing relation/context is used for the derived balance; ambiguous rows are surfaced for review rather than silently normalized.
- No migration was run, so no pre-migration backup was needed. The supplied backup remains the user's recovery point.

## Accounting and UX changes in this push

- Added a shared transaction-ledger derivation for Spendable, Protected/Reserved, Total owned, and debt outstanding. Goal/savings moves are internal movements; allocated donation/debt/budget amounts reserve spendable money; settled external payments reduce Total owned once.
- Redesigned Overview around one primary Spendable number, three secondary balances, a compact expandable protected/reserved breakdown, separate month/all-time activity, and recent transactions. Removed the competing balance-view selector and repeated cash-flow figure from Overview.
- Collapsed Finance navigation to Overview, Transactions, Funds & goals, Debt, and Reports; secondary features remain under More.
- Simplified Money Timeline to Spendable or Total owned, with event and target filters collapsed by default.
- Transaction entry now supports recording an expense from a protected fund and a single internal transfer between Spendable and funds. These events recalculate from the ledger when edited or removed.
- Added a development-only integrity checker and a read-only backup audit command. No automatic legacy reconciliation or destructive migration is included.

## Verification

The supplied backup was run through the new calculation: £19.30 Spendable + £412.03 Protected/Reserved = £431.33 Total owned. Automated tests cover transfer/reserve semantics, spending from a fund, opening balances, backup nonmutation, duplicate checks and existing finance behavior. The production build is also checked before release. The app does not migrate the conflicting legacy goal/debt side-ledgers; the audit panel keeps them visible for the user to review.
