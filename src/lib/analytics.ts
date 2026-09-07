/**
 * The analytics layer.
 *
 * It derives everything from the same `FinanceData` the rest of the app uses —
 * there is no second financial model and nothing is stored pre-computed.
 *
 * Two house rules:
 *   1. Every statement is a calculation, never a judgement. The app reports
 *      "Еда is 24% higher than last month", never "you spend too much".
 *   2. Where a concept needs a definition that the spreadsheet does not supply
 *      (what counts as "unexpected", what counts as "recurring"), the rule is
 *      written down next to the code and surfaced in the UI.
 */

import { round2, sum } from './money'
import { daysInMonth, formatMonthShort, monthOf, toDateKey, weekdayOf } from './dates'
import {
  actualExpenses,
  actualIncome,
  budgetLinesInMonth,
  plannedExpenses,
  transactionsInMonth,
} from './calc'
import { spendableDeltaOf } from './savings'
import type { Period } from './period'
import { previousPeriod } from './period'
import { plannedIncomeOf } from './types'
import type {
  BudgetLine,
  DateKey,
  FinanceData,
  MonthKey,
  Transaction,
} from './types'

/* ------------------------------------------------------------------ *
 * Period basics
 * ------------------------------------------------------------------ */

export interface PeriodSummary {
  /** Sum of income transactions in the period. */
  income: number
  /** Sum of expense transactions in the period. */
  expenses: number
  /** Planned income across the period's months ('BÜDCƏ İCMALI'!C13). */
  plannedIncome: number
  /** Planned expenses across the period's months ('BÜDCƏ İCMALI'!F11). */
  plannedExpenses: number
  /** income - expenses ('BÜDCƏ İCMALI'!D5, summed over the period). */
  remainder: number
  /** plannedIncome - plannedExpenses ('BÜDCƏ İCMALI'!D4). */
  plannedRemainder: number
  /** remainder - plannedRemainder ('BÜDCƏ İCMALI'!D6). */
  difference: number
  /** Share of income retained, 0..1. Null when no income was recorded. */
  savingsRate: number | null
  transactionCount: number
}

export function transactionsInPeriod(
  transactions: Transaction[],
  period: Period,
): Transaction[] {
  const months = new Set(period.months)
  return transactions.filter((transaction) => months.has(monthOf(transaction.date)))
}

export function summarisePeriod(data: FinanceData, period: Period): PeriodSummary {
  const income = sum(period.months.map((month) => actualIncome(data.transactions, month)))
  const expenses = sum(
    period.months.map((month) => actualExpenses(data.transactions, month)),
  )
  const plannedIn = sum(
    period.months.map((month) => {
      const plan = data.incomePlans.find((entry) => entry.month === month)
      return plannedIncomeOf(plan)
    }),
  )
  const plannedOut = sum(
    period.months.map((month) => plannedExpenses(data.budgetLines, month)),
  )

  const remainder = round2(income - expenses)
  const plannedRemainder = round2(plannedIn - plannedOut)

  return {
    income,
    expenses,
    plannedIncome: plannedIn,
    plannedExpenses: plannedOut,
    remainder,
    plannedRemainder,
    difference: round2(remainder - plannedRemainder),
    savingsRate: income > 0 ? remainder / income : null,
    transactionCount: transactionsInPeriod(data.transactions, period).length,
  }
}

/* ------------------------------------------------------------------ *
 * Category breakdown
 * ------------------------------------------------------------------ */

export interface CategoryRow {
  category: string
  actual: number
  planned: number
  /** Share of the period's expenses, 0..1. */
  share: number
  /** Same category in the preceding period of equal length. */
  previous: number
  /** Change vs the previous period, 0..1 scale. Null when previous was zero. */
  changeRatio: number | null
  /** No planned line covered this category in this period. */
  unplanned: boolean
}

/** Ranked spending by category — the 'Əlavə məlumatlar' SUMIF, per period. */
export function categoryBreakdown(data: FinanceData, period: Period): CategoryRow[] {
  const current = expenseByCategory(data.transactions, period)
  const prior = expenseByCategory(data.transactions, previousPeriod(period))
  const planned = plannedByCategory(data.budgetLines, period)
  const total = sum([...current.values()])

  const categories = new Set([...current.keys(), ...planned.keys()])

  return [...categories]
    .map((category) => {
      const actual = current.get(category) ?? 0
      const previous = prior.get(category) ?? 0
      const plannedAmount = planned.get(category) ?? 0
      return {
        category,
        actual,
        planned: plannedAmount,
        share: total > 0 ? actual / total : 0,
        previous,
        changeRatio: previous > 0 ? (actual - previous) / previous : null,
        unplanned: plannedAmount === 0,
      }
    })
    .filter((row) => row.actual > 0 || row.planned > 0)
    .sort((a, b) => b.actual - a.actual || b.planned - a.planned)
}

function expenseByCategory(
  transactions: Transaction[],
  period: Period,
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const transaction of transactionsInPeriod(transactions, period)) {
    if (transaction.type !== 'expense') continue
    const bucket = buckets.get(transaction.category) ?? []
    bucket.push(transaction.amount)
    buckets.set(transaction.category, bucket)
  }
  return new Map([...buckets].map(([category, amounts]) => [category, sum(amounts)]))
}

function plannedByCategory(
  budgetLines: BudgetLine[],
  period: Period,
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const month of period.months) {
    for (const line of budgetLinesInMonth(budgetLines, month)) {
      const bucket = buckets.get(line.category) ?? []
      bucket.push(line.planned)
      buckets.set(line.category, bucket)
    }
  }
  return new Map([...buckets].map(([category, amounts]) => [category, sum(amounts)]))
}

/* ------------------------------------------------------------------ *
 * Expected vs unexpected
 * ------------------------------------------------------------------ */

export interface UnexpectedItem {
  category: string
  amount: number
  /** Why this counts as unexpected. Factual, never a judgement. */
  reason: 'no-plan' | 'over-plan'
  /** The planned amount for the category, for the 'over-plan' reason. */
  planned: number
}

export interface ExpectedSplit {
  expected: number
  unexpected: number
  items: UnexpectedItem[]
}

/**
 * The rule, applied per category:
 *   expected   = the part of the spend that the month's plan covered
 *              = min(actual, planned)
 *   unexpected = spend beyond the planned amount, plus everything spent in a
 *                category with no planned line at all.
 *
 * So expected + unexpected always equals total expenses, and both come
 * straight from 'Aylıq rasxod'. Nothing is guessed.
 */
export function expectedSplit(data: FinanceData, period: Period): ExpectedSplit {
  const rows = categoryBreakdown(data, period)
  const items: UnexpectedItem[] = []
  let expected = 0
  let unexpected = 0

  for (const row of rows) {
    if (row.actual <= 0) continue
    const covered = Math.min(row.actual, row.planned)
    const excess = round2(row.actual - covered)
    expected = round2(expected + covered)
    if (excess > 0) {
      unexpected = round2(unexpected + excess)
      items.push({
        category: row.category,
        amount: excess,
        reason: row.planned === 0 ? 'no-plan' : 'over-plan',
        planned: row.planned,
      })
    }
  }

  return { expected, unexpected, items: items.sort((a, b) => b.amount - a.amount) }
}

/* ------------------------------------------------------------------ *
 * Money flow over time
 * ------------------------------------------------------------------ */

export interface FlowBucket {
  key: string
  label: string
  income: number
  expenses: number
  /** Running balance at the end of this bucket, across all history. */
  balance: number
}

/**
 * Buckets for the flow chart: by week inside a single month, by month across
 * a longer period. Weekly detail on a 6-month view would be unreadable, and
 * monthly granularity on a single month would be a single bar.
 */
export function flowBuckets(data: FinanceData, period: Period): FlowBucket[] {
  return period.months.length === 1
    ? weeklyBuckets(data, period.months[0])
    : monthlyBuckets(data, period.months)
}

function monthlyBuckets(data: FinanceData, months: MonthKey[]): FlowBucket[] {
  // Balance carried in from before the period, so the line starts truthfully.
  let balance = openingBalance(data, months[0])
  return months.map((month) => {
    const income = actualIncome(data.transactions, month)
    const expenses = actualExpenses(data.transactions, month)
    // Money moved to or from a pot is not income or spending, so it is not in
    // either bar — but it does move the balance, so it is in the line.
    const moved = spendableDeltaOf(
      data.savingsEntries.filter((entry) => monthOf(entry.date) === month),
    )
    balance = round2(balance + income - expenses + moved)
    return {
      key: month,
      label: formatMonthShort(month),
      income,
      expenses,
      balance,
    }
  })
}

/** Calendar weeks of the month: 1–7, 8–14, 15–21, 22–end. */
function weeklyBuckets(data: FinanceData, month: MonthKey): FlowBucket[] {
  const last = daysInMonth(month)
  const edges = [1, 8, 15, 22]
  let balance = openingBalance(data, month)
  const transactions = transactionsInMonth(data.transactions, month)
  const entries = data.savingsEntries.filter(
    (entry) => monthOf(entry.date) === month,
  )
  const dayOf = (date: string) => Number(date.slice(8, 10))

  return edges.map((start, index) => {
    const end = index === edges.length - 1 ? last : edges[index + 1] - 1
    const inRange = transactions.filter((transaction) => {
      const day = dayOf(transaction.date)
      return day >= start && day <= end
    })
    const moved = spendableDeltaOf(
      entries.filter((entry) => {
        const day = dayOf(entry.date)
        return day >= start && day <= end
      }),
    )
    const income = sum(
      inRange.filter((t) => t.type === 'income').map((t) => t.amount),
    )
    const expenses = sum(
      inRange.filter((t) => t.type === 'expense').map((t) => t.amount),
    )
    balance = round2(balance + income - expenses + moved)
    return {
      key: `w${index + 1}`,
      label: `${start}–${end}`,
      income,
      expenses,
      balance,
    }
  })
}

/** Net of everything strictly before `month`, savings movements included, so
 *  the line starts where the balance on screen actually stands. */
function openingBalance(data: FinanceData, month: MonthKey): number {
  return round2(
    sum(
      data.transactions
        .filter((transaction) => monthOf(transaction.date) < month)
        .map((transaction) =>
          transaction.type === 'income' ? transaction.amount : -transaction.amount,
        ),
    ) +
      spendableDeltaOf(
        data.savingsEntries.filter((entry) => monthOf(entry.date) < month),
      ),
  )
}

/* ------------------------------------------------------------------ *
 * Daily activity
 * ------------------------------------------------------------------ */

export interface DayActivity {
  date: DateKey
  day: number
  income: number
  expenses: number
  transactions: Transaction[]
}

/** Every day of a single month, including the empty ones. */
export function dailyActivity(data: FinanceData, month: MonthKey): DayActivity[] {
  const [year, monthIndex] = month.split('-').map(Number)
  const transactions = transactionsInMonth(data.transactions, month)

  return Array.from({ length: daysInMonth(month) }, (_, index) => {
    const date = toDateKey(year, monthIndex, index + 1)
    const onDay = transactions.filter((transaction) => transaction.date === date)
    return {
      date,
      day: index + 1,
      income: sum(onDay.filter((t) => t.type === 'income').map((t) => t.amount)),
      expenses: sum(onDay.filter((t) => t.type === 'expense').map((t) => t.amount)),
      transactions: onDay,
    }
  })
}

/** Biggest movements in the period, largest first. */
export function largestTransactions(
  data: FinanceData,
  period: Period,
  limit = 5,
): Transaction[] {
  return transactionsInPeriod(data.transactions, period)
    .filter((transaction) => transaction.type === 'expense')
    .sort((a, b) => b.amount - a.amount || (a.date < b.date ? 1 : -1))
    .slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * Recurring commitments
 * ------------------------------------------------------------------ */

export interface Recurring {
  description: string
  category: string
  planned: number
  /** Transactions whose description matches this line, in the same month. */
  matched: Transaction[]
  actual: number
}

/**
 * The rule: a planned line counts as recurring when the same description is
 * planned in this month and in at least one earlier month. That is exactly how
 * the spreadsheet expressed recurrence — the same rows, copied forward.
 *
 * Payment status is reported by matching a transaction's description to the
 * line's, case- and space-insensitively. This describes the data ("no matching
 * transaction"), and deliberately does not claim a bill went unpaid.
 */
export function recurringCommitments(data: FinanceData, month: MonthKey): Recurring[] {
  const lines = budgetLinesInMonth(data.budgetLines, month)
  const earlier = new Set(
    data.budgetLines
      .filter((line) => line.month < month)
      .map((line) => normalise(line.description)),
  )
  const transactions = transactionsInMonth(data.transactions, month).filter(
    (transaction) => transaction.type === 'expense',
  )

  return lines
    .filter((line) => earlier.has(normalise(line.description)))
    .map((line) => {
      const matched = transactions.filter(
        (transaction) => normalise(transaction.description) === normalise(line.description),
      )
      return {
        description: line.description,
        category: line.category,
        planned: line.planned,
        matched,
        actual: sum(matched.map((transaction) => transaction.amount)),
      }
    })
    .sort((a, b) => b.planned - a.planned)
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/* ------------------------------------------------------------------ *
 * Insights
 * ------------------------------------------------------------------ */

export type InsightTone = 'neutral' | 'positive' | 'attention'

export interface Insight {
  id: string
  text: string
  tone: InsightTone
}

/** Below this, a percentage change is noise rather than a pattern. */
const MATERIAL_CHANGE = 0.1
/** Below this, an amount is too small to be worth a line of the summary. */
const MATERIAL_AMOUNT = 5
/**
 * When spending grew, the previous figure must be at least this share of the
 * new one for a percentage to be a rate of change rather than a start.
 * At 0.2 the largest reportable increase is 400% — above that the "previous
 * period" was too thin to compare (first week of use, a single fare).
 */
const COMPARABLE_SHARE = 0.2

/**
 * Whether `previous → current` can support a percentage claim.
 *
 * A near-empty previous period against a full month produces ratios like
 * 22 000% — arithmetic that is true and useless. The baseline has to be
 * material in absolute terms, and on growth large enough relative to the
 * new figure. Decreases from a solid base stay percentage-worthy even when
 * the new figure is small.
 */
function canStatePercentChange(previous: number, current: number): boolean {
  if (previous < MATERIAL_AMOUNT) return false
  if (current > previous && previous < current * COMPARABLE_SHARE) return false
  return true
}

/**
 * Deterministic observations, ordered by how much they matter.
 *
 * Every entry is an arithmetic fact about the data. None of them advise, and
 * an insight is omitted entirely when the data cannot support it — a month
 * with no predecessor produces no comparisons rather than invented ones.
 *
 * Sentences are impersonal ("qalıb", not "saxladınız") so the app reports on
 * the money rather than addressing the person spending it.
 *
 * None of them names the period being compared against, either. Four lines of
 * one panel each ending "əvvəlki dövrə nisbətən" is the same clause read four
 * times; the panel says it once, above them.
 */
export function insights(data: FinanceData, period: Period): Insight[] {
  const previous = previousPeriod(period)
  const now = summarisePeriod(data, period)
  const before = summarisePeriod(data, previous)
  const rows = categoryBreakdown(data, period)
  const result: Insight[] = []

  if (now.transactionCount === 0) return result

  const hasHistory = before.transactionCount > 0

  // Overall spend against the plan.
  if (now.plannedExpenses > 0 && now.expenses > 0) {
    const ratio = (now.expenses - now.plannedExpenses) / now.plannedExpenses
    if (Math.abs(ratio) >= MATERIAL_CHANGE) {
      result.push({
        id: 'plan',
        text:
          ratio > 0
            ? `Xərclər plandan ${percent(ratio)} çoxdur — ${money(now.expenses - now.plannedExpenses)} artıq xərclənib.`
            : `Xərclər plandan ${percent(-ratio)} azdır — ${money(now.plannedExpenses - now.expenses)} hələ büdcədə qalıb.`,
        tone: ratio > 0 ? 'attention' : 'positive',
      })
    }
  }

  // Total spending against the comparable previous period.
  if (
    hasHistory &&
    before.expenses > 0 &&
    now.expenses > 0 &&
    canStatePercentChange(before.expenses, now.expenses)
  ) {
    const ratio = (now.expenses - before.expenses) / before.expenses
    if (Math.abs(ratio) >= MATERIAL_CHANGE) {
      result.push({
        id: 'spend-change',
        text: `Ümumi xərclər ${percent(Math.abs(ratio))} ${
          ratio > 0 ? 'artıb' : 'azalıb'
        }.`,
        tone: ratio > 0 ? 'attention' : 'positive',
      })
    }
  }

  // Income against the comparable previous period.
  if (hasHistory && before.income > 0 && now.income > 0) {
    const delta = round2(now.income - before.income)
    if (Math.abs(delta) >= MATERIAL_AMOUNT) {
      result.push({
        id: 'income-change',
        text: `Gəlir ${money(Math.abs(delta))} ${
          delta > 0 ? 'artıb' : 'azalıb'
        }.`,
        tone: delta > 0 ? 'positive' : 'attention',
      })
    }
  }

  // The largest category, and whether it took over the top spot.
  const top = rows.find((row) => row.actual > 0)
  if (top) {
    const priorRows = categoryBreakdown(data, previous)
    const priorTop = priorRows.find((row) => row.actual > 0)
    const changedLead = hasHistory && priorTop && priorTop.category !== top.category
    result.push({
      id: 'top-category',
      text: changedLead
        ? `Ən böyük xərc indi ${top.category} — ${money(top.actual)}; əvvəl ${priorTop.category} idi.`
        : `Ən böyük xərc ${top.category} — ${money(top.actual)}, bütün xərclərin ${percent(top.share)}-i.`,
      tone: 'neutral',
    })
  }

  // The category that moved the most, in either direction.
  const movers = rows
    .filter(
      (row) =>
        row.changeRatio !== null &&
        Math.abs(row.changeRatio) >= MATERIAL_CHANGE &&
        Math.abs(row.actual - row.previous) >= MATERIAL_AMOUNT &&
        canStatePercentChange(row.previous, row.actual),
    )
    .sort(
      (a, b) => Math.abs(b.actual - b.previous) - Math.abs(a.actual - a.previous),
    )
  for (const row of movers.slice(0, 2)) {
    const ratio = row.changeRatio as number
    result.push({
      id: `mover-${row.category}`,
      text: `${row.category} xərcləri ${percent(Math.abs(ratio))} ${
        ratio > 0 ? 'artıb' : 'azalıb'
      } (${money(row.actual)} / ${money(row.previous)}).`,
      tone: ratio > 0 ? 'attention' : 'positive',
    })
  }

  // Money retained.
  if (now.income > 0) {
    result.push({
      id: 'retained',
      text:
        now.remainder >= 0
          ? `Daxil olan ${money(now.income)} məbləğdən ${money(now.remainder)} qalıb${
              now.savingsRate !== null ? ` — gəlirin ${percent(now.savingsRate)}-i` : ''
            }.`
          : `Daxil olandan ${money(-now.remainder)} çox xərclənib.`,
      tone: now.remainder >= 0 ? 'positive' : 'attention',
    })
  }

  return result
}

function percent(ratio: number): string {
  return `${Math.round(Math.abs(ratio) * 100)}%`
}

function money(value: number): string {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(value))} ₼`
}

/* ------------------------------------------------------------------ *
 * Income by source
 * ------------------------------------------------------------------ */

export interface IncomeSource {
  category: string
  actual: number
  /** 'BÜDCƏ İCMALI'!C11:C12 for the period's months, per row. */
  planned: number
  /** Share of the period's income, 0..1. */
  share: number
}

/**
 * Where income came from, against what was planned for it.
 *
 * Both sides are per category: the plan holds a figure for each income
 * category the user keeps, and anything that arrived under a category with no
 * planned figure is reported with a planned amount of zero rather than being
 * folded into something else.
 */
export function incomeSources(data: FinanceData, period: Period): IncomeSource[] {
  const months = new Set(period.months)

  const actual = new Map<string, number>()
  for (const transaction of data.transactions) {
    if (transaction.type !== 'income') continue
    if (!months.has(monthOf(transaction.date))) continue
    actual.set(
      transaction.category,
      round2((actual.get(transaction.category) ?? 0) + transaction.amount),
    )
  }

  const planned = new Map<string, number>()
  for (const plan of data.incomePlans) {
    if (!months.has(plan.month)) continue
    for (const [category, amount] of Object.entries(plan.amounts)) {
      planned.set(category, round2((planned.get(category) ?? 0) + amount))
    }
  }

  const total = sum([...actual.values()])

  return [...new Set([...actual.keys(), ...planned.keys()])]
    .map((category) => ({
      category,
      actual: actual.get(category) ?? 0,
      planned: planned.get(category) ?? 0,
      share: total > 0 ? (actual.get(category) ?? 0) / total : 0,
    }))
    .filter((row) => row.actual > 0 || row.planned > 0)
    .sort((a, b) => b.actual - a.actual || b.planned - a.planned)
}

/* ------------------------------------------------------------------ *
 * Spending pace
 * ------------------------------------------------------------------ */

export interface SpendingPace {
  /** Days of the month that have happened, 1..days. */
  elapsed: number
  days: number
  spent: number
  planned: number
  /** Spent so far divided by the days it was spent over. */
  perDay: number
  /** `perDay × days`. An extrapolation of the rate so far, and nothing more. */
  atThisRate: number
  /** The month is over, so `atThisRate` is simply what was spent. */
  complete: boolean
}

/**
 * How fast the month is being spent.
 *
 * `atThisRate` extends the rate so far across the whole month. It is
 * arithmetic on days elapsed, not a forecast of behaviour, and the UI says so
 * — for a month that has already ended it is just the total, and is labelled
 * as an average instead.
 */
export function spendingPace(
  data: FinanceData,
  month: MonthKey,
  asOf: DateKey,
): SpendingPace | null {
  const days = daysInMonth(month)
  const current = monthOf(asOf)

  // A month that has not started yet has no rate to report.
  if (month > current) return null

  const complete = month < current
  const elapsed = complete ? days : Math.min(Number(asOf.slice(8, 10)), days)
  if (elapsed <= 0) return null

  const spent = actualExpenses(data.transactions, month)
  const perDay = round2(spent / elapsed)

  return {
    elapsed,
    days,
    spent,
    planned: plannedExpenses(data.budgetLines, month),
    perDay,
    atThisRate: complete ? spent : round2(perDay * days),
    complete,
  }
}

/* ------------------------------------------------------------------ *
 * Weekday pattern
 * ------------------------------------------------------------------ */

export interface WeekdayLoad {
  /** 0 = Monday, 6 = Sunday. */
  weekday: number
  expenses: number
  count: number
}

/** Spending by day of the week. Always seven entries, Monday first. */
export function weekdayPattern(data: FinanceData, period: Period): WeekdayLoad[] {
  const rows: WeekdayLoad[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    expenses: 0,
    count: 0,
  }))

  for (const transaction of transactionsInPeriod(data.transactions, period)) {
    if (transaction.type !== 'expense') continue
    const row = rows[weekdayOf(transaction.date)]
    row.expenses = round2(row.expenses + transaction.amount)
    row.count += 1
  }

  return rows
}

/* ------------------------------------------------------------------ *
 * What repeats
 * ------------------------------------------------------------------ */

export interface FrequentExpense {
  description: string
  category: string
  count: number
  total: number
}

/**
 * The expenses that keep coming back, by description.
 *
 * This is the transaction-side counterpart of `recurringCommitments`, which
 * only sees what the plan named. Something bought every week without a budget
 * line for it is invisible there and is exactly what this surfaces, so a
 * single entry is not interesting — two or more is the threshold.
 */
export function frequentExpenses(
  data: FinanceData,
  period: Period,
  limit: number,
): FrequentExpense[] {
  const groups = new Map<string, FrequentExpense>()

  for (const transaction of transactionsInPeriod(data.transactions, period)) {
    if (transaction.type !== 'expense') continue
    const key = normalise(transaction.description)
    if (key === '') continue

    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.total = round2(existing.total + transaction.amount)
    } else {
      groups.set(key, {
        description: transaction.description,
        category: transaction.category,
        count: 1,
        total: round2(transaction.amount),
      })
    }
  }

  return [...groups.values()]
    .filter((row) => row.count > 1)
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, limit)
}
