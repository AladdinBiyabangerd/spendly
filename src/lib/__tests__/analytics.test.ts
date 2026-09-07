import { describe, expect, it } from 'vitest'
import {
  categoryBreakdown,
  dailyActivity,
  expectedSplit,
  flowBuckets,
  frequentExpenses,
  incomeSources,
  insights,
  largestTransactions,
  recurringCommitments,
  spendingPace,
  summarisePeriod,
  transactionsInPeriod,
  weekdayPattern,
} from '../analytics'
import { PERIODS, comparisonLabel, previousPeriod, resolvePeriod } from '../period'
import { sum } from '../money'
import { formatMonthShort } from '../dates'
import { sheetCategories } from './fixtures'
import type { FinanceData, Transaction } from '../types'

const ANCHOR = '2026-08'

function build(partial: Partial<FinanceData> = {}): FinanceData {
  return {
    transactions: [],
    budgetLines: [],
    incomePlans: [],
    categories: sheetCategories(),
    savingsPots: [],
    savingsEntries: [],
    savingsPlans: [],
    ...partial,
  }
}

let counter = 0
function tx(over: Partial<Transaction> = {}): Transaction {
  counter += 1
  return {
    id: `t${counter}`,
    date: `${ANCHOR}-05`,
    type: 'expense',
    category: 'Ərzaq',
    description: 'Test',
    amount: 10,
    ...over,
  }
}

const month = resolvePeriod('month', ANCHOR)

/* ------------------------------------------------------------------ *
 * Periods
 * ------------------------------------------------------------------ */

describe('periods', () => {
  it('anchors every preset on the selected month', () => {
    expect(resolvePeriod('month', ANCHOR).months).toEqual(['2026-08'])
    expect(resolvePeriod('last', ANCHOR).months).toEqual(['2026-07'])
    expect(resolvePeriod('quarter', ANCHOR).months).toEqual([
      '2026-06', '2026-07', '2026-08',
    ])
    expect(resolvePeriod('half', ANCHOR).months).toHaveLength(6)
    expect(resolvePeriod('half', ANCHOR).months.at(-1)).toBe('2026-08')
  })

  it('runs this-year from January to the anchor month', () => {
    expect(resolvePeriod('year', '2026-03').months).toEqual([
      '2026-01', '2026-02', '2026-03',
    ])
    expect(resolvePeriod('year', '2026-01').months).toEqual(['2026-01'])
  })

  it('compares against an equally long preceding run', () => {
    expect(previousPeriod(resolvePeriod('month', ANCHOR)).months).toEqual(['2026-07'])
    expect(previousPeriod(resolvePeriod('quarter', ANCHOR)).months).toEqual([
      '2026-03', '2026-04', '2026-05',
    ])
  })

  it('crosses the year boundary correctly', () => {
    expect(resolvePeriod('quarter', '2026-01').months).toEqual([
      '2025-11', '2025-12', '2026-01',
    ])
  })

  it('never produces an empty period', () => {
    for (const preset of PERIODS) {
      expect(resolvePeriod(preset.id, ANCHOR).months.length).toBeGreaterThan(0)
    }
  })

  it('words the comparison to match the period length', () => {
    expect(comparisonLabel(resolvePeriod('month', ANCHOR))).toBe('keçən aya nisbətən')
    expect(comparisonLabel(resolvePeriod('quarter', ANCHOR))).toBe(
      'əvvəlki 3 aya nisbətən',
    )
  })
})

/* ------------------------------------------------------------------ *
 * Period summary — same logic as the sheet, summed over months
 * ------------------------------------------------------------------ */

describe('period summary', () => {
  const data = build({
    transactions: [
      tx({ date: '2026-07-01', type: 'income', category: 'Maaş', amount: 990 }),
      tx({ date: '2026-07-10', amount: 400 }),
      tx({ date: '2026-08-01', type: 'income', category: 'Maaş', amount: 990 }),
      tx({ date: '2026-08-10', amount: 200 }),
    ],
    budgetLines: [
      { id: 'b1', month: '2026-07', description: 'x', category: 'Ərzaq', planned: 500 },
      { id: 'b2', month: '2026-08', description: 'y', category: 'Ərzaq', planned: 300 },
    ],
    incomePlans: [
      { month: '2026-07', amounts: { 'Maaş': 990 } },
      { month: '2026-08', amounts: { 'Maaş': 990, 'Əlavə gəlir': 10 } },
    ],
  })

  it('matches the sheet for a single month', () => {
    const summary = summarisePeriod(data, month)
    expect(summary.income).toBe(990)
    expect(summary.expenses).toBe(200)
    expect(summary.plannedIncome).toBe(1000)
    expect(summary.plannedExpenses).toBe(300)
    expect(summary.remainder).toBe(790) // D5
    expect(summary.plannedRemainder).toBe(700) // D4
    expect(summary.difference).toBe(90) // D6
  })

  it('sums planned and actual across a multi-month period', () => {
    const summary = summarisePeriod(data, resolvePeriod('quarter', ANCHOR))
    expect(summary.income).toBe(1980)
    expect(summary.expenses).toBe(600)
    expect(summary.plannedExpenses).toBe(800) // 500 + 300
    expect(summary.plannedIncome).toBe(1990)
    expect(summary.remainder).toBe(1380)
  })

  it('reports a savings rate only when income exists', () => {
    expect(summarisePeriod(data, month).savingsRate).toBeCloseTo(790 / 990)
    expect(summarisePeriod(build(), month).savingsRate).toBeNull()
  })

  it('is all zeroes for an empty period, never NaN', () => {
    const summary = summarisePeriod(build(), month)
    expect(Object.values(summary).every((v) => v === 0 || v === null)).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * Category breakdown
 * ------------------------------------------------------------------ */

describe('category breakdown', () => {
  const data = build({
    transactions: [
      tx({ date: '2026-07-05', category: 'Ərzaq', amount: 100 }),
      tx({ date: '2026-08-05', category: 'Ərzaq', amount: 124 }),
      tx({ date: '2026-08-06', category: 'Əyləncə', amount: 76 }),
    ],
    budgetLines: [
      { id: 'b', month: '2026-08', description: 'x', category: 'Ərzaq', planned: 100 },
    ],
  })

  it('ranks by spend and computes each share of the total', () => {
    const rows = categoryBreakdown(data, month)
    expect(rows[0].category).toBe('Ərzaq')
    expect(rows[0].actual).toBe(124)
    expect(rows[0].share).toBeCloseTo(124 / 200)
    expect(rows[1].share).toBeCloseTo(76 / 200)
    expect(sum(rows.map((row) => row.share))).toBeCloseTo(1)
  })

  it('computes the change against the previous period', () => {
    const rows = categoryBreakdown(data, month)
    const food = rows.find((row) => row.category === 'Ərzaq')!
    expect(food.previous).toBe(100)
    expect(food.changeRatio).toBeCloseTo(0.24) // 100 -> 124
  })

  it('leaves the change undefined when there is nothing to compare with', () => {
    const rows = categoryBreakdown(data, month)
    expect(rows.find((row) => row.category === 'Əyləncə')!.changeRatio).toBeNull()
  })

  it('flags a category with no planned line', () => {
    const rows = categoryBreakdown(data, month)
    expect(rows.find((row) => row.category === 'Ərzaq')!.unplanned).toBe(false)
    expect(rows.find((row) => row.category === 'Əyləncə')!.unplanned).toBe(true)
  })

  it('keeps a planned category that was never spent on', () => {
    const idle = build({
      budgetLines: [
        { id: 'b', month: '2026-08', description: 'x', category: 'İdman', planned: 40 },
      ],
    })
    const row = categoryBreakdown(idle, month)[0]
    expect(row).toMatchObject({ category: 'İdman', actual: 0, planned: 40, share: 0 })
  })
})

/* ------------------------------------------------------------------ *
 * Expected vs unexpected
 * ------------------------------------------------------------------ */

describe('expected vs unexpected', () => {
  it('splits at the planned amount and always reconciles to the total', () => {
    const data = build({
      transactions: [
        tx({ category: 'Ərzaq', amount: 124 }), // 100 planned -> 24 over
        tx({ category: 'Əyləncə', amount: 76 }), // nothing planned -> all 76
        tx({ category: 'İdman', amount: 30 }), // 40 planned -> fully covered
      ],
      budgetLines: [
        { id: 'b1', month: '2026-08', description: 'a', category: 'Ərzaq', planned: 100 },
        { id: 'b2', month: '2026-08', description: 'b', category: 'İdman', planned: 40 },
      ],
    })
    const split = expectedSplit(data, month)

    expect(split.expected).toBe(130) // 100 covered + 30 covered
    expect(split.unexpected).toBe(100) // 24 over + 76 unbudgeted
    expect(split.expected + split.unexpected).toBe(
      summarisePeriod(data, month).expenses,
    )
  })

  it('explains each unexpected item with its reason, biggest first', () => {
    const data = build({
      transactions: [
        tx({ category: 'Ərzaq', amount: 124 }),
        tx({ category: 'Əyləncə', amount: 76 }),
      ],
      budgetLines: [
        { id: 'b1', month: '2026-08', description: 'a', category: 'Ərzaq', planned: 100 },
      ],
    })
    const { items } = expectedSplit(data, month)
    expect(items[0]).toMatchObject({ category: 'Əyləncə', amount: 76, reason: 'no-plan' })
    expect(items[1]).toMatchObject({ category: 'Ərzaq', amount: 24, reason: 'over-plan', planned: 100 })
  })

  it('reports nothing unexpected when everything stayed within plan', () => {
    const data = build({
      transactions: [tx({ category: 'Ərzaq', amount: 50 })],
      budgetLines: [
        { id: 'b1', month: '2026-08', description: 'a', category: 'Ərzaq', planned: 100 },
      ],
    })
    const split = expectedSplit(data, month)
    expect(split.unexpected).toBe(0)
    expect(split.items).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Flow buckets
 * ------------------------------------------------------------------ */

describe('flow buckets', () => {
  it('uses weeks for a single month and months for longer periods', () => {
    const data = build({ transactions: [tx({ date: '2026-08-03', amount: 10 })] })
    expect(flowBuckets(data, month)).toHaveLength(4)
    expect(flowBuckets(data, resolvePeriod('quarter', ANCHOR))).toHaveLength(3)
  })

  it('assigns each day to exactly one week bucket', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-08-01', amount: 1 }),
        tx({ date: '2026-08-07', amount: 2 }),
        tx({ date: '2026-08-08', amount: 4 }),
        tx({ date: '2026-08-21', amount: 8 }),
        tx({ date: '2026-08-22', amount: 16 }),
        tx({ date: '2026-08-31', amount: 32 }),
      ],
    })
    const buckets = flowBuckets(data, month)
    expect(buckets.map((b) => b.expenses)).toEqual([3, 4, 8, 48])
    expect(sum(buckets.map((b) => b.expenses))).toBe(63)
  })

  it('carries the opening balance in so the line starts truthfully', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-05-01', type: 'income', category: 'Maaş', amount: 500 }),
        tx({ date: '2026-08-02', amount: 100 }),
      ],
    })
    const buckets = flowBuckets(data, month)
    expect(buckets[0].balance).toBe(400) // 500 carried in, 100 out
    expect(buckets.at(-1)!.balance).toBe(400)
  })

  it('gives every month a distinct short label', () => {
    // İyun and İyul share their first three letters; sliced names collide.
    const labels = Array.from({ length: 12 }, (_, index) =>
      formatMonthShort(`2026-${String(index + 1).padStart(2, '0')}`),
    )
    expect(new Set(labels).size).toBe(12)
  })

  it('labels multi-month buckets with the month name', () => {
    const buckets = flowBuckets(build(), resolvePeriod('quarter', ANCHOR))
    expect(buckets.map((b) => b.label)).toEqual(['İyn', 'İyl', 'Avq'])
  })
})

/* ------------------------------------------------------------------ *
 * Daily activity, largest
 * ------------------------------------------------------------------ */

describe('daily activity', () => {
  it('covers every day of the month including empty ones', () => {
    const days = dailyActivity(build(), '2026-08')
    expect(days).toHaveLength(31)
    expect(days.every((day) => day.transactions.length === 0)).toBe(true)
  })

  it('handles February in a leap year', () => {
    expect(dailyActivity(build(), '2024-02')).toHaveLength(29)
    expect(dailyActivity(build(), '2026-02')).toHaveLength(28)
  })

  it('groups several transactions on the same day', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-08-09', amount: 10 }),
        tx({ date: '2026-08-09', amount: 15 }),
        tx({ date: '2026-08-09', type: 'income', category: 'Maaş', amount: 500 }),
      ],
    })
    const day = dailyActivity(data, '2026-08').find((entry) => entry.day === 9)!
    expect(day.expenses).toBe(25)
    expect(day.income).toBe(500)
    expect(day.transactions).toHaveLength(3)
  })
})

describe('largest expenses', () => {
  it('ranks expenses only, biggest first', () => {
    const data = build({
      transactions: [
        tx({ amount: 30 }),
        tx({ amount: 300 }),
        tx({ type: 'income', category: 'Maaş', amount: 9000 }),
        tx({ amount: 120 }),
      ],
    })
    const largest = largestTransactions(data, month, 5)
    expect(largest.map((t) => t.amount)).toEqual([300, 120, 30])
    expect(largest.every((t) => t.type === 'expense')).toBe(true)
  })

  it('respects the limit', () => {
    const data = build({
      transactions: Array.from({ length: 10 }, (_, i) => tx({ amount: i + 1 })),
    })
    expect(largestTransactions(data, month, 3)).toHaveLength(3)
  })
})

/* ------------------------------------------------------------------ *
 * Recurring
 * ------------------------------------------------------------------ */

describe('recurring commitments', () => {
  const data = build({
    budgetLines: [
      { id: 'a', month: '2026-07', description: 'Ev kirəsi', category: 'Əlavə xərclər', planned: 230 },
      { id: 'b', month: '2026-08', description: 'Ev kirəsi', category: 'Əlavə xərclər', planned: 230 },
      { id: 'c', month: '2026-08', description: 'Yeni xərc', category: 'Ərzaq', planned: 50 },
    ],
    transactions: [
      tx({ date: '2026-08-01', category: 'Əlavə xərclər', description: 'ev kirəsi', amount: 230 }),
    ],
  })

  it('counts a line as recurring only when it was planned before too', () => {
    const items = recurringCommitments(data, '2026-08')
    expect(items.map((item) => item.description)).toEqual(['Ev kirəsi'])
  })

  it('matches a payment by description, ignoring case and spacing', () => {
    const [rent] = recurringCommitments(data, '2026-08')
    expect(rent.matched).toHaveLength(1)
    expect(rent.actual).toBe(230)
  })

  it('reports no match rather than claiming a bill is unpaid', () => {
    const unmatched = build({
      budgetLines: data.budgetLines,
      transactions: [tx({ date: '2026-08-01', description: 'something else', amount: 230 })],
    })
    const [rent] = recurringCommitments(unmatched, '2026-08')
    expect(rent.matched).toEqual([])
    expect(rent.actual).toBe(0)
  })

  it('finds nothing in the very first month', () => {
    expect(recurringCommitments(data, '2026-07')).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Insights — facts only, and silence when the data cannot support them
 * ------------------------------------------------------------------ */

describe('insights', () => {
  it('says nothing at all when there are no transactions', () => {
    expect(insights(build(), month)).toEqual([])
  })

  it('makes no comparison when there is no previous period', () => {
    const data = build({ transactions: [tx({ amount: 50 })] })
    const ids = insights(data, month).map((fact) => fact.id)
    expect(ids).not.toContain('spend-change')
    expect(ids).not.toContain('income-change')
  })

  it('reports a material change against the previous period', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-07-05', amount: 100 }),
        tx({ date: '2026-08-05', amount: 150 }),
      ],
    })
    const change = insights(data, month).find((fact) => fact.id === 'spend-change')!
    expect(change.text).toContain('50%')
    expect(change.text).toContain('artıb')
    expect(change.tone).toBe('attention')
  })

  it('ignores changes too small to be a pattern', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-07-05', amount: 100 }),
        tx({ date: '2026-08-05', amount: 103 }),
      ],
    })
    expect(insights(data, month).map((f) => f.id)).not.toContain('spend-change')
  })

  it('does not invent a percentage from a near-empty previous period', () => {
    // First week of use: a few fares, then a full month — 22 000% is true
    // arithmetic and useless. Same for a category that went 1.80 → 9.95.
    const data = build({
      transactions: [
        tx({ date: '2026-07-28', category: 'Nəqliyyat', amount: 1.8 }),
        tx({ date: '2026-07-29', category: 'İşdə yemək', amount: 6 }),
        tx({ date: '2026-08-05', category: 'Kreditlər', amount: 843.56 }),
        tx({ date: '2026-08-06', category: 'Nəqliyyat', amount: 9.95 }),
        tx({ date: '2026-08-07', category: 'Ərzaq', amount: 900 }),
        tx({ date: '2026-08-01', type: 'income', category: 'Maaş', amount: 1800 }),
      ],
    })
    const ids = insights(data, month).map((fact) => fact.id)
    expect(ids).not.toContain('spend-change')
    expect(ids.some((id) => id.startsWith('mover-'))).toBe(false)
  })

  it('still states a percentage when both periods are comparable', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-07-05', category: 'Ərzaq', amount: 200 }),
        tx({ date: '2026-08-05', category: 'Ərzaq', amount: 280 }),
      ],
    })
    const change = insights(data, month).find((fact) => fact.id === 'spend-change')!
    expect(change.text).toContain('40%')
    const mover = insights(data, month).find((fact) => fact.id === 'mover-Ərzaq')!
    expect(mover.text).toContain('40%')
  })

  it('names the largest category and its share', () => {
    const data = build({
      transactions: [tx({ category: 'Ərzaq', amount: 80 }), tx({ category: 'İdman', amount: 20 })],
    })
    const top = insights(data, month).find((fact) => fact.id === 'top-category')!
    expect(top.text).toContain('Ərzaq')
    expect(top.text).toContain('80%')
  })

  it('notes when a different category has taken the top spot', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-07-05', category: 'Ərzaq', amount: 200 }),
        tx({ date: '2026-08-05', category: 'Kreditlər', amount: 300 }),
      ],
    })
    const top = insights(data, month).find((fact) => fact.id === 'top-category')!
    // The panel's own note says which period "before" is, so the line only has
    // to name the category that used to lead.
    expect(top.text).toContain('əvvəl')
    expect(top.text).toContain('Ərzaq')
  })

  it('never advises, only states', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-07-05', amount: 100 }),
        tx({ date: '2026-08-05', amount: 400 }),
        tx({ date: '2026-08-01', type: 'income', category: 'Maaş', amount: 900 }),
      ],
      budgetLines: [
        { id: 'b', month: '2026-08', description: 'x', category: 'Ərzaq', planned: 100 },
      ],
    })
    // Advisory language in both the app's language and the one it was
    // translated from, so the guard cannot quietly become vacuous.
    const banned = [
      'çox xərcləyirsiniz',
      'azaltmalısınız',
      'məsləhət',
      'çalışın',
      'lazımdır',
      'tövsiyə',
      'should',
      'too much',
      'try to',
      'consider',
      'you need',
    ]
    for (const fact of insights(data, month)) {
      for (const phrase of banned) {
        expect(fact.text.toLowerCase()).not.toContain(phrase)
      }
    }
  })

  it('reports money retained, or overspend, from real figures', () => {
    const data = build({
      transactions: [
        tx({ date: '2026-08-01', type: 'income', category: 'Maaş', amount: 1000 }),
        tx({ date: '2026-08-05', amount: 250 }),
      ],
    })
    const kept = insights(data, month).find((fact) => fact.id === 'retained')!
    expect(kept.text).toContain('750.00 ₼')
    expect(kept.tone).toBe('positive')
  })
})

/* ------------------------------------------------------------------ *
 * The dashboard never invents money
 * ------------------------------------------------------------------ */

describe('reconciliation', () => {
  const data = build({
    transactions: [
      tx({ date: '2026-08-02', category: 'Kreditlər', amount: 220 }),
      tx({ date: '2026-08-05', category: 'Ərzaq', amount: 63.25 }),
      tx({ date: '2026-08-09', category: 'Ərzaq', amount: 48.6 }),
      tx({ date: '2026-08-16', category: 'Əyləncə', amount: 18.4 }),
      tx({ date: '2026-08-18', type: 'income', category: 'Maaş', amount: 990 }),
    ],
    budgetLines: [
      { id: 'b1', month: '2026-08', description: 'a', category: 'Kreditlər', planned: 220 },
      { id: 'b2', month: '2026-08', description: 'b', category: 'Ərzaq', planned: 100 },
    ],
  })

  it('agrees across every view of the same period', () => {
    const summary = summarisePeriod(data, month)
    const rows = categoryBreakdown(data, month)
    const split = expectedSplit(data, month)
    const buckets = flowBuckets(data, month)
    const days = dailyActivity(data, '2026-08')

    expect(summary.expenses).toBe(350.25)
    expect(sum(rows.map((row) => row.actual))).toBe(summary.expenses)
    expect(split.expected + split.unexpected).toBe(summary.expenses)
    expect(sum(buckets.map((b) => b.expenses))).toBe(summary.expenses)
    expect(sum(days.map((d) => d.expenses))).toBe(summary.expenses)
    expect(sum(buckets.map((b) => b.income))).toBe(summary.income)
    expect(transactionsInPeriod(data.transactions, month)).toHaveLength(5)
  })
})

/* ------------------------------------------------------------------ *
 * Income by source
 * ------------------------------------------------------------------ */

describe('incomeSources', () => {
  it('reports each source against its planned row', () => {
    const data = build({
      transactions: [
        tx({ type: 'income', category: 'Maaş', amount: 900 }),
        tx({ type: 'income', category: 'Əlavə gəlir', amount: 100 }),
      ],
      incomePlans: [{ month: ANCHOR, amounts: { 'Maaş': 990, 'Əlavə gəlir': 50 } }],
    })

    const [salary, additional] = incomeSources(data, month)
    expect(salary).toMatchObject({ actual: 900, planned: 990 })
    expect(additional).toMatchObject({ actual: 100, planned: 50 })
    expect(salary.share).toBeCloseTo(0.9)
  })

  it('sums the plan across a multi-month period', () => {
    const data = build({
      incomePlans: [
        { month: '2026-07', amounts: { 'Maaş': 500 } },
        { month: ANCHOR, amounts: { 'Maaş': 600 } },
      ],
    })

    const rows = incomeSources(data, resolvePeriod('quarter', ANCHOR))
    expect(rows.find((row) => row.planned > 0)?.planned).toBe(1100)
  })

  it('keeps a source that arrived without a planned row', () => {
    const data = build({
      transactions: [tx({ type: 'income', category: 'Əlavə gəlir', amount: 40 })],
    })

    expect(incomeSources(data, month)).toEqual([
      { category: 'Əlavə gəlir', actual: 40, planned: 0, share: 1 },
    ])
  })

  it('is empty when nothing was earned or planned', () => {
    expect(incomeSources(build(), month)).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Spending pace
 * ------------------------------------------------------------------ */

describe('spendingPace', () => {
  const data = build({
    transactions: [
      tx({ date: `${ANCHOR}-01`, amount: 100 }),
      tx({ date: `${ANCHOR}-02`, amount: 100 }),
    ],
    budgetLines: [
      { id: 'b1', month: ANCHOR, description: 'p', category: 'Ərzaq', planned: 1000 },
    ],
  })

  it('divides by the days elapsed, not by the whole month', () => {
    const pace = spendingPace(data, ANCHOR, `${ANCHOR}-10`)
    expect(pace).toMatchObject({ elapsed: 10, days: 31, spent: 200, perDay: 20 })
    expect(pace?.atThisRate).toBe(620)
    expect(pace?.complete).toBe(false)
  })

  it('treats a month that has ended as complete, and stops extrapolating', () => {
    const pace = spendingPace(data, ANCHOR, '2026-09-04')
    expect(pace).toMatchObject({ elapsed: 31, complete: true, spent: 200 })
    expect(pace?.atThisRate).toBe(200)
  })

  it('has nothing to report for a month that has not started', () => {
    expect(spendingPace(data, '2026-12', `${ANCHOR}-10`)).toBeNull()
  })

  it('carries the plan through for comparison', () => {
    expect(spendingPace(data, ANCHOR, `${ANCHOR}-10`)?.planned).toBe(1000)
  })
})

/* ------------------------------------------------------------------ *
 * Weekday pattern
 * ------------------------------------------------------------------ */

describe('weekdayPattern', () => {
  it('always returns seven days, Monday first', () => {
    const rows = weekdayPattern(build(), month)
    expect(rows).toHaveLength(7)
    expect(rows.map((row) => row.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(rows.every((row) => row.expenses === 0 && row.count === 0)).toBe(true)
  })

  it('files each expense under its own weekday', () => {
    // 2026-08-03 is a Monday, 2026-08-09 a Sunday.
    const data = build({
      transactions: [
        tx({ date: '2026-08-03', amount: 30 }),
        tx({ date: '2026-08-10', amount: 20 }),
        tx({ date: '2026-08-09', amount: 5 }),
        tx({ date: '2026-08-04', type: 'income', category: 'Maaş', amount: 999 }),
      ],
    })

    const rows = weekdayPattern(data, month)
    expect(rows[0]).toMatchObject({ expenses: 50, count: 2 })
    expect(rows[6]).toMatchObject({ expenses: 5, count: 1 })
    // Income is not spending, so Tuesday stays empty.
    expect(rows[1]).toMatchObject({ expenses: 0, count: 0 })
  })

  it('accounts for every expense in the period', () => {
    const data = build({
      transactions: [tx({ amount: 12.5 }), tx({ date: `${ANCHOR}-20`, amount: 7.5 })],
    })

    expect(sum(weekdayPattern(data, month).map((row) => row.expenses))).toBe(
      summarisePeriod(data, month).expenses,
    )
  })
})

/* ------------------------------------------------------------------ *
 * What repeats
 * ------------------------------------------------------------------ */

describe('frequentExpenses', () => {
  it('groups by description, case- and space-insensitively', () => {
    const data = build({
      transactions: [
        tx({ description: 'Metro', amount: 1 }),
        tx({ description: '  metro ', amount: 2 }),
        tx({ description: 'METRO', amount: 3 }),
      ],
    })

    expect(frequentExpenses(data, month, 5)).toEqual([
      { description: 'Metro', category: 'Ərzaq', count: 3, total: 6 },
    ])
  })

  it('ignores anything bought only once', () => {
    const data = build({
      transactions: [
        tx({ description: 'Metro', amount: 1 }),
        tx({ description: 'Metro', amount: 1 }),
        tx({ description: 'One-off', amount: 500 }),
      ],
    })

    expect(frequentExpenses(data, month, 5).map((row) => row.description)).toEqual([
      'Metro',
    ])
  })

  it('ranks by how often, then by how much, and honours the limit', () => {
    const data = build({
      transactions: [
        tx({ description: 'Often', amount: 1 }),
        tx({ description: 'Often', amount: 1 }),
        tx({ description: 'Often', amount: 1 }),
        tx({ description: 'Big', amount: 300 }),
        tx({ description: 'Big', amount: 300 }),
        tx({ description: 'Small', amount: 2 }),
        tx({ description: 'Small', amount: 2 }),
      ],
    })

    expect(frequentExpenses(data, month, 2).map((row) => row.description)).toEqual([
      'Often',
      'Big',
    ])
  })

  it('leaves income out of it', () => {
    const data = build({
      transactions: [
        tx({ type: 'income', category: 'Maaş', description: 'Maaş', amount: 900 }),
        tx({ type: 'income', category: 'Maaş', description: 'Maaş', amount: 900 }),
      ],
    })

    expect(frequentExpenses(data, month, 5)).toEqual([])
  })
})
