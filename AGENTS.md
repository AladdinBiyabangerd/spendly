# Spendly

The web app. There is a second implementation of the same product:

    ../spendly-android    (Kotlin / Jetpack Compose, package `az.spendly`)

## The rule: the two apps stay in step

The two are one product with one data model, one Supabase schema, one set of
domain rules and one set of Azerbaijani strings. They are not allowed to
drift. **Whenever you change something here that the Android app also has,
port the change there in the same session, before reporting the work done.**

This is not optional cleanup for later. A change that lands on one side only
means the two apps compute different numbers from the same account, and the
next person to touch either one has no way to tell which is right.

Same in reverse: a change made in `spendly-android` comes back here.

### What to port, and what not to

Port anything that is the product rather than the platform:

- the data model — types, fields, enums, defaults, migrations
- domain logic — every calculation, threshold, classification, rule
- `supabase/schema.sql` — the two files are the same file and must stay
  byte-identical, including comments; both apps talk to one database
- sync and merge behaviour, id generation, conflict resolution
- Azerbaijani user-facing strings — labels, notes, hints, error messages
- screen and dialog structure: which screens exist, what each one shows,
  which actions live where
- tests: a new test here gets its counterpart there

Do **not** port the platform layer: JSX vs Compose, `styles.css` vs
`ui/theme/Theme.kt`, routing, localStorage vs `SnapshotStore`. Match the
behaviour, then write it the way the target codebase already writes things.
**Presentation density may differ by platform:** the phone home screen can
show a shorter default than the web dashboard, as long as the same figures
and capabilities remain reachable.

### File map

| Web | Android (`app/src/main/java/az/spendly/`) |
| --- | --- |
| `src/lib/types.ts` | `domain/Types.kt` |
| `src/lib/calc.ts` | `domain/Calc.kt` |
| `src/lib/csv.ts` | `domain/Csv.kt` |
| `src/lib/analytics.ts` | `domain/Analytics.kt` |
| `src/lib/savings.ts` | `domain/Savings.kt` |
| `src/lib/categories.ts` | `domain/Categories.kt` |
| `src/lib/dates.ts`, `money.ts`, `period.ts`, `validate.ts`, `credentials.ts` | `domain/Dates.kt`, `Money.kt`, `Period.kt`, `Validate.kt`, `Credentials.kt` |
| `src/lib/insights/*.ts` | `domain/insights/*.kt` |
| `src/lib/merge.ts` | `data/Merge.kt` |
| `src/lib/storage.ts` | `data/SnapshotStore.kt` (+ `domain` normalisation) |
| `src/lib/setupHints.ts` | `data/SetupHints.kt` |
| `src/lib/supabase.ts` | `data/SupabaseClient.kt` |
| `src/lib/supabaseRepository.ts` | `data/SupabaseRepository.kt` |
| `src/lib/syncingRepository.ts` | `data/SyncingRepository.kt` |
| `src/store/FinanceProvider.tsx` | `store/FinanceViewModel.kt` |
| `src/store/AuthProvider.tsx` | `store/AuthViewModel.kt` |
| `src/App.tsx` | `ui/SpendlyApp.kt` |
| `src/screens/Dashboard.tsx` | `ui/screens/DashboardScreen.kt` |
| `src/screens/Budget.tsx` | `ui/screens/BudgetScreen.kt` |
| `src/screens/Advice.tsx` | `ui/screens/AdviceScreen.kt` |
| `src/screens/Savings.tsx` | `ui/screens/SavingsScreen.kt` |
| `src/screens/Transactions.tsx` | `ui/screens/TransactionsScreen.kt` |
| `src/components/*Dialog.tsx` | `ui/dialogs/*Dialog.kt` |
| `src/components/AuthScreen.tsx`, `RecoveryScreen.tsx` | `ui/AuthScreen.kt`, `ui/RecoveryScreen.kt` |
| `src/components/charts/*` | `ui/charts/*` |
| `src/lib/__tests__/*.test.ts` | `app/src/test/java/az/spendly/*Test.kt` |
| `supabase/schema.sql` | `supabase/schema.sql` |

Test names differ where the Kotlin file was named after what it checks —
`storage.test.ts` ↔ `StoredSnapshotTest.kt`, `supabaseRepository.test.ts` ↔
`ChangedRowsTest.kt`. Look for the counterpart by subject, not by filename.

### Before saying the work is done

- both sides changed, or a sentence saying why the Android side needs nothing
- web: `npm test`
- android: `./gradlew test` in `../spendly-android`
- if `supabase/schema.sql` moved, `diff` the two copies and expect no output

### Commit messages

Both repos write commit subjects as a plain sentence about what the change
does for the person using the app — see `git log` in either. Keep that voice,
and use the same subject on both sides when it is one change ported across.
